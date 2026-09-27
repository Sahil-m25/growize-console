/* Passes the request path to the server components (the root layout reads it to know when a fresh
   load of "/" starts a new test case in FIXTURE_MODE=local). No state lives here. */
import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const h = new Headers(req.headers);
  h.set("x-gz-path", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: h } });
}

export const config = { matcher: ["/((?!_next/|api/|favicon).*)"] };
