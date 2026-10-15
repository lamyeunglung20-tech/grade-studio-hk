import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { verifyGoogleFirebaseToken } from "../lib/firebase-token.ts";

test("Google Firebase tokens require the correct signature, project, issuer and provider", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: "google-user-1",
    email: "teacher@example.com",
    email_verified: true,
    name: "Teacher",
    auth_time: now - 30,
    firebase: { sign_in_provider: "google.com" },
  };
  const makeToken = (values = claims, audience = "grade-app", issuer = "https://securetoken.google.com/grade-app") =>
    new SignJWT(values).setProtectedHeader({ alg: "RS256", kid: "test" }).setIssuer(issuer).setAudience(audience).setIssuedAt(now - 30).setExpirationTime(now + 3600).sign(privateKey);

  assert.deepEqual(await verifyGoogleFirebaseToken(await makeToken(), "grade-app", publicKey), {
    userId: "firebase:grade-app:google-user-1", displayName: "Teacher", email: "teacher@example.com", provider: "google",
  });
  await assert.rejects(verifyGoogleFirebaseToken(await makeToken(claims, "another-app"), "grade-app", publicKey));
  await assert.rejects(verifyGoogleFirebaseToken(await makeToken(claims, "grade-app", "https://securetoken.google.com/another-app"), "grade-app", publicKey));
  assert.equal(await verifyGoogleFirebaseToken(await makeToken({ ...claims, firebase: { sign_in_provider: "password" } }), "grade-app", publicKey), null);
  assert.equal(await verifyGoogleFirebaseToken(await makeToken({ ...claims, email_verified: false }), "grade-app", publicKey), null);
  const expired = await new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "test" }).setIssuer("https://securetoken.google.com/grade-app").setAudience("grade-app").setIssuedAt(now - 3600).setExpirationTime(now - 1).sign(privateKey);
  await assert.rejects(verifyGoogleFirebaseToken(expired, "grade-app", publicKey));
  const other = await generateKeyPair("RS256");
  await assert.rejects(verifyGoogleFirebaseToken(await makeToken(), "grade-app", other.publicKey));
});
