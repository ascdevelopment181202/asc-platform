import "server-only";
import { db } from "@/lib/supabase";
import type { ApplyInfo } from "./types";

const BUCKET = "seo-shots";
const PACK = process.env.SEO_CHROMIUM_PACK_URL || "https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar";

type Leaf = { sig: string; w: number; h: number };
type Snap = { status: number; leaves: Leaf[]; phoneTop: boolean; cta: boolean; overflow: boolean; shot: Buffer };

const VIEWS = [
  { label: "Mobile", width: 390, height: 844, isMobile: true },
  { label: "Desktop", width: 1280, height: 800, isMobile: false },
];

/** Runs in the page: the visible text blocks and images, and whether the phone and a call to action are in view. */
function fingerprint() {
  const leaves: { sig: string; w: number; h: number }[] = [];
  document.querySelectorAll("h1,h2,h3,h4,p,li,img,button,a").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "a" && el.querySelector("h1,h2,h3,h4,p,img,li")) return;
    const text = tag === "img" ? (el as HTMLImageElement).currentSrc.split("/").pop() ?? "" : (el.textContent ?? "").trim().slice(0, 50);
    if (!text) return;
    leaves.push({ sig: `${tag}:${text}`, w: Math.round(r.width), h: Math.round(r.height) });
  });
  const tel = Array.from(document.querySelectorAll('a[href^="tel:"]')).some((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.top < window.innerHeight * 1.2 && r.bottom > 0;
  });
  const cta = /get a (free )?quote|free quote|call (us|now|today)|book|request|contact|enquir/i.test(document.body.innerText.slice(0, 3000));
  return { leaves, phoneTop: tel, cta, overflow: document.documentElement.scrollWidth > window.innerWidth + 4 };
}

async function ensureBucket() {
  const { data } = await db().storage.getBucket(BUCKET);
  if (!data) await db().storage.createBucket(BUCKET, { public: false });
}

/**
 * Screenshots the live page and the preview on mobile and desktop and compares them.
 * Anything that can't be checked comes back as "needs a look", which never auto-applies.
 */
export async function visualCheck(actionId: string, liveUrl: string, previewUrl: string, opts: { isNewPage?: boolean } = {}): Promise<NonNullable<ApplyInfo["visual"]>> {
  let browser: import("puppeteer-core").Browser | null = null;
  try {
    const [{ default: chromium }, puppeteer] = await Promise.all([import("@sparticuz/chromium-min"), import("puppeteer-core")]);
    browser = await puppeteer.launch({ args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }), executablePath: await chromium.executablePath(PACK), headless: "shell" });
    const snap = async (url: string, v: (typeof VIEWS)[number]): Promise<Snap> => {
      const page = await browser!.newPage();
      await page.setViewport({ width: v.width, height: v.height, isMobile: v.isMobile, deviceScaleFactor: 1 });
      const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
      const f = await page.evaluate(fingerprint);
      const shot = Buffer.from(await page.screenshot({ type: "jpeg", quality: 60, fullPage: true, clip: undefined }));
      await page.close();
      return { status: res?.status() ?? 0, ...f, shot };
    };
    await ensureBucket();
    const problems: string[] = [];
    const shots: NonNullable<NonNullable<ApplyInfo["visual"]>["shots"]> = [];
    for (const v of VIEWS) {
      const after = await snap(previewUrl, v);
      const before = opts.isNewPage ? null : await snap(liveUrl, v);
      const save = async (name: string, buf: Buffer) => {
        const path = `${actionId}/${v.label.toLowerCase()}-${name}.jpg`;
        await db().storage.from(BUCKET).upload(path, buf, { upsert: true, contentType: "image/jpeg" });
        return path;
      };
      shots.push({ label: v.label, before: before ? await save("before", before.shot) : undefined, after: await save("after", after.shot) });
      if (after.status >= 400 || after.status === 0) problems.push(`${v.label}: the preview page returned an error (${after.status}).`);
      if (after.overflow && !before?.overflow) problems.push(`${v.label}: the page now scrolls sideways.`);
      if (!before) continue;
      if (before.phoneTop && !after.phoneTop) problems.push(`${v.label}: the phone number is no longer visible at the top.`);
      if (before.cta && !after.cta) problems.push(`${v.label}: the call to action is no longer visible.`);
      const afterBySig = new Map(after.leaves.map((l) => [l.sig, l]));
      const gone = before.leaves.filter((l) => !afterBySig.has(l.sig));
      const moved = before.leaves.filter((l) => {
        const a = afterBySig.get(l.sig);
        return a && (Math.abs(a.w - l.w) > 6 || Math.abs(a.h - l.h) > 6);
      });
      if (gone.length > 2) problems.push(`${v.label}: ${gone.length} existing pieces of content disappeared (for example "${gone[0].sig.split(":")[1]}").`);
      if (moved.length > 3) problems.push(`${v.label}: ${moved.length} existing elements changed size, so the layout shifted.`);
    }
    return { ok: !problems.length, note: problems.length ? problems.join(" ") : "Only the edited part changed. Phone number and call to action still visible on mobile and desktop.", shots };
  } catch (err) {
    return { ok: false, note: `The visual check couldn't run (${err instanceof Error ? err.message.slice(0, 140) : "unknown error"}). Open the preview and look before approving.` };
  } finally {
    await browser?.close().catch(() => null);
  }
}

export async function shotUrl(path: string): Promise<string | null> {
  const { data } = await db().storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
