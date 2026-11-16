import { auth, db, requireUser, isFirebaseReady } from "./auth.js";
import { doc, getDoc, onSnapshot, runTransaction, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const eventId = new URLSearchParams(location.search).get("event");
const ROWS = 30;
const COLS = 15;
const TOTAL_SEATS = ROWS * COLS;

function getRowLabel(index) {
  let n = index + 1;
  let label = "";

  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }

  return label;
}

const seatIds = Array.from({ length: TOTAL_SEATS }, (_, i) =>
  `${getRowLabel(Math.floor(i / COLS))}${String(i % COLS + 1).padStart(2, "0")}`
);
let user, eventData, seats = {}, selected = "";
let eventCapacity = 450; // Default capacity, will be updated from event data
const $ = id => document.getElementById(id);
const error = message => { const node = $("toast"); if (node) { node.textContent = message; node.classList.remove("hidden"); } else alert(message); };

document.addEventListener("DOMContentLoaded", start);
async function start() {
  try {
    if (!isFirebaseReady || !eventId) throw new Error("Choose an event from the events page to book a seat.");
    user = await requireUser();
    eventData = (await getDoc(doc(db,"events",eventId))).data();
    eventCapacity = Math.min(
  TOTAL_SEATS,
  Math.max(1, Number(eventData?.totalSeats) || 225)
);
    const eventStatus = String(eventData?.status || "open").toLowerCase();
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (!eventData || !["open", "published", "active"].includes(eventStatus) || (eventData.date && eventData.date < todayKey)) {
      throw new Error("This event is unavailable for booking.");
    }
    $("bookingEventTitle").textContent = eventData.title;
    $("bookingEventMeta").textContent = `${eventData.venue || "Campus"} · ${eventData.date || "Date TBA"} · ${eventData.startTime || "Time TBA"}`;
    $("email").value = user.email || ""; $("email").readOnly = true;
    $("studentName").value = user.displayName || "";
    $("seatMap").setAttribute("aria-label","Auditorium, 30 rows and 15 seats per row");
    const seatCollection = collection(db,"events",eventId,"seats");
    onSnapshot(seatCollection, snap => {
    seats = Object.fromEntries(snap.docs.map(d => [d.id,d.data()]));
      if(selected && seats[selected] && seats[selected].status!=="available"){selected="";$("selectedSeatText").textContent="None";$("btnConfirmBooking").disabled=true;}
      render();
    }, err => error(`Live seats could not be loaded: ${err.message}`));
    $("bookingForm").addEventListener("submit", submitBooking);
  } catch (e) { if(auth && !auth.currentUser){location.href=`login.html?next=${encodeURIComponent(`booking.html?event=${eventId||""}`)}`;return;} error(e.message || "Could not load the booking page."); $("btnConfirmBooking").disabled = true; }
}
function render() {
  const root = $("seatMap");
  if (!root) return;

  root.innerHTML = "";

  for (let r = 0; r < ROWS; r++) {
    const row = document.createElement("div");
    row.className = "seat-row";

    const rowName = getRowLabel(r);

    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = rowName;
    row.append(label);

    for (let c = 0; c < COLS; c++) {
      const id = `${rowName}${String(c + 1).padStart(2, "0")}`;

      const seatIndex = r * COLS + c;
      const inCapacity = seatIndex < eventCapacity;

      const state = seats[id]?.status || "available";

      const visual = !inCapacity
        ? "disabled"
        : state === "blocked" ? "disabled" : state;

      const button = document.createElement("button");

      button.type = "button";
      button.className = `seat ${id === selected ? "selected" : visual}`;
      button.textContent = String(c + 1);

      button.setAttribute(
        "aria-label",
        `${id}, ${!inCapacity ? "not included in event capacity" : id === selected ? "selected" : state}`
      );

      button.disabled = !inCapacity ||
        (state !== "available" && id !== selected);

      if (c === 7) button.style.marginLeft = "1.4rem";

      button.addEventListener("click", () => {
        selected = id;
        $("selectedSeatText").textContent = id;
        $("btnConfirmBooking").disabled = false;
        render();
      });

      row.append(button);
    }

    root.append(row);
  }

  const available = seatIds
    .slice(0, eventCapacity)
    .filter(id => (seats[id]?.status || "available") === "available")
    .length;

  const count = document.querySelector(".seat-count-note");

  if (count) {
    count.textContent = `${available} of ${eventCapacity} seats available`;
  }
}
async function submitBooking(e) {
  e.preventDefault();

  if (!selected || !user) {
    return error("Select an available seat first.");
  }

  const seatPosition = seatIds.indexOf(selected);

  if (seatPosition < 0 || seatPosition >= eventCapacity) {
    return error("This seat is not available for this event.");
  }

  const button = $("btnConfirmBooking");
  button.disabled = true;
  button.textContent = "Saving booking…";

  const seatRef = doc(db, "events", eventId, "seats", selected);
  const counterRef = doc(db, "counters", "bookingCounter");

  let bookingId = "";

  const data = {
    uid: user.uid,
    email: user.email,
    eventId,
    eventTitle: eventData.title,
    eventDate: eventData.date || "",
    venue: eventData.venue || "",
    seatId: selected,
    studentName: $("studentName").value.trim(),
    rollNumber: $("rollNumber").value.trim(),
    course: $("course").value,
    branch: $("branch").value.trim(),
    year: $("year").value,
    semester: $("semester").value.trim(),
    mobile: $("mobile").value.trim(),
    status: "confirmed",
    createdAt: serverTimestamp()
  };

  try {
    if (
      !data.studentName ||
      !data.rollNumber ||
      !data.course ||
      !data.branch ||
      !data.year ||
      !data.semester
    ) {
      throw new Error("Complete all required student details.");
    }

    await runTransaction(db, async tx => {
      const eventRef = doc(db, "events", eventId);

      const [eventDoc, seat, counter] = await Promise.all([
        tx.get(eventRef),
        tx.get(seatRef),
        tx.get(counterRef)
      ]);

      if (!eventDoc.exists()) {
        throw new Error("Event no longer exists.");
      }

      if (!counter.exists()) {
        throw new Error("Booking counter is missing.");
      }

      const currentCapacity = Math.min(
        TOTAL_SEATS,
        Math.max(1, Number(eventDoc.data().totalSeats) || 225)
      );

      if (seatPosition >= currentCapacity) {
        throw new Error("This seat is outside the event capacity.");
      }

      if (seat.exists() && seat.data().status !== "available") {
        throw new Error("That seat was just taken. Choose another available seat.");
      }

      const nextNumber = counter.data().lastNumber + 1;

      bookingId = `CS-${new Date().getFullYear()}-${String(nextNumber).padStart(4, "0")}`;

      const bookingRef = doc(db, "bookings", bookingId);

      tx.update(counterRef, {
        lastNumber: nextNumber
      });

      tx.set(seatRef, {
        status: "booked",
        bookingId,
        uid: user.uid,
        updatedAt: serverTimestamp()
      });

      tx.set(bookingRef, {
        ...data
      });
    });

    location.href = `confirmation.html?id=${encodeURIComponent(bookingId)}`;

  } catch (err) {
    error(err.message || "Booking failed. Please retry.");
    button.disabled = false;
    button.textContent = "Confirm & Reserve Seat";
  }
}