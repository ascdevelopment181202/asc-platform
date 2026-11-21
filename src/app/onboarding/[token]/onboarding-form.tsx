"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { createClient } from "@supabase/supabase-js";
import { DAYS, LEAD_DELIVERY, MAX_FILE_MB, MAX_PHOTOS, TRADES, VISIT_OPTIONS, type OnboardingInput } from "@/lib/onboarding-fields";
import { getUploadTargets, submitOnboarding } from "./actions";

const BUCKET = "client-assets";
const UPLOADS_AT_ONCE = 4;

type Props = {
  token: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  managerEmail: string;
  defaults: Pick<OnboardingInput, "businessName" | "contactName" | "mobile" | "email">;
};

type Values = Omit<OnboardingInput, "logoPath" | "photoPaths">;
type Photo = { id: string; file: File; preview: string };

/**
 * Onboarding form: a short set of essentials, one drop zone for photos, and everything else tucked
 * into an optional section. Files upload straight to storage in parallel before the answers are saved.
 */
export function OnboardingForm({ token, supabaseUrl, supabaseAnonKey, managerEmail, defaults }: Props) {
  const supabase = useMemo(() => createClient(supabaseUrl, supabaseAnonKey), [supabaseUrl, supabaseAnonKey]);
  const [values, setValues] = useState<Values>({
    ...defaults,
    customersCallMobile: "" as Values["customersCallMobile"],
    customersCallNumber: "",
    trade: "" as Values["trade"],
    tradeOther: "",
    services: "",
    areas: "",
    hoursDays: [1, 2, 3, 4, 5],
    hoursStart: "08:00",
    hoursEnd: "18:00",
    emergency: "" as Values["emergency"],
    hours: "",
    address: "",
    customersVisit: "",
    yearsTrading: "",
    accreditations: "",
    different: "",
    competitors: "",
    noLogo: false,
    brandColours: "",
    reviewsLink: "",
    currentWebsite: "",
    websiteHost: "",
    domain: "",
    domainRegistrar: "",
    gbpManagerAdded: false,
    facebook: "",
    leadDelivery: "",
    capacity: "",
    unwantedJobs: "",
  });
  const [logo, setLogo] = useState<File | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  // Free the thumbnail memory when the form unmounts (removed photos are freed in removePhoto).
  const photosRef = useRef<Photo[]>([]);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  const clearError = (key: string) => setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)));
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    clearError(key as string);
  };

  function addPhotos(list: FileList | File[] | null) {
    if (!list) return;
    const all = Array.from(list);
    const images = all.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    const tooBig = images.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    const ok = images.filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024);
    setPhotos((current) => {
      const room = MAX_PHOTOS - current.length;
      const added = ok.slice(0, room).map((file) => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file) }));
      return [...current, ...added];
    });
    const notes = [
      all.length > images.length ? `${all.length - images.length} file(s) weren't photos` : "",
      tooBig.length ? `${tooBig.length} photo(s) over ${MAX_FILE_MB} MB were skipped` : "",
      photos.length + ok.length > MAX_PHOTOS ? `only the first ${MAX_PHOTOS} photos are kept` : "",
    ].filter(Boolean);
    setErrors((e) => ({ ...e, photoPaths: notes.join(", ") }));
    if (!notes.length) clearError("photoPaths");
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const gone = current.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.preview);
      return current.filter((p) => p.id !== id);
    });
  }

  async function uploadAll(): Promise<{ logoPath: string; photoPaths: string[] }> {
    const files = [
      ...(logo && !values.noLogo ? [{ file: logo, kind: "logo" as const }] : []),
      ...photos.map((p) => ({ file: p.file, kind: "photo" as const })),
    ];
    if (files.length === 0) return { logoPath: "", photoPaths: [] };

    const res = await getUploadTargets(token, files.map(({ file, kind }) => ({ name: file.name, size: file.size, kind })));
    if (!res.ok) throw new Error(res.error);

    // Upload a few at a time so 30 photos take seconds, not minutes.
    const paths: string[] = new Array(files.length);
    let next = 0;
    let finished = 0;
    setStatus(`Uploading photos... 0 of ${files.length}`);
    const worker = async () => {
      while (next < files.length) {
        const i = next++;
        const target = res.targets[i];
        const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(target.path, target.token, files[i].file, {
          contentType: files[i].file.type || undefined,
        });
        if (error) throw new Error(`Upload failed for ${files[i].file.name}. Please try again.`);
        paths[i] = target.path;
        setStatus(`Uploading photos... ${++finished} of ${files.length}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOADS_AT_ONCE, files.length) }, worker));
    const hasLogo = files[0]?.kind === "logo";
    return { logoPath: hasLogo ? paths[0] : "", photoPaths: hasLogo ? paths.slice(1) : paths };
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    startTransition(async () => {
      try {
        const uploads = await uploadAll();
        setStatus("Saving your answers...");
        const result = await submitOnboarding(token, { ...values, ...uploads });
        if (result.ok) {
          setDone(true);
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          setErrors(result.fieldErrors ?? {});
          setFormError(result.error);
        }
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      } finally {
        setStatus("");
      }
    });
  }

  if (done) {
    return (
      <div className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-8">
        <h2 className="text-2xl font-semibold">Thanks, your build has started</h2>
        <p className="mt-3 text-neutral-700">You&apos;ll be live within 48 hours. We&apos;ve emailed you a confirmation.</p>
        <p className="mt-3 text-neutral-700">
          We&apos;ll also text you a link to your <strong>inbox app</strong>, where missed calls and customer messages land, plus a short code to switch on missed-call texts.
        </p>
      </div>
    );
  }

  const toggleDay = (d: number) =>
    set("hoursDays", (values.hoursDays ?? []).includes(d) ? (values.hoursDays ?? []).filter((x) => x !== d) : [...(values.hoursDays ?? []), d].sort());

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-8" noValidate>
      <Section title="The essentials" hint="About 2 minutes. This is all we need to start.">
        <Text label="Business name, as it should appear on Google" name="businessName" values={values} set={set} errors={errors} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Text label="Your name" name="contactName" values={values} set={set} errors={errors} />
          <Text label="Your mobile" hint="Where we send your app link and alerts" name="mobile" type="tel" values={values} set={set} errors={errors} />
        </div>
        <Choice label="Is this the number customers call you on?" name="customersCallMobile" options={["Yes", "No"] as const} values={values} set={set} errors={errors} />
        {values.customersCallMobile === "No" && (
          <Text label="Which number do customers call?" hint="The one on your van, website or Google listing" name="customersCallNumber" type="tel" values={values} set={set} errors={errors} />
        )}
        <Text label="Email" name="email" type="email" values={values} set={set} errors={errors} />
        <Choice label="Your trade" name="trade" options={TRADES} values={values} set={set} errors={errors} />
        {values.trade === "Other" && <Text label="What's your trade?" name="tradeOther" values={values} set={set} errors={errors} />}
        <Area label="Services you offer" hint="One per line, most profitable first" name="services" values={values} set={set} errors={errors} />
        <Area label="Towns and postcodes you cover" hint="Main area first" rows={2} name="areas" values={values} set={set} errors={errors} />

        <div>
          <Label text="Opening hours" hint="Missed calls outside these hours get a 'we're closed, we'll call you first thing' text" />
          <div className="mt-2 flex flex-wrap gap-2">
            {DAYS.map((d, i) => {
              const on = (values.hoursDays ?? []).includes(i + 1);
              return (
                <button key={d} type="button" onClick={() => toggleDay(i + 1)} className={`w-14 rounded-full border py-2 text-sm ${on ? "border-blue-700 bg-blue-700 text-white" : "border-neutral-300 bg-white"}`}>
                  {d}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <input type="time" value={values.hoursStart} onChange={(e) => set("hoursStart", e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-2" />
            <span>to</span>
            <input type="time" value={values.hoursEnd} onChange={(e) => set("hoursEnd", e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-2" />
          </div>
          <FieldError message={errors.hoursDays || errors.hoursStart || errors.hoursEnd} />
        </div>
        <Choice label="Do you take emergency call-outs?" name="emergency" options={["Yes", "No"] as const} values={values} set={set} errors={errors} />
      </Section>

      <Section title="Photos" hint="Optional. Skip it and we'll use the photos from your website and Google.">
        <DropZone onFiles={addPhotos} count={photos.length} />
        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {photos.map((p) => (
              <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg bg-neutral-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt="" className="size-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/40 px-1 text-[10px] text-white">{p.file.name}</span>
                <button type="button" onClick={() => removePhoto(p.id)} aria-label={`Remove ${p.file.name}`} className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-sm text-white">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <FieldError message={errors.photoPaths} />
      </Section>

      <details className="group rounded-2xl border border-neutral-200 bg-white">
        <summary className="cursor-pointer list-none p-6">
          <span className="text-lg font-semibold">More about your business</span>
          <span className="ml-2 text-sm text-neutral-500">(optional, helps your site and Google ranking)</span>
          <span className="float-right text-neutral-400 group-open:rotate-180">▾</span>
        </summary>
        <div className="space-y-5 px-6 pb-6">
          <div className="rounded-xl bg-blue-50 p-4 text-sm text-neutral-800">
            <p className="font-medium">Recommended: add us to your Google Business Profile</p>
            <p className="mt-1">
              Open your profile on Google, go to Business Profile settings, then Managers, and add <span className="font-medium">{managerEmail}</span> as a Manager.{" "}
              <a className="text-blue-700 underline" href="https://support.google.com/business/answer/3403100" target="_blank" rel="noreferrer">
                Step-by-step guide
              </a>
            </p>
            <Check label="I've added you as a manager" checked={!!values.gbpManagerAdded} onChange={(v) => set("gbpManagerAdded", v)} />
          </div>
          <Text label="Link to your Google reviews" hint="On your Google profile: 'Ask for reviews', then copy the link" optional name="reviewsLink" values={values} set={set} errors={errors} />
          <Text label="Business address" hint="Leave blank if you work from home and don't want it shown" optional name="address" values={values} set={set} errors={errors} />
          <Choice label="Do customers come to you, or do you go to them?" name="customersVisit" options={VISIT_OPTIONS} values={values} set={set} errors={errors} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Text label="Years trading" optional name="yearsTrading" values={values} set={set} errors={errors} />
            <Text label="Accreditations and guarantees" hint="Gas Safe, NICEIC, Which? Trusted Traders..." optional name="accreditations" values={values} set={set} errors={errors} />
          </div>
          <Area label="What makes you different from other local firms?" optional rows={2} name="different" values={values} set={set} errors={errors} />
          <Area label="2 or 3 competitors you'd like to beat on Google" optional rows={2} name="competitors" values={values} set={set} errors={errors} />

          <div>
            <Label text="Your logo" optional />
            {!values.noLogo && (
              <input
                type="file"
                accept="image/*,.svg,.pdf,.ai,.eps"
                onChange={(e) => {
                  setLogo(e.target.files?.[0] ?? null);
                  clearError("logoPath");
                }}
                className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-4 file:py-2 file:text-white"
              />
            )}
            <Check label="I don't have a logo" checked={!!values.noLogo} onChange={(v) => set("noLogo", v)} />
            <FieldError message={errors.logoPath} />
          </div>
          <Text label="Brand colours" optional name="brandColours" values={values} set={set} errors={errors} />

          <div className="grid gap-5 sm:grid-cols-2">
            <Text label="Current website" optional name="currentWebsite" values={values} set={set} errors={errors} />
            <Text label="Where it's hosted" optional name="websiteHost" values={values} set={set} errors={errors} />
            <Text label="Domain name" optional name="domain" values={values} set={set} errors={errors} />
            <Text label="Where the domain is registered" hint="GoDaddy, 123 Reg..." optional name="domainRegistrar" values={values} set={set} errors={errors} />
          </div>
          <Text label="Facebook page" optional name="facebook" values={values} set={set} errors={errors} />

          <Choice label="How do you want new leads sent to you?" name="leadDelivery" options={LEAD_DELIVERY} values={values} set={set} errors={errors} />
          <Text label="Roughly how many extra jobs a month could you take on?" optional name="capacity" values={values} set={set} errors={errors} />
          <Area label="Any jobs you don't want?" hint="For example, small repairs under a set price" optional rows={2} name="unwantedJobs" values={values} set={set} errors={errors} />
        </div>
      </details>

      {formError && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-blue-700 px-6 py-4 text-base font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
        {pending ? status || "Submitting..." : "Submit and start my build"}
      </button>
    </form>
  );
}

// ---------- photo drop zone ----------

function DropZone({ onFiles, count }: { onFiles: (files: FileList | null) => void; count: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(e.dataTransfer.files);
      }}
      onClick={() => input.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${over ? "border-blue-600 bg-blue-50" : "border-neutral-300 bg-neutral-50 hover:border-neutral-400"}`}
    >
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="text-neutral-400" aria-hidden>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="M21 16l-5-5-8 8" />
      </svg>
      <p className="mt-3 font-medium">{count ? "Add more photos" : "Drop all your photos here"}</p>
      <p className="mt-1 text-sm text-neutral-500">
        Or tap to choose. Select as many as you like at once (up to {MAX_PHOTOS}): jobs, your van, your team.
      </p>
      {count > 0 && <p className="mt-2 text-sm font-medium text-blue-700">{count} added</p>}
      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ---------- small field components ----------

type FieldProps<K extends keyof Values> = {
  label: string;
  name: K;
  values: Values;
  set: <T extends keyof Values>(key: T, value: Values[T]) => void;
  errors: Record<string, string>;
  hint?: string;
  optional?: boolean;
};

const inputClass = "mt-2 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-6">
      <legend className="px-1 text-lg font-semibold">{title}</legend>
      {hint && <p className="-mt-3 text-sm text-neutral-500">{hint}</p>}
      {children}
    </fieldset>
  );
}

function Label({ text, hint, optional }: { text: string; hint?: string; optional?: boolean }) {
  return (
    <span className="block text-sm font-medium text-neutral-800">
      {text}
      {optional && <span className="font-normal text-neutral-500"> (optional)</span>}
      {hint && <span className="mt-0.5 block font-normal text-neutral-500">{hint}</span>}
    </span>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1.5 text-sm text-red-600">{message}</p> : null;
}

function Text<K extends keyof Values>({ label, name, values, set, errors, hint, optional, type = "text" }: FieldProps<K> & { type?: string }) {
  return (
    <label className="block">
      <Label text={label} hint={hint} optional={optional} />
      <input type={type} value={String(values[name] ?? "")} onChange={(e) => set(name, e.target.value as Values[K])} className={inputClass} />
      <FieldError message={errors[name as string]} />
    </label>
  );
}

function Area<K extends keyof Values>({ label, name, values, set, errors, hint, optional, rows = 4 }: FieldProps<K> & { rows?: number }) {
  return (
    <label className="block">
      <Label text={label} hint={hint} optional={optional} />
      <textarea rows={rows} value={String(values[name] ?? "")} onChange={(e) => set(name, e.target.value as Values[K])} className={inputClass} />
      <FieldError message={errors[name as string]} />
    </label>
  );
}

function Choice<K extends keyof Values>({ label, name, values, set, errors, options }: FieldProps<K> & { options: readonly string[] }) {
  return (
    <div>
      <Label text={label} />
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => {
          const active = values[name] === o;
          return (
            <button
              key={o}
              type="button"
              onClick={() => set(name, o as Values[K])}
              className={`rounded-full border px-4 py-2 text-sm ${active ? "border-blue-700 bg-blue-700 text-white" : "border-neutral-300 bg-white hover:border-neutral-400"}`}
            >
              {o}
            </button>
          );
        })}
      </div>
      <FieldError message={errors[name as string]} />
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mt-3 flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      {label}
    </label>
  );
}
