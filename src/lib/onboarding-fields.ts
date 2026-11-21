import { z } from "zod";

// Shared by the form (client) and the server action, so both validate the same way.

export const TRADES = ["Plumbing", "Heating", "Plumbing and heating", "Electrical", "Roofing", "HVAC", "Other"] as const;
export const VISIT_OPTIONS = ["We go to them", "They come to us", "Both"] as const;
export const LEAD_DELIVERY = ["SMS", "Email", "Both"] as const;

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const MAX_PHOTOS = 40;
export const MAX_FILE_MB = 20;

const text = (label: string) => z.string().trim().min(1, `${label} is required`);
const optional = z.string().trim().optional().default("");
/** A choice that can be left unanswered. */
const optionalChoice = <T extends readonly [string, ...string[]]>(options: T) => z.union([z.enum(options), z.literal("")]).optional().default("");
const time = z.string().regex(/^\d{2}:\d{2}$/, "Choose a time");

export const onboardingSchema = z
  .object({
    // ---- Essentials (required) ----
    businessName: text("Business name"),
    contactName: text("Your name"),
    mobile: text("Mobile number"),
    customersCallMobile: z.enum(["Yes", "No"], { message: "Choose one" }),
    customersCallNumber: optional, // only when customers ring a different number
    email: z.string().trim().email("Enter a valid email"),
    trade: z.enum(TRADES, { message: "Choose your trade" }),
    tradeOther: optional,
    services: text("Services"),
    areas: text("Areas you cover"),
    hoursDays: z.array(z.number().int().min(1).max(7)).min(1, "Pick the days you work"),
    hoursStart: time,
    hoursEnd: time,
    emergency: z.enum(["Yes", "No"], { message: "Choose one" }),
    // ---- Optional extras ----
    hours: optional, // filled in from the days and times above
    address: optional,
    customersVisit: optionalChoice(VISIT_OPTIONS),
    yearsTrading: optional,
    accreditations: optional,
    different: optional,
    competitors: optional,
    noLogo: z.boolean().default(false),
    brandColours: optional,
    reviewsLink: optional,
    currentWebsite: optional,
    websiteHost: optional,
    domain: optional,
    domainRegistrar: optional,
    gbpManagerAdded: z.boolean().default(false),
    facebook: optional,
    leadDelivery: optionalChoice(LEAD_DELIVERY),
    capacity: optional,
    unwantedJobs: optional,
    // Uploads (storage paths, issued by the server)
    logoPath: z.string().optional().default(""),
    photoPaths: z.array(z.string()).max(MAX_PHOTOS).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.trade === "Other" && !v.tradeOther) {
      ctx.addIssue({ code: "custom", path: ["tradeOther"], message: "Tell us your trade" });
    }
    if (v.customersCallMobile === "No" && !v.customersCallNumber) {
      ctx.addIssue({ code: "custom", path: ["customersCallNumber"], message: "Which number do customers call?" });
    }
    if (v.hoursStart >= v.hoursEnd) {
      ctx.addIssue({ code: "custom", path: ["hoursEnd"], message: "Closing time must be after opening time" });
    }
  });

/** "Mon to Fri, 8:00 to 18:00" style summary of the opening hours picker. */
export function describeHours(days: number[], start: string, end: string) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    const a = DAYS[sorted[i] - 1];
    const b = DAYS[sorted[j] - 1];
    runs.push(j - i >= 2 ? `${a} to ${b}` : j > i ? `${a}, ${b}` : a);
    i = j;
  }
  return `${runs.join(", ")}, ${start} to ${end}`;
}

export type OnboardingInput = z.input<typeof onboardingSchema>;
export type OnboardingData = z.output<typeof onboardingSchema>;

/** Human labels, used for the admin view and the notification email. */
export const FIELD_LABELS: Record<string, string> = {
  businessName: "Business name",
  contactName: "Contact name",
  mobile: "Mobile",
  customersCallMobile: "Customers call this mobile",
  customersCallNumber: "Number customers call",
  email: "Email",
  trade: "Trade",
  tradeOther: "Trade (other)",
  services: "Services",
  areas: "Areas covered",
  address: "Address",
  customersVisit: "Customers visit",
  hours: "Opening hours",
  hoursDays: "Days open",
  hoursStart: "Opens",
  hoursEnd: "Closes",
  emergency: "Emergency call-outs",
  yearsTrading: "Years trading",
  accreditations: "Accreditations and guarantees",
  different: "What makes them different",
  competitors: "Competitors",
  noLogo: "No logo",
  brandColours: "Brand colours",
  reviewsLink: "Reviews link",
  currentWebsite: "Current website",
  websiteHost: "Website host",
  domain: "Domain",
  domainRegistrar: "Domain registrar",
  gbpManagerAdded: "Added us as Google Business Profile manager",
  facebook: "Facebook",
  leadDelivery: "Lead delivery",
  capacity: "Jobs a month they can take",
  unwantedJobs: "Jobs they don't want",
};
