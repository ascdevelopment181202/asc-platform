import Link from "next/link";

type Tab = "inbox" | "contacts" | "calendar" | "jobs" | "reviews" | "more";

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
        <div className="mx-auto grid max-w-xl grid-cols-5">
          <NavItem href={`/m/${token}`} label="Inbox" on={active === "inbox"} badge={unread} icon={<path d="M3 13h4l2 3h6l2-3h4M5 5h14l2 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z" />} />
          <NavItem href={`/m/${token}/calendar`} label="Calendar" on={active === "calendar"} icon={<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />} />
          <Link href={`/m/${token}/reviews`} aria-label="Reviews" className="relative -mt-5 flex flex-col items-center gap-0.5 pb-2 text-[11px] font-semibold">
            <span className={`flex size-14 items-center justify-center rounded-full text-white shadow-lg ring-4 ring-white ${active === "reviews" ? "bg-[#1f62b3]" : "bg-[#2a78d6]"}`}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2.8l2.8 5.7 6.3.9-4.55 4.43 1.07 6.27L12 17.1l-5.62 2.96 1.07-6.27L2.9 9.4l6.3-.9z" />
              </svg>
            </span>
            <span className={active === "reviews" ? "text-[#2a78d6]" : "text-neutral-700"}>Reviews</span>
          </Link>
          <NavItem href={`/m/${token}/contacts`} label="Contacts" on={active === "contacts" || active === "jobs"} icon={<path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM22 19v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8" />} />
          <NavItem href={`/m/${token}/more`} label="More" on={active === "more"} icon={<path d="M5 12h.01M12 12h.01M19 12h.01" />} />
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

/** Simple top bar with a back link, for detail pages. */
export function SubHeader({ back, title, action }: { back: string; title: string; action?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="mx-auto flex max-w-xl items-center gap-1 px-2 py-2">
        <Link href={back} aria-label="Back" className="flex size-10 items-center justify-center rounded-full active:bg-neutral-100">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-semibold">{title}</h1>
        {action}
      </div>
    </header>
  );
}

export function PlusButton({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} aria-label={label} className="flex size-10 items-center justify-center rounded-full bg-[#2a78d6] text-white shadow-sm active:bg-[#1f62b3]">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
        <path d="M12 5v14M5 12h14" />
      </svg>
    </Link>
  );
}

export const field = "w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base";
export const primaryBtn = "w-full rounded-xl bg-[#2a78d6] px-4 py-3.5 text-base font-semibold text-white active:bg-[#1f62b3]";
export const quietBtn = "w-full rounded-xl bg-white px-4 py-3 text-base font-medium text-neutral-800 ring-1 ring-neutral-300 active:bg-neutral-50";

export function Card({ title, children, action }: { title?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title && <h2 className="font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
