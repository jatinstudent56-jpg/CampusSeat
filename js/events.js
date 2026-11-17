import { db, isFirebaseReady } from "./firebase.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function fetchEvents({ upcomingOnly = true } = {}) {
  if (!isFirebaseReady) throw new Error("Firebase is not configured. Add the web app settings before loading events.");
  // Read the public event collection and accept the status values used by both
  // current and older admin panels. A missing status is treated as published.
  const snap = await getDocs(collection(db, "events"));
  console.log("PROJECT:", db.app.options.projectId);
console.log("EVENT COUNT:", snap.size);
console.log("EVENT DATA:", snap.docs.map(d => d.data()));
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const events = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(e => {
      const status = String(e.status || "open").toLowerCase();
      const isPublished = ["open", "published", "active"].includes(status);
      return (!upcomingOnly || isPublished) && (!upcomingOnly || !e.date || e.date >= today);
    })
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  // Seat documents are sparse: a missing seat document means available.
  // Read the live seat collection so cards/details never claim 225 seats are
  // available after students have booked or admins have blocked seats.
  return Promise.all(events.map(async event => {
    const seatSnap = await getDocs(collection(db, "events", event.id, "seats"));
    const seatDocs = seatSnap.docs.map(d => d.data());
    const totalSeats = Math.min(450, Math.max(1, Number(event.totalSeats) || 225));
    const bookedSeats = seatDocs.filter(s => s.status === "booked").length;
    const blockedSeats = seatDocs.filter(s => s.status === "blocked").length;
    return {
      ...event,
      totalSeats,
      bookedSeats,
      blockedSeats,
      availableSeats: Math.max(0, totalSeats - bookedSeats - blockedSeats)
    };
  }));
}

const esc = value => String(value ?? "").replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Date to be announced";

function getDateParts(dateString) {
  if (!dateString) return { day: "--", month: "TBA" };
  const d = new Date(`${dateString}T00:00:00`);
  return {
    day: d.toLocaleDateString("en-IN", { day: "2-digit" }),
    month: d.toLocaleDateString("en-IN", { month: "short" })
  };
}

function card(e, home = false) {
  const parts = getDateParts(e.date);
  const total = Number(e.totalSeats) || 225;
  const available = typeof e.availableSeats === "number" ? e.availableSeats : total;
  const isAvailable = available > 0 && String(e.status || "open").toLowerCase() !== "closed";
  const category = e.category || "tech";
  const posterStyle = e.posterUrl ? ` style="background-image: linear-gradient(180deg, rgba(15, 23, 42, 0.1), rgba(15, 23, 42, 0.75)), url('${esc(e.posterUrl)}'); background-size: cover; background-position: center;"` : "";

  return `
    <article class="event-item">
      <div class="event-image ${esc(category)}"${posterStyle}>
        <span class="event-category">${esc(e.categoryLabel || e.category || "Event")}</span>
        <div class="event-calendar">
          <div class="event-day">${esc(parts.day)}</div>
          <div class="event-month">${esc(parts.month)}</div>
        </div>
      </div>
      <div class="event-content">
        <h2>${esc(e.title)}</h2>
        <p class="event-description">${esc(e.description || "")}</p>
        <div class="event-meta">
          <div class="event-meta-row">
            <span class="event-meta-icon">📅</span>
            <span>${esc(fmt(e.date))}</span>
          </div>
          <div class="event-meta-row">
            <span class="event-meta-icon">🕐</span>
            <span>${esc(e.startTime || "Time TBA")}${e.endTime ? ` - ${esc(e.endTime)}` : ""}</span>
          </div>
          <div class="event-meta-row">
            <span class="event-meta-icon">📍</span>
            <span>${esc(e.venue || "Main Auditorium")}</span>
          </div>
        </div>
        <div class="event-seat-info" style="display:flex; justify-content:space-between; align-items:center; margin-top:auto; margin-bottom:15px; padding:10px 14px; border-radius:10px; background:rgba(51, 65, 85, 0.45); font-size:13px;">
          <span>Total: <strong>${total}</strong></span>
          <span style="font-weight:700; color:${isAvailable ? 'var(--seat-available, #22c55e)' : 'var(--seat-booked, #ef4444)'};">
            ${isAvailable ? `${available} seats open` : 'Booking full'}
          </span>
        </div>
        <div class="event-actions">
          <a class="event-btn event-btn-secondary" href="${home ? "pages/" : ""}event-details.html?id=${encodeURIComponent(e.id)}">Details</a>
          ${isAvailable
      ? `<a class="event-btn event-btn-primary" href="${home ? "pages/" : ""}booking.html?event=${encodeURIComponent(e.id)}">Book Seat</a>`
      : `<span class="event-btn event-btn-secondary" style="opacity:0.55; cursor:not-allowed;">Closed</span>`
    }
        </div>
      </div>
    </article>
  `;
}
let loadedEvents = [], activeCategory = "all", searchText = "";

