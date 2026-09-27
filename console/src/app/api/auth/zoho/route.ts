/* /api/auth/zoho — "Continue with Zoho". Phase 1 stub: phase 2 turns this into the Zoho OAuth
   redirect and callback (every human on their own seat and token, D53). Until then it says so. */
export const dynamic = "force-dynamic";

const stub = () => Response.json({ wired: false, message: "Zoho sign-in is connected in phase 2." }, { status: 501 });
export const GET = stub;
export const POST = stub;
