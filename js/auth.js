// js/auth.js — authentication helpers plus role-based routing after sign-in.
import { auth, db, isFirebaseReady } from "./firebase.js";
import { GoogleAuthProvider, signInWithPopup, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export { auth, db, isFirebaseReady, onAuthStateChanged, signOut };

/** True when the account carries the admin custom claim or an admin profile. */
export async function isAdmin(user) {
  if (!user || !db) return false;
  try {
    const token = await user.getIdTokenResult(true);
    if (token.claims.admin === true) return true;
  } catch (_) { /* token refresh failed — fall back to the profile lookup below */ }
  try {
    const profile = await getDoc(doc(db, "users", user.uid));
    return profile.exists() && profile.data().role === "admin";
  } catch (_) {
    // A failed profile lookup must never grant privileges or strand the user.
    return false;
  }
}

/** Resolve once the visitor is signed in, reject when nobody is signed in. */
export async function requireUser() {
  if (!auth) throw new Error("Firebase is not configured.");
  const user = await new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, u => { stop(); u ? resolve(u) : reject(new Error("Sign in to continue.")); }, reject);
  });
  return user;
}

/**
 * Where a signed-in account belongs:
 *   admin   → the admin panel, directly.
 *   student → a safe page that sent them to sign in, or the main index.
 */
const STUDENT_PAGES = new Set([
  "events.html", "event-details.html", "booking.html",
  "confirmation.html", "my-booking.html", "dashboard.html"
]);

function safeStudentNext(value) {
  if (!value || value.includes("..") || value.includes("\\") || value.startsWith("/")) return "";
  try {
    const target = new URL(value, location.href);
    const page = target.pathname.split("/").pop();
    if (target.origin !== location.origin || !STUDENT_PAGES.has(page)) return "";
    return `${page}${target.search}`;
  } catch (_) {
    return "";
  }
}

export async function destinationFor(user, params = new URLSearchParams(location.search)) {
  if (await isAdmin(user)) return "admin.html";
  return safeStudentNext(params.get("next")) || "../index.html";
}

// ---------------------------------------------------------------------------
// Login page behaviour (only runs on pages that render #studentAuthForm).
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("studentAuthForm");
  if (!form) return;

  const error = document.getElementById("loginError");
  const status = document.getElementById("loginStatus");
  const submit = document.getElementById("btnLogin");
  const email = document.getElementById("studentEmail");
  const password = document.getElementById("studentPassword");
  const params = new URLSearchParams(location.search);
  
  let selectedRole = "student";

document.getElementById("studentLoginMode")?.addEventListener("click", () => {
    selectedRole = "student";

    document.getElementById("studentLoginMode").classList.add("active");
    document.getElementById("adminLoginMode").classList.remove("active");

    document.getElementById("loginTitle").textContent = "Student Login";
    document.querySelector(".login-panel-subtitle").textContent =
        "Sign in to explore events and reserve your auditorium seats.";

    document.getElementById("authModeToggle").hidden = false;
    error.hidden = true;
});