async function init() {
  const grid = document.getElementById("eventsGrid"), details = document.getElementById("eventDetails"), home = document.getElementById("homeUpcomingList");
  if (!grid && !details && !home) return;
  if (grid) grid.innerHTML = '<p role="status">Loading events…</p>';
  if (details) details.innerHTML = '<p role="status">Loading event…</p>';
  try {
    const events = await fetchEvents({ upcomingOnly: true });
    console.log("STUDENT EVENTS FROM FIRESTORE:", events);
    loadedEvents = events;
    const hero = events[0];
    if (hero && document.getElementById("eventTitle")) {
      document.getElementById("eventTitle").textContent = hero.title;
      document.getElementById("eventDate").textContent = `${fmt(hero.date)} · ${hero.startTime || "Time TBA"}`;
      document.getElementById("eventDesc").textContent = `${hero.venue || "Campus"} · ${hero.description || ""}`;
      const bookLink = document.getElementById("heroBookLink"); if (bookLink) bookLink.href = `pages/booking.html?event=${encodeURIComponent(hero.id)}`;
      const total = Math.min(450, Math.max(1, Number(hero.totalSeats) || 225));
      const booked = Number(hero.bookedSeats) || 0;
      const blocked = Number(hero.blockedSeats) || 0;
      const available = hero.availableSeats;
      for (const [id, value] of [["statTotal", total], ["statAvailable", available], ["statBooked", booked], ["statReserved", blocked]]) { const n = document.getElementById(id); if (n) n.textContent = String(value); }
      const availability = document.getElementById("visualAvailable"); if (availability) availability.textContent = `${available} seats available for ${hero.title}`;
    }
    if (grid) {
      const draw = () => { const matches = loadedEvents.filter(e => (activeCategory === "all" || e.category === activeCategory) && (`${e.title} ${e.description} ${e.venue} ${e.organizer}`).toLowerCase().includes(searchText)); grid.innerHTML = matches.map(e => card(e)).join("") || '<p>No matching events.</p>'; const count = document.getElementById("eventCount"); if (count) count.textContent = String(matches.length); const empty = document.getElementById("emptyState"); if (empty) empty.hidden = matches.length > 0; };
      draw(); document.getElementById("eventSearch")?.addEventListener("input", e => { searchText = e.target.value.trim().toLowerCase(); draw(); });
      document.querySelectorAll(".filter-btn").forEach(btn => btn.addEventListener("click", () => { document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active")); btn.classList.add("active"); activeCategory = btn.dataset.category || "all"; draw(); }));
    }
    if (home) home.innerHTML = events.slice(0, 4).map(e => card(e, true)).join("") || '<p>No upcoming events are published yet.</p>';
    if (details) {
      const event = events.find(e => e.id === new URLSearchParams(location.search).get("id"));
      if (!event) {
        details.innerHTML = '<div class="details-empty"><h1>Event not found</h1><p>This event may have ended or been removed.</p><a class="event-btn event-btn-primary" href="events.html">Browse events</a></div>';
      } else {
        const total = Number(event.totalSeats) || 225;
        const available = typeof event.availableSeats === "number" ? event.availableSeats : total;
        const isAvailable = available > 0 && String(event.status || "open").toLowerCase() !== "closed";
        const posterStyle = event.posterUrl ? ` style="background-image: linear-gradient(180deg, rgba(15, 23, 42, 0.1), rgba(15, 23, 42, 0.85)), url('${esc(event.posterUrl)}'); background-size: cover; background-position: center;"` : "";

        details.innerHTML = `
          <div class="event-details-card">
            <div class="details-banner ${esc(event.category || "tech")}"${posterStyle}>
              <span class="event-category">${esc(event.categoryLabel || event.category || "Campus event")}</span>
              <h1>${esc(event.title)}</h1>
              <p>Organized by ${esc(event.organizer || "CampusSeat")}</p>
            </div>
            <div class="details-content">
              <div class="details-grid">
                <div class="detail-box">
                  <span class="detail-box-label">Date</span>
                  <span class="detail-box-value">${esc(fmt(event.date))}</span>
                </div>
                <div class="detail-box">
                  <span class="detail-box-label">Time</span>
                  <span class="detail-box-value">${esc(event.startTime || "Time TBA")}${event.endTime ? ` - ${esc(event.endTime)}` : ""}</span>
                </div>
                <div class="detail-box">
                  <span class="detail-box-label">Venue</span>
                  <span class="detail-box-value">${esc(event.venue || "Main Auditorium")}</span>
                </div>
                <div class="detail-box">
                  <span class="detail-box-label">Seats Availability</span>
                  <span class="detail-box-value" style="color: ${isAvailable ? 'var(--seat-available, #22c55e)' : 'var(--seat-booked, #ef4444)'}; font-weight: bold;">
                    ${available} / ${total} available
                  </span>
                </div>
              </div>

              <h2>About This Event</h2>
              <p class="details-description">${esc(event.description || "No description provided.")}</p>

              <div class="details-actions">
                ${isAvailable
            ? `<a class="event-btn event-btn-primary" href="booking.html?event=${encodeURIComponent(event.id)}">Select Your Seat</a>`
            : `<span class="event-btn event-btn-secondary" style="opacity:0.55; cursor:not-allowed;">Booking Closed</span>`
          }
                <a class="event-btn event-btn-secondary" href="events.html">Explore Other Events</a>
              </div>
            </div>
          </div>
        `;
      }
    }
  } catch (error) {
    const message = esc(error.message || "Could not load events.");
    if (grid) grid.innerHTML = `<p role="alert">${message}</p>`;
    if (home) home.innerHTML = `<p role="alert">${message}</p>`;
    if (details) details.innerHTML = `<p role="alert">${message}</p>`;
  }
}
document.addEventListener("DOMContentLoaded", init);
