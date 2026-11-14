import { cookies } from "next/headers";
import { connectGoogle } from "@/lib/google";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const expected = jar.get("g_state")?.value;
  jar.delete("g_state");
  const back = (msg: string) => Response.redirect(`${env.appUrl}/admin?google=${encodeURIComponent(msg)}`, 302);
  if (url.searchParams.get("error")) return back(`Google said: ${url.searchParams.get("error")}`);
  if (!expected || expected !== url.searchParams.get("state")) return back("That link expired. Try connecting again.");
  try {
    const email = await connectGoogle(url.searchParams.get("code") ?? "");
    return back(`Connected as ${email ?? "your Google account"}`);
  } catch (err) {
    return back(err instanceof Error ? err.message : "Couldn't connect Google");
  }
}
