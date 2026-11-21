import { db, type Client } from "@/lib/supabase";
import { clientLabel } from "@/lib/clients";

export const dynamic = "force-dynamic";

/** Per-client web app manifest, so "Add to Home Screen" opens straight into their own dashboard. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/.test(token)) return new Response("Not found", { status: 404 });
  const { data: c } = await db().from("clients").select("business_name, full_name, email").eq("dashboard_token", token).maybeSingle<Pick<Client, "business_name" | "full_name" | "email">>();
  if (!c) return new Response("Not found", { status: 404 });
  return Response.json(
    {
      name: `${clientLabel(c)} · Calls & reviews`,
      short_name: "Calls & reviews",
      start_url: `/m/${token}`,
      scope: `/m/${token}`,
      display: "standalone",
      background_color: "#f6f6f4",
      theme_color: "#2a78d6",
      icons: [
        { src: "/api/app-icon?s=192", sizes: "192x192", type: "image/png" },
        { src: "/api/app-icon?s=512", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
