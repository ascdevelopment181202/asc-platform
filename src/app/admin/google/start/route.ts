import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { googleAuthUrl } from "@/lib/google";

export const dynamic = "force-dynamic";

/** Sends you to Google to connect the ASC account (admin only, via proxy auth). */
export async function GET() {
  const state = randomBytes(16).toString("hex");
  (await cookies()).set("g_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/admin/google", maxAge: 600 });
  return Response.redirect(googleAuthUrl(state), 302);
}
