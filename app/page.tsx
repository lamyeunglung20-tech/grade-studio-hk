import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "./chatgpt-auth";
import { env } from "cloudflare:workers";
import GoogleAuthGate from "./google-auth-gate";
import Studio from "./studio";
import { isAdmin } from "../lib/access";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_API_KEY && env.FIREBASE_APP_ID && env.FIREBASE_AUTH_DOMAIN) {
    return <GoogleAuthGate config={{ projectId: env.FIREBASE_PROJECT_ID, apiKey: env.FIREBASE_API_KEY, appId: env.FIREBASE_APP_ID, authDomain: env.FIREBASE_AUTH_DOMAIN }} chatgptUser={user ? { userId: user.userId, displayName: user.displayName, email: user.email } : null} chatgptSignInPath={chatGPTSignInPath("/")} chatgptSignOutPath={chatGPTSignOutPath("/")} />;
  }
  if (!user || !isAdmin({ ...user, provider: "chatgpt" })) return <main className="login-page"><div className="login-card"><div className="logo">▥</div><p className="eyebrow">GRADE STUDIO</p><h1>成績分析室</h1><p>Google 登入暫時無法使用，請稍後重試。</p></div></main>;
  return <Studio displayName={user.displayName} userId={user.userId} signOutPath={chatGPTSignOutPath("/")} />;
}
