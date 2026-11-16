# CampusSeat

Responsive college event booking frontend using HTML, CSS, vanilla JavaScript, Firebase Authentication and Cloud Firestore. It uses the existing Firebase modular CDN SDK and requires no build step. All event listings, bookings and seat statuses shown by the app come from Firestore.

## Run locally

Serve the project root over HTTP (opening files with `file://` does not support Firebase modules):

```powershell
py -m http.server 5500
```

Open `http://localhost:5500`. Do not open the site with a `file://` URL. In Firebase Console → Authentication → Settings → Authorized domains, add `localhost` and the exact deployed hostname (for example, your Vercel domain).

## Firebase setup and backend activation

This project uses Firebase Authentication + Cloud Firestore as its serverless backend. There is no separate Express/PHP server to run. Booking writes are atomic Firestore transactions; the deployed Firestore rules enforce student ownership and admin-only management.

1. `js/firebase.js` is configured with the supplied Firebase **Web App** configuration. You can override it by setting `window.CAMPUSSEAT_FIREBASE_CONFIG` before page modules load. Web app config is public client configuration; never put service account credentials in this project.
2. In Firebase Console → Authentication → Sign-in method, enable **Email/Password** and **Google**.
3. In Authentication → Settings → Authorized domains, add `localhost` and the exact deployed hostname (for example `campus-seat.vercel.app`). This specifically fixes `auth/unauthorized-domain` during Google login.
4. Create a Cloud Firestore database and deploy `firestore.rules` (`firebase deploy --only firestore:rules`). The app expects the `events`, `events/{eventId}/seats`, `bookings`, and optional `users` collections described below.
5. Create administrator access using a trusted server/Admin SDK or Firebase Console. Set a user's `users/{uid}` document to `{ "role": "admin" }` from a trusted administrator context, or assign the `admin: true` custom claim through the Admin SDK. Never create or change that role from this frontend. Ordinary signups cannot grant themselves admin.
6. Publish events from `pages/admin.html`. Event documents use `title`, `category`, `date` (`YYYY-MM-DD`), `startTime`, `endTime`, `venue`, `organizer`, `description`, `status: "open"`, and `totalSeats: 225`.

## Firestore data model

- `users/{uid}`: optional profile/role. Students cannot assign privileged roles.
- `events/{eventId}`: public event metadata.
- `events/{eventId}/seats/{seatId}`: sparse seat status documents. Missing documents mean available; seat IDs are A01–O15. A booking transaction writes the seat and booking together.
- `bookings/{bookingId}`: owner UID, event and seat references, student details, status and server timestamp. Students can read only their own documents; admins can manage all bookings.

The Firestore transaction prevents simultaneous claims on the same seat. The security rules verify that each student booking and seat reservation match in the same atomic write. Existing older `seats/{seatId}` and localStorage demo records are not imported or treated as live availability.

## Pages

- `index.html`: published events and live seat totals for the next event.
- `pages/login.html`: branded loading screen first, then email/password and Google sign-in, registration and password reset. After signing in, administrators go **directly to `pages/admin.html`** and students to the main `index.html` (or back to the page they came from, e.g. a booking deep link). Already signed-in visitors are routed automatically.
- `pages/events.html`, `pages/event-details.html`: Firestore event catalog.
- `pages/booking.html`, `pages/confirmation.html`, `pages/my-booking.html`, `pages/dashboard.html`: authenticated booking flow and personal reservations.
- `pages/admin.html`: role-checked event and booking administration, seat status controls and CSV export.

The static files can be deployed directly to Vercel from the repository root. For Firebase Hosting, `firebase.json` points at the project root and includes the Firestore rules file. Deploy the rules and add a trusted admin before using administration. This project includes no server function for role assignment; administrator role provisioning is intentionally an out-of-band trusted operation.

## Final verification checklist

- [ ] Run from `http://localhost:5500` (never `file://`).
- [ ] Enable Email/Password and Google providers in Firebase Authentication.
- [ ] Add `localhost` and the production domain to Authorized domains.
- [ ] Create Firestore and publish the security rules.
- [ ] Grant the administrator role to the intended UID using a trusted method.
- [ ] Publish an event, sign in as a student, and complete a booking.
- [ ] Verify a second student cannot reserve the same seat.
- [ ] Verify cancellation releases the seat and admin-only actions are denied to students.

The source code can be prepared and statically checked here, but live Firebase sign-in, Firestore permissions, and deployed-domain behavior must be verified against your Firebase project and browser session.
