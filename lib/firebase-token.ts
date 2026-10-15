import { createRemoteJWKSet, jwtVerify } from "jose";

const firebaseKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));

export async function verifyGoogleFirebaseToken(token: string, projectId: string, keys: Parameters<typeof jwtVerify>[1] = firebaseKeys) {
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ["RS256"],
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`,
  });
  const firebase = payload.firebase as Record<string, unknown> | undefined;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128 ||
      typeof payload.email !== "string" || payload.email_verified !== true ||
      !firebase || firebase.sign_in_provider !== "google.com" ||
      typeof payload.iat !== "number" || payload.iat > now ||
      typeof payload.auth_time !== "number" || payload.auth_time > now) return null;
  return {
    userId: `firebase:${projectId}:${payload.sub}`,
    displayName: typeof payload.name === "string" && payload.name.trim() ? payload.name : payload.email,
    email: payload.email,
    provider: "google" as const,
  };
}
