import { z } from "zod";

// Shared by the form (client) and the server action, so both validate the same way.

export const TRADES = ["Plumbing", "Heating", "Plumbing and heating", "Electrical", "Roofing", "HVAC", "Other"] as const;
export const VISIT_OPTIONS = ["We go to them", "They come to us", "Both"] as const;
export const LEAD_DELIVERY = ["SMS", "Email", "Both"] as const;

export const MIN_PHOTOS = 5;
export const MAX_PHOTOS = 15;
export const MAX_FILE_MB = 15;

const text = (label: string) => z.string().trim().min(1, `${label} is required`);
const optional = z.string().trim().optional().default("");

export const onboardingSchema = z
  .object({
    // Business details
    businessName: text("Business name"),
    contactName: text("Your name"),
    mobile: text("Mobile number"),
    email: z.string().trim().email("Enter a valid email"),
    trade: z.enum(TRADES, { message: "Choose your trade" }),
    tradeOther: optional,
    services: text("Services"),
    areas: text("Areas you cover"),
    address: text("Business address"),
    customersVisit: z.enum(VISIT_OPTIONS, { message: "Choose one" }),
    hours: text("Opening hours"),
    emergency: z.enum(["Yes", "No"], { message: "Choose one" }),
    yearsTrading: optional,
    accreditations: optional,
    different: text("What makes you different"),
    competitors: optional,
    // Assets
    noLogo: z.boolean().default(false),
    brandColours: optional,
    reviewsLink: optional,
    // Access
    currentWebsite: optional,
    websiteHost: optional,
    domain: optional,
    domainRegistrar: optional,
    gbpManagerAdded: z.boolean().default(false),
    facebook: optional,
    // Leads
    leadDelivery: z.enum(LEAD_DELIVERY, { message: "Choose how you want leads" }),
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
    if (!v.noLogo && !v.logoPath) {
      ctx.addIssue({ code: "custom", path: ["logoPath"], message: "Upload your logo, or tick that you don't have one" });
    }
    if (v.photoPaths.length < MIN_PHOTOS) {
      ctx.addIssue({ code: "custom", path: ["photoPaths"], message: `Upload at least ${MIN_PHOTOS} photos` });
    }
  });

export type OnboardingInput = z.input<typeof onboardingSchema>;
export type OnboardingData = z.output<typeof onboardingSchema>;

/** Human labels, used for the admin view and the notification email. */
export const FIELD_LABELS: Record<string, string> = {
  businessName: "Business name",
  contactName: "Contact name",
  mobile: "Mobile",
  email: "Email",
  trade: "Trade",
  tradeOther: "Trade (other)",
  services: "Services",
  areas: "Areas covered",
  address: "Address",
  customersVisit: "Customers visit",
  hours: "Opening hours",
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
