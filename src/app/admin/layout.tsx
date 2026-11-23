import Link from "next/link";
import { seoEnv } from "@/lib/env";

export const metadata = { title: "ASC Admin", robots: { index: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/admin" className="font-semibold">
            ASC Platform
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/admin" className="rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100">
              Clients
            </Link>
            {seoEnv.on() && (
              <Link href="/admin/seo" className="rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100">
                SEO
              </Link>
            )}
            <Link href="/admin/usage" className="rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100">
              Costs
            </Link>
            <Link href="/admin/guide" className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700">
              <span aria-hidden>🧭</span> Guide
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
