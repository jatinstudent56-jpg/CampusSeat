// js/admin.js — admin console: events, seat controls and the reservation directory.
import { auth, db, isAdmin, isFirebaseReady, onAuthStateChanged, signOut } from "./auth.js";
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, runTransaction, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = id => document.getElementById(id);
const table = $("adminBookingsTable");
const COLS = 8;                                  // columns in the bookings table
let bookings = [], events = [], seatUnsubs = [];
let searchText = "", statusFilter = "all", editingEventId = null;

if (!isFirebaseReady) {
  if (table) table.innerHTML = `<tr><td colspan="${COLS}">Firebase is not configured. Add the web app config first.</td></tr>`;
} else {
  onAuthStateChanged(auth, async user => {
    if (!user) { location.href = "login.html?next=admin.html"; return; }
    try {
      if (!(await isAdmin(user))) { renderAccessDenied(); return; }
      const display = $("adminUserDisplay");
      if (display) display.textContent = user.email || "Administrator";
      await load();
    } catch (e) {
      if (table) table.innerHTML = `<tr><td colspan="${COLS}">Unable to verify administrator access: ${esc(e.message)}</td></tr>`;
    }
  });
}

async function load() {
  try {
    const [bs, es] = await Promise.all([
      getDocs(collection(db, "bookings")),
      getDocs(collection(db, "events"))
    ]);
    bookings = bs.docs.map(d => ({ id: d.id, ...d.data() })).sort(byNewest);
    events = es.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

    set("adminBookingTotal", bookings.length);
    const capacity = events.reduce((n, e) => n + (Number(e.totalSeats) || 225), 0);
    set("adminTotal", capacity);

    // Live seat counters — one Firestore listener per published event.
    seatUnsubs.forEach(stop => stop());
    seatUnsubs = [];
    const seatState = new Map();
    const updateSeatStats = () => {
      const rows = [...seatState.values()].flat();
      const booked = rows.filter(s => s.status === "booked").length;
      const blocked = rows.filter(s => s.status === "blocked").length;
      set("adminBooked", booked);
      set("adminReserved", blocked);
      set("adminAvailable", Math.max(0, capacity - booked - blocked));
    };
    for (const event of events) {
      seatUnsubs.push(onSnapshot(collection(db, "events", event.id, "seats"),
        snap => { seatState.set(event.id, snap.docs.map(d => d.data())); updateSeatStats(); },
        err => console.error("Live seat feed failed", err)));
    }
    if (!events.length) updateSeatStats();

    renderBookings();
    renderEvents();
    stamp("Updated");
  } catch (e) {
    if (table) table.innerHTML = `<tr><td colspan="${COLS}">Could not load admin data: ${esc(e.message)}</td></tr>`;
  }
}

// --- small helpers ---------------------------------------------------------
const time = value => (value?.toMillis ? value.toMillis() : (value instanceof Date ? value.getTime() : 0));
const byNewest = (a, b) => time(b.createdAt) - time(a.createdAt);
const set = (id, value) => { const node = $(id); if (node) node.textContent = String(value); };
const stamp = label => set("adminLastUpdated", `${label} ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`);

