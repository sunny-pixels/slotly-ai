"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/server/auth";
import { isDemoAccountKey } from "@/lib/demo-accounts";

/** Only same-origin relative paths are accepted as destinations (no open redirects). */
function safePath(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/";
}

export async function continueAsAction(formData: FormData) {
  const account = formData.get("account");
  const redirectTo = safePath(formData.get("callbackUrl"));
  if (!isDemoAccountKey(account)) return;
  try {
    await signIn("demo", { account, redirectTo });
  } catch (error) {
    if (error instanceof AuthError) {
      console.error("[auth] demo sign-in failed:", error.type, error.message.slice(0, 300));
      return; // disabled or unseeded: stay where we are
    }
    throw error; // Next.js redirect signal
  }
}

export async function signOutAction(formData: FormData) {
  await signOut({ redirectTo: safePath(formData.get("callbackUrl")) });
}