document.getElementById("adminLoginMode")?.addEventListener("click", () => {
    selectedRole = "admin";

    document.getElementById("adminLoginMode").classList.add("active");
    document.getElementById("studentLoginMode").classList.remove("active");

    document.getElementById("loginTitle").textContent = "Admin Login";
    document.querySelector(".login-panel-subtitle").textContent =
        "Authorized administrators only.";

    document.getElementById("authModeToggle").hidden = true;
    form.dataset.mode = "login";
    submit.textContent = "Sign in";
    error.hidden = true;
});
  let leaving = false;

  const say = message => { if (error) { error.textContent = message; error.hidden = false; } if (status) status.hidden = true; };
  const note = message => { if (status) { status.textContent = message; status.hidden = false; } if (error) error.hidden = true; };

  // Sends the account to its home: admin panel for admins, main index for students.
  async function route(user, message) {
    const adminUser = await isAdmin(user);

if (selectedRole === "admin" && !adminUser) {
    await signOut(auth);
    leaving = false;
    return say("Access denied. This account is not an administrator.");
}

if (selectedRole === "student" && adminUser) {
    leaving = false;
    return say("Please select Admin Login for this account.");
}
    if (leaving) return;
    leaving = true;
    if (message) note(message);
    try { location.href = await destinationFor(user, params); }
    catch (_) { leaving = false; say("Could not open your dashboard. Please try again."); }
  }

  if (!isFirebaseReady) say("Firebase is not configured. Set window.CAMPUSSEAT_FIREBASE_CONFIG to your Firebase web app config.");

  // Already signed in? Skip the form and go straight to the right page.
  if (isFirebaseReady) {
    const stop = onAuthStateChanged(auth, user => {
      if (user) route(user, "Welcome back — taking you to your dashboard…");
    });
    window.addEventListener("pagehide", () => stop(), { once: true });
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!isFirebaseReady) return say("Firebase is not configured yet.");
    error.hidden = true; submit.disabled = true; submit.textContent = "Signing in…";
    try {
      const cred = form.dataset.mode === "register"
        ? await createUserWithEmailAndPassword(auth, email.value.trim(), password.value)
        : await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
      await route(cred.user, "Signed in — opening your dashboard…");
    } catch (err) {
      say(authMessage(err));
      submit.disabled = false;
      submit.textContent = form.dataset.mode === "register" ? "Create account" : "Sign in";
    }
  });

  document.getElementById("googleLogin")?.addEventListener("click", async e => {
    if (!isFirebaseReady) return say("Firebase is not configured yet.");
    const button = e.currentTarget;
    button.disabled = true; button.textContent = "Opening Google…";
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      await route(cred.user, "Signed in — opening your dashboard…");
    } catch (err) {
      say(authMessage(err));
      button.disabled = false; button.textContent = "Continue with Google";
    }
  });

  document.getElementById("forgotPassword")?.addEventListener("click", async () => {
    if (!isFirebaseReady) return say("Firebase is not configured yet.");
    if (!email.value.trim()) return say("Enter your email address first.");
    try {
      await sendPasswordResetEmail(auth, email.value.trim());
      note("Password reset email sent. Check your inbox.");
    } catch (err) { say(authMessage(err)); }
  });

  document.getElementById("togglePassword")?.addEventListener("click", e => {
    const showing = password.type === "text";
    password.type = showing ? "password" : "text";
    e.currentTarget.textContent = showing ? "Show" : "Hide";
    e.currentTarget.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });

  document.getElementById("authModeToggle")?.addEventListener("click", e => {
    const register = form.dataset.mode !== "register";
    form.dataset.mode = register ? "register" : "login";
    submit.textContent = register ? "Create account" : "Sign in";
    document.getElementById("loginTitle").textContent = register ? "Create your student account" : "Sign in to CampusSeat";
    e.currentTarget.textContent = register ? "I already have an account" : "Create an account";
    password.autocomplete = register ? "new-password" : "current-password";
    error.hidden = true;
  });
});

function authMessage(e) {
  return ({
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/email-already-in-use": "An account already exists for this email.",
    "auth/weak-password": "Use a password with at least 6 characters.",
    "auth/popup-closed-by-user": "Google sign-in closed before it finished.",
    "auth/popup-blocked": "Your browser blocked the Google popup. Allow popups and retry.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "auth/network-request-failed": "Network error. Check your connection and retry.",
    "auth/unauthorized-domain": "This website domain is not authorized in Firebase. Open Firebase Console → Authentication → Settings → Authorized domains, then add localhost and your deployed domain.",
    "auth/operation-not-allowed": "This sign-in method is disabled. Enable Google or Email/Password in Firebase Console → Authentication → Sign-in method.",
    "auth/account-exists-with-different-credential": "An account already exists with this email using another sign-in method. Sign in with that method first."
  })[e?.code] || e?.message || "Sign in failed. Please try again.";
}


