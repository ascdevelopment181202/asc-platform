import { ImageResponse } from "next/og";

/** Home screen icon for the client dashboard: a check mark on ASC blue. */
export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get("s"));
  const size = [180, 192, 512].includes(requested) ? requested : 192;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#2a78d6" }}>
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400, immutable" } },
  );
}
