"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  LEAD_DELIVERY,
  MAX_FILE_MB,
  MAX_PHOTOS,
  MIN_PHOTOS,
  TRADES,
  VISIT_OPTIONS,
  type OnboardingInput,
} from "@/lib/onboarding-fields";
import { getUploadTargets, submitOnboarding } from "./actions";

const BUCKET = "client-assets";

type Props = {
  token: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  managerEmail: string;
  defaults: Pick<OnboardingInput, "businessName" | "contactName" | "mobile" | "email">;
};

type Values = Omit<OnboardingInput, "logoPath" | "photoPaths">;

export function OnboardingForm({ token, supabaseUrl, supabaseAnonKey, managerEmail, defaults }: Props) {
  const supabase = useMemo(() => createClient(supabaseUrl, supabaseAnonKey), [supabaseUrl, supabaseAnonKey]);
  const [values, setValues] = useState<Values>({
    ...defaults,
    trade: "" as Values["trade"],
    tradeOther: "",
    services: "",
    areas: "",
    address: "",
    customersVisit: "" as Values["customersVisit"],
    hours: "",
    emergency: "" as Values["emergency"],
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
    leadDelivery: "" as Values["leadDelivery"],
    capacity: "",
    unwantedJobs: "",
  });
  const [logo, setLogo] = useState<File | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const clearError = (key: string) =>
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)));

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    clearError(key as string);
  };

  function addPhotos(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024);
    setPhotos((p) => [...p, ...incoming].slice(0, MAX_PHOTOS));
    clearError("photoPaths");
  }

  async function uploadAll(): Promise<{ logoPath: string; photoPaths: string[] }> {
    const files = [
      ...(logo && !values.noLogo ? [{ file: logo, kind: "logo" as const }] : []),
      ...photos.map((file) => ({ file, kind: "photo" as const })),
    ];
    if (files.length === 0) return { logoPath: "", photoPaths: [] };

    const res = await getUploadTargets(
      token,
      files.map(({ file, kind }) => ({ name: file.name, size: file.size, kind })),
    );
    if (!res.ok) throw new Error(res.error);

    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setStatus(`Uploading file ${i + 1} of ${files.length}...`);
      const target = res.targets[i];
      const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(target.path, target.token, files[i].file, {
        contentType: files[i].file.type || undefined,
      });
      if (error) throw new Error(`Upload failed for ${files[i].file.name}. Please try again.`);
      paths.push(target.path);
    }
    const hasLogo = files[0]?.kind === "logo";
    return { logoPath: hasLogo ? paths[0] : "", photoPaths: hasLogo ? paths.slice(1) : paths };
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const local: Record<string, string> = {};
    if (!values.noLogo && !logo) local.logoPath = "Upload your logo, or tick that you don't have one";
    if (photos.length < MIN_PHOTOS) local.photoPaths = `Upload at least ${MIN_PHOTOS} photos`;
    if (Object.keys(local).length) {
      setErrors((er) => ({ ...er, ...local }));
      setFormError("Please fix the highlighted fields.");
      return;
    }

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
        <p className="mt-3 text-neutral-700">
          You&apos;ll be live within 48 hours. We&apos;ve emailed you a confirmation.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-8" noValidate>
      <Section title="Your business">
        <Text label="Business name, as it should appear on Google" name="businessName" values={values} set={set} errors={errors} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Text label="Your name" name="contactName" values={values} set={set} errors={errors} />
          <Text label="Mobile" name="mobile" type="tel" values={values} set={set} errors={errors} />
        </div>
        <Text label="Email" name="email" type="email" values={values} set={set} errors={errors} />
        <Choice label="Your trade" name="trade" options={TRADES} values={values} set={set} errors={errors} />
        {values.trade === "Other" && <Text label="What's your trade?" name="tradeOther" values={values} set={set} errors={errors} />}
        <Area label="Services you offer" hint="One per line, most profitable first" name="services" values={values} set={set} errors={errors} />
        <Area label="Towns and postcodes you cover" hint="Main area first" name="areas" values={values} set={set} errors={errors} />
        <Text label="Business address" name="address" values={values} set={set} errors={errors} />
        <Choice label="Do customers come to you, or do you go to them?" name="customersVisit" options={VISIT_OPTIONS} values={values} set={set} errors={errors} />
        <Area label="Opening hours" rows={2} name="hours" values={values} set={set} errors={errors} />
        <Choice label="Do you take emergency call-outs?" name="emergency" options={["Yes", "No"] as const} values={values} set={set} errors={errors} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Text label="Years trading" optional name="yearsTrading" values={values} set={set} errors={errors} />
          <Text label="Accreditations and guarantees" hint="Gas Safe, NICEIC, Which? Trusted Traders..." optional name="accreditations" values={values} set={set} errors={errors} />
        </div>
        <Area label="What makes you different from other local firms?" hint="A sentence or two" name="different" values={values} set={set} errors={errors} />
        <Area label="2 or 3 competitors you'd like to beat on Google" optional rows={2} name="competitors" values={values} set={set} errors={errors} />
      </Section>

      <Section title="Logo and photos">
        <div>
          <Label text="Your logo" />
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
        <div>
          <Label text={`Photos of recent jobs, your van or your team (${MIN_PHOTOS} to ${MAX_PHOTOS})`} />
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => addPhotos(e.target.files)}
            className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-4 file:py-2 file:text-white"
          />
          {photos.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-neutral-700">
              {photos.map((p, i) => (
                <li key={`${p.name}-${i}`} className="flex items-center justify-between rounded-lg bg-neutral-100 px-3 py-1.5">
                  <span className="truncate">{p.name}</span>
                  <button type="button" className="ml-3 text-neutral-500 hover:text-red-600" onClick={() => setPhotos((ph) => ph.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm text-neutral-500">
            {photos.length} added{photos.length < MIN_PHOTOS ? `, at least ${MIN_PHOTOS - photos.length} more needed` : ""}
          </p>
          <FieldError message={errors.photoPaths} />
        </div>
        <Text label="Brand colours" hint="If you have them" optional name="brandColours" values={values} set={set} errors={errors} />
        <Text label="Link to your Google reviews, or another review site" optional name="reviewsLink" values={values} set={set} errors={errors} />
      </Section>

      <Section title="Access">
        <div className="grid gap-5 sm:grid-cols-2">
          <Text label="Current website" optional name="currentWebsite" values={values} set={set} errors={errors} />
          <Text label="Where it's hosted" optional name="websiteHost" values={values} set={set} errors={errors} />
          <Text label="Domain name" optional name="domain" values={values} set={set} errors={errors} />
          <Text label="Where the domain is registered" hint="GoDaddy, 123 Reg..." optional name="domainRegistrar" values={values} set={set} errors={errors} />
        </div>
        <div className="rounded-xl bg-blue-50 p-4 text-sm text-neutral-800">
          <p className="font-medium">Add us to your Google Business Profile</p>
          <p className="mt-1">
            Open your profile on Google, go to Business Profile settings, then Managers, and add{" "}
            <span className="font-medium">{managerEmail}</span> as a Manager.{" "}
            <a className="text-blue-700 underline" href="https://support.google.com/business/answer/3403100" target="_blank" rel="noreferrer">
              Step-by-step guide
            </a>
          </p>
          <Check label="I've added you as a manager" checked={!!values.gbpManagerAdded} onChange={(v) => set("gbpManagerAdded", v)} />
        </div>
        <Text label="Facebook page" optional name="facebook" values={values} set={set} errors={errors} />
      </Section>

      <Section title="Leads">
        <Choice label="How do you want new leads sent to you?" name="leadDelivery" options={LEAD_DELIVERY} values={values} set={set} errors={errors} />
        <Text label="Roughly how many extra jobs a month could you take on?" optional name="capacity" values={values} set={set} errors={errors} />
        <Area label="Any jobs you don't want?" hint="For example, small repairs under a set price" optional rows={2} name="unwantedJobs" values={values} set={set} errors={errors} />
      </Section>

      {formError && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-blue-700 px-6 py-4 text-base font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
      >
        {pending ? status || "Submitting..." : "Submit and start my build"}
      </button>
    </form>
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

const inputClass =
  "mt-2 block w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-base outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-6">
      <legend className="px-1 text-lg font-semibold">{title}</legend>
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
      <input
        type={type}
        value={String(values[name] ?? "")}
        onChange={(e) => set(name, e.target.value as Values[K])}
        className={inputClass}
      />
      <FieldError message={errors[name as string]} />
    </label>
  );
}

function Area<K extends keyof Values>({ label, name, values, set, errors, hint, optional, rows = 4 }: FieldProps<K> & { rows?: number }) {
  return (
    <label className="block">
      <Label text={label} hint={hint} optional={optional} />
      <textarea
        rows={rows}
        value={String(values[name] ?? "")}
        onChange={(e) => set(name, e.target.value as Values[K])}
        className={inputClass}
      />
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
