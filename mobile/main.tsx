import React from "react";
import { createRoot } from "react-dom/client";
import { getApps, initializeApp } from "firebase/app";
import GoogleAuthGate from "../app/google-auth-gate";
import { createFirebaseGradeBackend } from "../lib/firebase-grade-backend";
import "../app/globals.css";

const config = {
  apiKey: "AIzaSyDlcj9J8xERbJtksYf0vIGjzrsKpJXUW6c",
  authDomain: "grade-studio-hk.firebaseapp.com",
  projectId: "grade-studio-hk",
  appId: "1:33040793632:web:00e48588afebcf6d1bbc45",
};
const app = getApps().find(item => item.name === "grade-studio") ?? initializeApp(config, "grade-studio");
const backend = createFirebaseGradeBackend(app);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GoogleAuthGate config={config} chatgptUser={null} chatgptSignInPath="" chatgptSignOutPath="/" backend={backend} />
  </React.StrictMode>,
);
