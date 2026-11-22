"use client";

import { useEffect, useState } from "react";

type State = "loading" | "unsupported" | "install" | "off" | "on" | "blocked" | "working";

const toKey = (base64: string) => {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Resolves once this registration has an active worker (pushManager.subscribe needs one). */
function whenActive(reg: ServiceWorkerRegistration): Promise<ServiceWorkerRegistration> {
  if (reg.active) return Promise.resolve(reg);
  const worker = reg.installing ?? reg.waiting;
  return new Promise((resolve) => {
    if (!worker) return resolve(reg);
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") resolve(reg);
    });
  });
}

/** Stops a step from hanging forever, so the button never sticks on "One moment". */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms))]);
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * Turns on push notifications for this phone. iPhones only allow it once the app is on the home screen,
 * so there we show the install steps instead. `compact` is the banner on the inbox; the full version lives on Results.
 */
export function NotificationsToggle({ token, publicKey, compact = false }: { token: string; publicKey: string; compact?: boolean }) {
  const [state, setState] = useState<State>("loading");
  const [note, setNote] = useState("");
  const scope = `/m/${token}`;

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(isIos() && !isInstalled() ? "install" : "unsupported");
        return;
      }
      if (isIos() && !isInstalled()) return setState("install");
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.register("/sw.js", { scope });
      const sub = await reg.pushManager.getSubscription();
      setState(sub && Notification.permission === "granted" ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, [scope]);

  async function turnOn() {
    setState("working");
    setNote("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off");
      // Wait on this registration itself, not navigator.serviceWorker.ready, which never resolves
      // when the open page sits outside the worker's scope.
      const reg = await withTimeout(navigator.serviceWorker.register("/sw.js", { scope }).then(whenActive), 15000, "Service worker");
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await withTimeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }), 20000, "Subscribe"));
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, subscription: sub.toJSON() }) });
      if (!res.ok) throw new Error("save failed");
      setState("on");
      await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    } catch (err) {
      console.error("Turn on notifications failed", err);
      setState("off");
      setNote("Couldn't turn notifications on. Close the app, open it again from the home screen icon and tap Turn on. If it still fails, ask ASC.");
    }
  }

  async function turnOff() {
    setState("working");
    const reg = await navigator.serviceWorker.getRegistration(scope);
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off");
  }

  async function sendTest() {
    setNote("Sending…");
    await fetch("/api/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    setNote("Sent. It should pop up in a few seconds.");
  }

  if (compact) {
    if (state !== "off" && state !== "install" && state !== "working") return null;
    return (
      <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl bg-[#2a78d6] p-3 text-white">
        <span className="text-xl" aria-hidden>🔔</span>
        <p className="flex-1 text-sm">{state === "install" ? "Add this app to your home screen to get notifications. See Results for how." : "Get notified about missed calls and new messages."}</p>
        {state !== "install" && (
          <button onClick={turnOn} disabled={state === "working"} className="shrink-0 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-[#2a78d6]">
            {state === "working" ? "…" : "Turn on"}
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Notifications</h2>
          <p className="text-sm text-neutral-600">
            {state === "on" && "On for this phone."}
            {state === "off" && "Get a notification for missed calls and new messages."}
            {state === "working" && "One moment…"}
            {state === "loading" && "Checking…"}
            {state === "install" && "On iPhone, add this app to your home screen first (steps below), then open it from the icon."}
            {state === "blocked" && "Blocked for this app. Turn them on in your phone's Settings, under this app or your browser."}
            {state === "unsupported" && "This browser can't show notifications. On Android use Chrome; on iPhone add the app to your home screen."}
          </p>
        </div>
        {(state === "off" || state === "working") && (
          <button onClick={turnOn} disabled={state === "working"} className="shrink-0 rounded-xl bg-[#2a78d6] px-4 py-2.5 text-sm font-semibold text-white">Turn on</button>
        )}
        {state === "on" && (
          <button onClick={turnOff} className="shrink-0 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-600 ring-1 ring-neutral-300">Turn off</button>
        )}
      </div>
      {state === "on" && (
        <button onClick={sendTest} className="mt-3 text-sm font-medium text-[#2a78d6]">Send a test notification</button>
      )}
      {note && <p className="mt-2 text-sm text-neutral-600">{note}</p>}
    </section>
  );
}
