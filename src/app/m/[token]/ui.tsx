import Link from "next/link";

type Tab = "inbox" | "reviews" | "stats";

/** Page frame with the bottom tab bar, like the LeadConnector app. */
export function AppShell({ token, active, unread, title, action, children }: { token: string; active: Tab; unread: number; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          {action}
        </div>
      </header>
      <main className="mx-auto max-w-xl pb-28">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto grid max-w-xl grid-cols-3">
          <NavItem href={`/m/${token}`} label="Inbox" on={active === "inbox"} badge={unread} icon={<path d="M3 13h4l2 3h6l2-3h4M5 5h14l2 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z" />} />
          <NavItem href={`/m/${token}/reviews`} label="Reviews" on={active === "reviews"} icon={<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />} />
          <NavItem href={`/m/${token}/stats`} label="Results" on={active === "stats"} icon={<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />} />
        </div>
      </nav>
    </>
  );
}

function NavItem({ href, label, on, badge, icon }: { href: string; label: string; on: boolean; badge?: number; icon: React.ReactNode }) {
  return (
    <Link href={href} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${on ? "text-[#2a78d6]" : "text-neutral-500"}`}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {icon}
      </svg>
      {label}
      {!!badge && <span className="absolute left-1/2 top-1 ml-2 min-w-5 rounded-full bg-red-500 px-1.5 text-center text-[10px] font-bold leading-5 text-white">{badge > 99 ? "99+" : badge}</span>}
    </Link>
  );
}

export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null;
  return (
    <p className={`mx-4 mt-3 rounded-xl p-3 text-sm ${ok ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`} role={ok ? "status" : "alert"}>
      {ok ?? err}
    </p>
  );
}

export function Avatar({ name, phone }: { name: string | null; phone: string }) {
  const initials = name ? name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") : "#";
  const hue = [...phone].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: `hsl(${hue} 55% 48%)` }}>
      {initials}
    </span>
  );
}
