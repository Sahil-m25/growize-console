/* Passes the request path to the server components (the root layout reads it to know when a fresh
   load of "/" starts a new test case in FIXTURE_MODE=local). No state lives here.
   M18-S15-H1: every page's Content-Security-Policy, with a fresh nonce — set on the request too, which is
   where Next reads the nonce it stamps on its own inline scripts (so script-src needs no 'unsafe-inline').
   The policy's sources come only from ../security-headers.mjs. */
import { NextResponse, type NextRequest } from "next/server";
import { pageCsp } from "../security-headers.mjs";

const nonceOf = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b));
};

export function middleware(req: NextRequest) {
  const h = new Headers(req.headers);
  h.set("x-gz-path", req.nextUrl.pathname);
  const csp = pageCsp(nonceOf(), { dev: process.env.NODE_ENV === "development" });
  h.set("content-security-policy", csp);
  /* a test run's lane (fixture mode): ?lane=x on the first load, kept in a cookie for the API calls */
  const lane = req.nextUrl.searchParams.get("lane");
  if (lane !== null) h.set("x-gz-lane", lane);
  const res = NextResponse.next({ request: { headers: h } });
  res.headers.set("Content-Security-Policy", csp);
  if (lane !== null) res.cookies.set("gz_lane", lane, { path: "/", sameSite: "lax" });
  return res;
}

export const config = { matcher: ["/((?!_next/|api/|favicon).*)"] };
