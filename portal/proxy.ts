// Next.js 16 renamed `middleware` to `proxy`. Auth.js's `auth` is the handler; its
// `authorized` callback (auth.ts) gates pages. API routes check the session themselves.
export { auth as proxy } from "@/auth"

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)"],
}
