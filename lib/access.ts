import { ADMIN_EMAIL, normalizeEmail } from "./grade.ts";

export const ADMIN_OWNER_ID = `grade-studio:admin:${ADMIN_EMAIL}`;

export type Identity = { userId: string; email: string; provider: "chatgpt" | "google" };

export function isAdmin(user: Identity | null): boolean {
  return !!user && normalizeEmail(user.email) === ADMIN_EMAIL;
}

export function isStudent(user: Identity | null): boolean {
  return !!user && user.provider === "google" && !isAdmin(user);
}
