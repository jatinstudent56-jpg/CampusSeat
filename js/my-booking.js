import { db, requireUser, auth } from "./auth.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
document.addEventListener("DOMContentLoaded", async () => {
  const list=document.getElementById("bookingList"), loading=document.getElementById("bookingLoading"), empty=document.getElementById("noBooking");
  let rows=[],status="all",search="";
  const draw=()=>{const filtered=rows.filter(b=>(status==="all"||b.status===status)&&`${b.eventTitle} ${b.id} ${b.seatId}`.toLowerCase().includes(search));list.innerHTML=filtered.map(b=>`<article class="booking-card"><h2>${esc(b.eventTitle)}</h2><p>${esc(b.eventDate)} · ${esc(b.venue)}</p><p>Seat <strong>${esc(b.seatId)}</strong> · ${esc(b.status)}</p><p>Booking ID: ${esc(b.id)}</p><a class="btn btn-secondary" href="confirmation.html?id=${encodeURIComponent(b.id)}">View pass</a></article>`).join("");if(empty)empty.hidden=filtered.length>0;};
  document.getElementById("bookingSearch")?.addEventListener("input",e=>{search=e.target.value.trim().toLowerCase();draw();});
  document.querySelectorAll(".booking-filter-btn").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".booking-filter-btn").forEach(b=>b.classList.remove("active"));btn.classList.add("active");status=btn.dataset.status.toLowerCase();draw();}));
  try {
    const user=await requireUser(), snap=await getDocs(query(collection(db,"bookings"),where("uid","==",user.uid)));
    rows=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
    for(const [id,value] of [["totalBookings",rows.length],["confirmedBookings",rows.filter(b=>b.status==="confirmed").length],["cancelledBookings",rows.filter(b=>b.status==="cancelled").length],["totalSeatsBooked",rows.filter(b=>b.status==="confirmed").length]]) {const n=document.getElementById(id); if(n)n.textContent=String(value);}
    draw();
  } catch(e) { if(auth && !auth.currentUser){location.href=`login.html?next=${encodeURIComponent("my-booking.html")}`;return;} if(list) list.innerHTML=`<p role="alert">${esc(e.message || "Unable to load bookings.")}</p>`; }
  finally { if(loading) loading.hidden=true; }
});
function esc(v){return String(v??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
