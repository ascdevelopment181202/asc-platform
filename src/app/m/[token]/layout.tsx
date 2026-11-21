import type { Metadata, Viewport } from "next";
import { clientLabel } from "@/lib/clients";
import { loadClient } from "./data";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const c = await loadClient(token);
  return {
    title: c ? `${clientLabel(c)} · Inbox` : "Inbox",
    robots: { index: false, follow: false },
    manifest: `/m/${token}/manifest`,
    appleWebApp: { capable: true, title: "Inbox", statusBarStyle: "default" },
    icons: { apple: "/api/app-icon?s=180", icon: "/api/app-icon?s=192" },
  };
}

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-[#f4f5f7] text-neutral-900 antialiased">{children}</div>;
}
