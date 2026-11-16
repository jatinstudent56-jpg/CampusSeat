import { db, requireUser, auth } from "./auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
document.addEventListener("DOMContentLoaded", async () => {
  const id=new URLSearchParams(location.search).get("id");
  try {
    const user=await requireUser(); if(!id) throw new Error("Booking reference is missing.");
    const snap=await getDoc(doc(db,"bookings",id)); if(!snap.exists() || snap.data().uid!==user.uid) throw new Error("Booking not found for this account.");
    const b=snap.data(), put=(name,value)=>{const n=document.getElementById(name); if(n)n.textContent=value||"—";};
    put("passEventName",b.eventTitle); put("passSeatId",b.seatId); put("passBookingId",id); put("passName",b.studentName); put("passRoll",b.rollNumber); put("passCourseBranch",`${b.course} / ${b.branch}`); put("passYearSem",`${b.year} / ${b.semester}`); put("passDateTime",`${b.eventDate} · ${b.venue}`);
    const title=document.getElementById("confirmationTitle"); if(title) title.textContent="Booking confirmed";
    document.getElementById("printablePass").hidden=false;
    if (window.QRCode) new window.QRCode(document.getElementById("qrcode"), { text: `CampusSeat booking ${id}`, width: 150, height: 150 });
    const note=document.querySelector(".confirmation-note"); if(note) note.textContent="Your booking has been saved to your CampusSeat account.";
  } catch(e) { if(auth && !auth.currentUser){location.href=`login.html?next=${encodeURIComponent(`confirmation.html?id=${id||""}`)}`;return;} const title=document.getElementById("confirmationTitle"); if(title) title.textContent=e.message || "Booking not found"; }
});
