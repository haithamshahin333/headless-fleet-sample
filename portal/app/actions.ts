"use server"

import { signIn, signOut, DEV_LOGIN, DEV_PERSONAS } from "@/auth"

function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "/"
  // Only same-site relative paths — never an open redirect.
  return n.startsWith("/") && !n.startsWith("//") ? n : "/"
}

export async function loginWithOidc(form: FormData) {
  await signIn("oidc", { redirectTo: safeNext(form.get("next")) })
}

export async function loginAsDevPersona(form: FormData) {
  if (!DEV_LOGIN) throw new Error("dev login is disabled")
  const persona = String(form.get("persona") ?? "")
  if (!DEV_PERSONAS[persona]) throw new Error("unknown persona")
  await signIn("dev", { persona, redirectTo: safeNext(form.get("next")) })
}

export async function logout() {
  await signOut({ redirectTo: "/login" })
}
