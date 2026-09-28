/* Passes the request path to the server components (the root layout reads it to know when a fresh
   load of "/" starts a new test case in FIXTURE_MODE=local). No state lives here. */
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const h = new Headers(req.headers);
  h.set("x-gz-path", req.nextUrl.pathname);
  /* a test run's lane (fixture mode): ?lane=x on the first load, kept in a cookie for the API calls */
  const lane = req.nextUrl.searchParams.get("lane");
  if (lane !== null) h.set("x-gz-lane", lane);
  const res = NextResponse.next({ request: { headers: h } });
  if (lane !== null) res.cookies.set("gz_lane", lane, { path: "/", sameSite: "lax" });
  return res;
}

export const config = { matcher: ["/((?!_next/|api/|favicon).*)"] };
