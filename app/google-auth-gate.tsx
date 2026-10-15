"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type Auth, type User } from "firebase/auth";
import { ADMIN_EMAIL, normalizeEmail } from "../lib/grade";
import Studio from "./studio";
import StudentPortal from "./student-portal";

type ChatGPTIdentity = { userId: string; displayName: string; email: string } | null;
type Props = {
  config: FirebaseOptions;
  chatgptUser: ChatGPTIdentity;
  chatgptSignInPath: string;
  chatgptSignOutPath: string;
};

export default function GoogleAuthGate({ config, chatgptUser, chatgptSignInPath, chatgptSignOutPath }: Props) {
  const authRef = useRef<Auth | null>(null);
  const [googleUser, setGoogleUser] = useState<User | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");

  useEffect(() => {
    try {
      const app = getApps().find(item => item.name === "grade-studio") ?? initializeApp(config, "grade-studio");
      const auth = getAuth(app);
      auth.languageCode = "zh-HK";
      authRef.current = auth;
      return onAuthStateChanged(auth, user => {
        if (!user) { setGoogleUser(null); return; }
        void user.getIdTokenResult().then(result => setGoogleUser(result.signInProvider === "google.com" ? user : null)).catch(() => { setGoogleUser(null); setError("未能核對 Google 登入，請重試。"); });
      }, () => { setGoogleUser(null); setError("未能讀取 Google 登入狀態。請重試。"); });
    } catch {
      queueMicrotask(() => { setGoogleUser(null); setError("Google 登入目前無法使用，請稍後重試。"); });
    }
  }, [config]);

  const getGoogleToken = useCallback(async () => {
    const user = authRef.current?.currentUser;
    if (!user) throw new Error("Google 登入已逾時，請重新登入。");
    return user.getIdToken();
  }, []);

  async function loginWithGoogle() {
    const auth = authRef.current;
    if (!auth) return;
    setBusy(true); setError("");
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (cause) {
      const code = (cause as { code?: string }).code;
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") setError("Google 登入未完成。請檢查彈出視窗和帳戶設定後重試。");
    } finally { setBusy(false); }
  }

  async function logoutGoogle() {
    if (authRef.current) await signOut(authRef.current);
    if (chatgptUser) location.assign(chatgptSignOutPath);
  }

  async function downloadPreviousData() {
    setError(""); setBackupMessage("");
    try {
      const response = await fetch("/api/legacy-document", { cache: "no-store", credentials: "same-origin" });
      const result = await response.json() as { document?: unknown; error?: string };
      if (!response.ok || !result.document) throw new Error(result.error || "未能讀取舊資料");
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.document, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = "成績分析室舊資料備份.json";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setBackupMessage("舊資料已下載。請用管理員 Google 帳戶登入後，選擇「匯入舊版 JSON 備份」。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "下載舊資料失敗"); }
  }

  if (googleUser === undefined) return <div className="loading">正在檢查登入狀態…</div>;
  if (googleUser && normalizeEmail(googleUser.email) === ADMIN_EMAIL) return <Studio key={`google:${googleUser.uid}`} displayName={googleUser.displayName || googleUser.email || "管理員"} userId={`firebase:${config.projectId}:${googleUser.uid}`} signOutPath="/" googleToken={getGoogleToken} onGoogleSignOut={logoutGoogle} />;
  if (googleUser) return <StudentPortal key={`student:${googleUser.uid}`} displayName={googleUser.displayName || googleUser.email || "學生"} email={googleUser.email || ""} getGoogleToken={getGoogleToken} onSignOut={logoutGoogle} />;
  if (chatgptUser && normalizeEmail(chatgptUser.email) === ADMIN_EMAIL) return <Studio key={`chatgpt:${chatgptUser.userId}`} displayName={chatgptUser.displayName} userId={chatgptUser.userId} signOutPath={chatgptSignOutPath} onGoogleSignIn={loginWithGoogle} />;

  return <main className="login-page"><div className="login-card"><div className="logo">▥</div><p className="eyebrow">GRADE STUDIO</p><h1>成績分析室</h1><p>管理員可整理班別和輸入分數；學生可用自己的 Google 帳戶查看考試紀錄與成績趨勢。</p><button className="button primary" disabled={busy} onClick={() => void loginWithGoogle()}>{busy ? "正在登入…" : "使用 Google 登入"}</button>{!chatgptUser && <a className="alternative-login" href={chatgptSignInPath} target="_top">管理員使用 ChatGPT 登入</a>}{chatgptUser && <button className="backup-link" onClick={() => void downloadPreviousData()}>下載此 ChatGPT 帳戶的舊資料</button>}{error && <p className="login-error" role="alert">{error}</p>}{backupMessage && <p className="backup-message" role="status">{backupMessage}</p>}<small>學生帳戶須由管理員先在名單中填入相同的電郵地址。</small></div></main>;
}