let toastTimer;
function toast(message) {
  const node = $("adminToast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("is-visible"), 3200);
}

function renderAccessDenied() {
  document.body.classList.remove("is-loading");
  document.body.innerHTML = `
    <main class="admin-denied">
      <div class="admin-denied-card">
        <span class="admin-denied-mark" aria-hidden="true">CS</span>
        <h1>Admin access required</h1>
        <p>This account has not been granted administrator access. Sign in with an administrator account to open the console.</p>
        <div class="admin-denied-actions">
          <a class="btn btn-primary" href="login.html">Sign in with another account</a>
          <a class="btn btn-secondary" href="../index.html">Back to home</a>
        </div>
      </div>
    </main>`;
}

// --- reservation directory -------------------------------------------------
function visibleBookings() {
  const needle = searchText;
  return bookings.filter(b =>
    (statusFilter === "all" || b.status === statusFilter) &&
    (!needle || [b.id, b.seatId, b.studentName, b.rollNumber, b.eventTitle, b.email, b.course, b.branch]
      .join(" ").toLowerCase().includes(needle)));
}

function renderBookings() {
  const rows = visibleBookings();
  set("adminResultCount", `${rows.length} of ${bookings.length}`);
  if (!table) return;
  table.innerHTML = rows.length
    ? rows.map(bookingRow).join("")
    : `<tr><td colspan="${COLS}" class="admin-loading">${bookings.length ? "No bookings match your search." : "No bookings yet."}</td></tr>`;
}

function bookingRow(b) {
  const course = [b.course, b.branch].filter(Boolean).join(" ");
  const email = b.email ? `<span class="cell-sub">${esc(b.email)}</span>` : "";
  const cancelled = b.status === "cancelled";
  return `<tr>
    <td class="cell-id">${esc(b.id)}</td>
    <td>${esc(b.eventTitle || "—")}</td>
    <td><span class="seat-chip">${esc(b.seatId || "—")}</span></td>
    <td>${esc(b.studentName || "—")}${email}</td>
    <td>${esc(b.rollNumber || "—")}</td>
    <td>${esc(course || "—")}</td>
    <td><span class="status-pill ${cancelled ? "is-cancelled" : "is-confirmed"}">${esc(b.status || "unknown")}</span></td>
    <td>${cancelled || b.status !== "confirmed"
      ? `<span class="cell-muted">—</span>`
      : `<button type="button" class="btn btn-danger btn-sm" data-cancel-booking="${esc(b.id)}">Cancel</button>`}</td>
  </tr>`;
}

table?.addEventListener("click", async e => {
  const id = e.target.dataset.cancelBooking;
  if (!id || !confirm("Cancel this booking and release its seat?")) return;
  const b = bookings.find(x => x.id === id);
  if (!b) return;
  try {
    const br = doc(db, "bookings", id), sr = doc(db, "events", b.eventId, "seats", b.seatId);
    await runTransaction(db, async tx => {
      const [bs, ss] = await Promise.all([tx.get(br), tx.get(sr)]);
      if (!bs.exists() || bs.data().status !== "confirmed") throw new Error("Booking is no longer active.");
      tx.update(br, { status: "cancelled", cancelledAt: serverTimestamp() });
      if (ss.exists() && ss.data().bookingId === id) {
        tx.update(sr, { status: "available", bookingId: "", uid: "", updatedAt: serverTimestamp() });
      }
    });
    toast(`Booking ${id} cancelled — seat ${b.seatId} released.`);
    await load();
  } catch (err) { alert(`Could not cancel booking: ${err.message}`); }
});

$("adminSearchInput")?.addEventListener("input", e => {
  searchText = e.target.value.trim().toLowerCase();
  renderBookings();
});

$("adminStatusFilter")?.addEventListener("click", e => {
  const chip = e.target.closest(".admin-chip");
  if (!chip) return;
  statusFilter = chip.dataset.status || "all";
  document.querySelectorAll("#adminStatusFilter .admin-chip").forEach(c => c.classList.toggle("active", c === chip));
  renderBookings();
});

// --- event manager ---------------------------------------------------------
function renderEvents() {
  const box = $("adminEventList");
  if (box) {
    box.innerHTML = events.length
      ? events.map(eventCard).join("")
      : `<p class="admin-empty-inline">No events published yet. Use the form above to publish the first one.</p>`;
  }
  set("adminEventCount", `${events.length} published`);

  const select = $("seatEventId");
  if (select) {
    const previous = select.value;
    select.innerHTML = events.length
      ? events.map(e => `<option value="${esc(e.id)}">${esc(e.title)}</option>`).join("")
      : `<option value="">No events yet</option>`;
    if (previous && events.some(e => e.id === previous)) select.value = previous;
  }
}

function eventCard(e) {
  return `<article class="admin-event-card${editingEventId === e.id ? " is-editing" : ""}">
    <div class="admin-event-card-main">
      <span class="admin-event-tag">${esc(e.categoryLabel || e.category || "Event")}</span>
      <h3>${esc(e.title)}</h3>
      <p>${esc(e.date || "Date TBA")} · ${esc(e.startTime || "")}${e.endTime ? ` – ${esc(e.endTime)}` : ""} · ${esc(e.venue || "Venue TBA")}</p>
      <p class="admin-event-organizer">Organized by ${esc(e.organizer || "CampusSeat")}</p>
    </div>
    <div class="admin-event-card-actions">
      <button type="button" class="btn btn-secondary btn-sm" data-edit="${esc(e.id)}">${editingEventId === e.id ? "Editing…" : "Edit"}</button>
      <button type="button" class="btn btn-danger btn-sm" data-delete="${esc(e.id)}">Delete</button>
    </div>
  </article>`;
}

function startEdit(event) {
  editingEventId = event.id;
  const form = $("adminEventForm");
  form.dataset.edit = event.id;
  $("eventTitleInput").value = event.title || "";
  $("eventCategoryInput").value = event.category || "technical";
  $("eventDateInput").value = event.date || "";
  $("eventStartInput").value = event.startTime || "";
  $("eventEndInput").value = event.endTime || "";
  $("eventVenueInput").value = event.venue || "Main Auditorium";
  $("eventOrganizerInput").value = event.organizer || "";
  $("eventTotalSeatsInput").value = event.totalSeats || 450;
  $("eventDescriptionInput").value = event.description || "";
  $("eventPosterInput").value = event.posterUrl || "";
  $("eventSubmitBtn").textContent = "Save changes";
  $("cancelEventEdit")?.removeAttribute("hidden");
  renderEvents();
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function endEdit() {
  editingEventId = null;
  const form = $("adminEventForm");
  if (form) delete form.dataset.edit;
  const submit = $("eventSubmitBtn");
  if (submit) submit.textContent = "Publish event";
  $("cancelEventEdit")?.setAttribute("hidden", "");
}

$("adminEventForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const form = e.currentTarget;
  const capacity = Number($("eventTotalSeatsInput").value);

if (!Number.isInteger(capacity) || capacity < 1 || capacity > 450) {
  return alert("Total seats must be between 1 and 450.");
}
  if ($("eventEndInput").value <= $("eventStartInput").value) {
    return alert("Choose an end time later than the start time.");
  }
  const data = {
    title: $("eventTitleInput").value.trim(),
    category: $("eventCategoryInput").value,
    categoryLabel: $("eventCategoryInput").selectedOptions[0].textContent,
    date: $("eventDateInput").value,
    startTime: $("eventStartInput").value,
    endTime: $("eventEndInput").value,
    venue: $("eventVenueInput").value,
    organizer: $("eventOrganizerInput").value.trim(),
    description: $("eventDescriptionInput").value.trim(),
    posterUrl: $("eventPosterInput").value.trim(),
    totalSeats: Number($("eventTotalSeatsInput").value),
    status: "open",
    updatedAt: serverTimestamp()
  };
  try {
    if (editingEventId) {
      await updateDoc(doc(db, "events", editingEventId), data);   // keeps the original createdAt
      toast(`Saved changes to “${data.title}”.`);
    } else {
      await addDoc(collection(db, "events"), { ...data, createdAt: serverTimestamp() });
      toast(`Published “${data.title}”.`);
    }
    endEdit();
    form.reset();
    await load();
  } catch (err) { alert(`Could not save event: ${err.message}`); }
});

$("cancelEventEdit")?.addEventListener("click", () => {
  endEdit();
  const form = $("adminEventForm");
  if (form) form .reset();
  renderEvents();
});

$("adminEventList")?.addEventListener("click", async e => {
  const editId = e.target.dataset.edit, deleteId = e.target.dataset.delete;
  if (editId) {
    const event = events.find(x => x.id === editId);
    if (event) startEdit(event);
    return;
  }
  if (!deleteId) return;
  if (bookings.some(b => b.eventId === deleteId && b.status === "confirmed")) {
    return alert("Cancel this event's active bookings before deleting it.");
  }
  if (!confirm("Delete this event and all its seat records? Booking history remains.")) return;
  try {
    const seats = await getDocs(collection(db, "events", deleteId, "seats"));
    for (const s of seats.docs) await deleteDoc(s.ref);
    await deleteDoc(doc(db, "events", deleteId));
    if (editingEventId === deleteId) endEdit();
    toast("Event deleted.");
    await load();
  } catch (err) { alert(`Could not delete event: ${err.message}`); }
});

// --- seat controls ---------------------------------------------------------
$("adminSeatForm")?.addEventListener("submit", async e => {
  e.preventDefault();

  const form = e.currentTarget;
  const eventId = $("seatEventId").value;
  const seatId = $("seatId").value.toUpperCase();
  const status = $("seatStatus").value;

  if (!eventId) return alert("Publish an event before changing seat status.");
const match = seatId.match(/^([A-Z]+)(0[1-9]|1[0-5])$/);

if (!match) {
  return alert("Use a valid seat ID from A01 to AD15.");
}

const rowLabel = match[1];
let rowIndex = 0;

for (const char of rowLabel) {
  rowIndex = rowIndex * 26 + char.charCodeAt(0) - 64;
}

rowIndex--;

if (rowIndex < 0 || rowIndex >= 30) {
  return alert("Seat row must be between A and AD.");
}

const column = Number(match[2]);
const seatPosition = rowIndex * 15 + column;

const selectedEvent = events.find(e => e.id === eventId);
const capacity = Math.min(450, Math.max(1, Number(selectedEvent?.totalSeats) || 225));

if (seatPosition > capacity) {
  return alert(`This event has only ${capacity} seats.`);
}

  try {
    const ref = doc(db, "events", eventId, "seats", seatId);

    await runTransaction(db, async tx => {
      const current = await tx.get(ref);

      if (current.exists() && current.data().status === "booked") {
        throw new Error("This seat has an active booking. Cancel the booking before changing it.");
      }

      tx.set(ref, {
        status,
        updatedAt: serverTimestamp()
      }, { merge: true });
    });

    form.reset(); //form.reset();
    toast(`Seat ${seatId} is now ${status}.`);

    load().catch(err => console.error("Dashboard refresh failed:", err));

  } catch (err) {
    alert(`Could not update seat: ${err.message}`);
  }
});

// --- header actions --------------------------------------------------------
$("adminLogoutBtn")?.addEventListener("click", async () => {
  try { await signOut(auth); } catch (_) { /* sign-out is best effort */ }
  location.href = "login.html";
});

$("refreshAdminBtn")?.addEventListener("click", async () => {
  await load();
  toast("Dashboard refreshed.");
});

$("exportCsvBtn")?.addEventListener("click", () => {
  const header = ["Booking ID", "Event", "Event Date", "Seat", "Student Name", "Roll Number", "Email", "Mobile", "Course", "Branch", "Year", "Semester", "Status", "Created"];
  const rows = bookings.map(b => [
    b.id, b.eventTitle, b.eventDate, b.seatId, b.studentName, b.rollNumber, b.email, b.mobile,
    b.course, b.branch, b.year, b.semester, b.status,
    time(b.createdAt) ? new Date(time(b.createdAt)).toISOString() : ""
  ]);
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `campusseat-bookings-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`Exported ${bookings.length} booking${bookings.length === 1 ? "" : "s"}.`);
});

$("resetSeatsBtn")?.addEventListener("click", async () => {
  if (!confirm("Reset every event seat and remove ALL bookings? This cannot be undone.")) return;
  if (!confirm("Second check: really erase all seats and bookings?")) return;
  try {
    for (const e of events) {
      const snap = await getDocs(collection(db, "events", e.id, "seats"));
      for (const s of snap.docs) await deleteDoc(s.ref);
    }
    for (const b of bookings) await deleteDoc(doc(db, "bookings", b.id));
    toast("All seats and bookings were reset.");
    await load();
  } catch (err) { alert(`Reset failed: ${err.message}`); }
});

function esc(v) {
  return String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}


