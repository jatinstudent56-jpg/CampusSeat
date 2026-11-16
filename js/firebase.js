// js/firebase.js

import { getApps, initializeApp } from
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
    getAuth
} from
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    getFirestore
} from
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const runtimeFirebaseConfig = typeof window !== "undefined"
    ? (window.CAMPUSSEAT_FIREBASE_CONFIG || {})
    : {};

const firebaseConfig = Object.freeze({
    apiKey: runtimeFirebaseConfig.apiKey || "AIzaSyDti0TuCd0mDY-vUEPe2KbtQKJRKgxNdjA",
    authDomain: runtimeFirebaseConfig.authDomain || "campusseat.firebaseapp.com",
    projectId: runtimeFirebaseConfig.projectId || "campusseat",
    storageBucket: runtimeFirebaseConfig.storageBucket || "campusseat.firebasestorage.app",
    messagingSenderId: runtimeFirebaseConfig.messagingSenderId || "86707900730",
    appId: runtimeFirebaseConfig.appId || "1:86707900730:web:bc19693403548b0b728003",
    measurementId: runtimeFirebaseConfig.measurementId || "G-FHDD8N4CSF"
});

const requiredConfigKeys = [
    "apiKey",
    "authDomain",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId"
];

let hasValidFirebaseConfig = requiredConfigKeys.every((key) => {
    const value = firebaseConfig[key];
    return typeof value === "string" && value.trim() !== "" && !value.includes("YOUR_");
});

let app = null;
let auth = null;
let db = null;
let firebaseError = null;

if (hasValidFirebaseConfig) {
    try {
        app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
    } catch (error) {
        firebaseError = error;
        hasValidFirebaseConfig = false;
        console.error("Firebase initialization failed:", error);
    }
}

const isFirebaseReady = Boolean(app && auth && db);


export {
    app,
    auth,
    db,
    firebaseError,
    hasValidFirebaseConfig,
    isFirebaseReady
};
