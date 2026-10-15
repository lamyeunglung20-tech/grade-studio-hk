import { env } from "cloudflare:workers";
import { verifyGoogleFirebaseToken } from "../lib/firebase-token";
import { getChatGPTUser } from "./chatgpt-auth";

export type AppUser = {
  userId: string;
  displayName: string;
  email: string;
  provider: "chatgpt" | "google";
};

export async function getRequestUser(request: Request): Promise<AppUser | null> {
  const authorization = request.headers.get("Authorization");
  if (authorization !== null) {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId || !authorization.startsWith("Bearer ") || authorization.length > 10_000) return null;
    try { return await verifyGoogleFirebaseToken(authorization.slice(7), projectId); }
    catch { return null; }
  }
  const user = await getChatGPTUser();
  return user ? { userId: user.userId, displayName: user.displayName, email: user.email, provider: "chatgpt" } : null;
}
