import { NextResponse, type NextRequest } from "next/server";

/** Hosts that serve the platform itself. Any other host is a client's custom domain. */
function isPlatformHost(host: string) {
  const appHost = (process.env.APP_URL ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return host === appHost || host.endsWith(".vercel.app") || host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const { pathname } = request.nextUrl;

  // Client custom domain: serve their site from /s/<domain>/...
  if (host && !isPlatformHost(host)) {
    if (pathname.startsWith("/s/") || pathname.startsWith("/admin") || pathname.startsWith("/onboarding")) {
      return new NextResponse("Not found", { status: 404 });
    }
    const url = request.nextUrl.clone();
    const path = pathname === "/sitemap.xml" ? "/sitemap" : pathname === "/robots.txt" ? "/robots" : pathname;
    url.pathname = `/s/${host.replace(/^www\./, "")}${path === "/" ? "" : path}`;
    return NextResponse.rewrite(url);
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) return adminAuth(request);
  return NextResponse.next();
}

/** Password-protects /admin with HTTP Basic auth (any username, password = ADMIN_PASSWORD). */
function adminAuth(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return new NextResponse("ADMIN_PASSWORD is not set", { status: 500 });

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (given.length === password.length && timingSafeEqual(given, password)) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ASC Admin"' },
  });
}

function timingSafeEqual(a: string, b: string) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Everything except Next internals, API routes, the shared kit assets and static files.
// robots.txt and sitemap.xml do go through, so each client domain gets its own.
export const config = { matcher: ["/((?!_next/|api/|kit/|favicon.ico|.*\\.(?:png|jpe?g|gif|svg|webp|ico|css|js|woff2?)$).*)"] };
