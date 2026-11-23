// Shared types for the SEO autopilot. Pure: no I/O, safe to import from tests and client components.

export type SiteType = "vercel" | "hosted" | "wordpress" | "other";

/** What the AI is allowed to state about a business. Anything not here is left as a gap for Ayush. */
export type FactSheet = {
  businessName?: string;
  phone?: string;
  email?: string;
  address?: string;
  yearsTrading?: string;
  accreditations?: string[];
  guarantees?: string;
  priceRanges?: string; // "Block paving from £85 per m²"
  team?: string;
  about?: string;
  confirmed?: boolean; // Ayush has checked it
};

export type AutoApply = { titles?: boolean; schema?: boolean; faq?: boolean; posts?: boolean };

export type SeoConfig = {
  domain?: string; // "picdriveways.com"
  siteType?: SiteType;
  siteId?: string; // hosted sites: sites.id
  githubRepo?: string; // "owner/repo"
  githubBranch?: string;
  wpUrl?: string;
  wpUser?: string;
  wpPasswordEnc?: string;
  gscProperty?: string;
  gbpLocation?: string; // "locations/123"
  gbpAccount?: string; // "accounts/9"
  bingSite?: string;
  trade?: string; // "driveways"
  country?: "GB" | "US";
  services?: string[];
  towns?: string[];
  brandTerms?: string[];
  ignoreCompetitors?: string[];
  facts?: FactSheet;
  profiles?: Record<string, string>; // sameAs links: { facebook: "https://..." }
  autoApply?: AutoApply;
  aiBudgetGbp?: number;
  jobValueGbp?: number;
  enquiryRate?: number; // 0.05 = 5 in 100 visitors enquire
  clientReport?: boolean;
  lat?: number;
  lng?: number;
};

export type Health = { checkedAt?: string; up?: boolean; status?: number; tlsDaysLeft?: number | null; domainDaysLeft?: number | null; error?: string };

export type ConnState = "ok" | "partial" | "missing";
export type Connection = { key: string; label: string; state: ConnState; unlocks: string; steps: string[]; message?: string; detail?: string };

export type Baseline = { at: string; clicks?: number; impressions?: number; position?: number; calls?: number; reviews?: number; rating?: number; aiNamed?: number; aiAsked?: number };

export type SeoState = {
  health?: Health;
  baseline?: Baseline;
  gsc?: { ok: boolean; error?: string; at: string; tooEarly?: boolean };
  gbp?: { ok: boolean; write?: boolean; error?: string; at: string; profile?: GbpProfile };
  github?: { ok: boolean; error?: string; at: string };
  crawl?: { at: string; pages: number; tracking: boolean; error?: string };
  speed?: { at: string; mobile?: number; lcp?: number };
  lastError?: string;
  lastRunAt?: string;
  progress?: string; // "Reading Search Console..." while the first audit runs
  brand?: { brandClicks: number; otherClicks: number };
  weather?: { at: string; alert?: string };
};

export type GbpProfile = {
  title?: string;
  primaryCategory?: string;
  categories?: string[];
  description?: string;
  hasHours?: boolean;
  services?: number;
  website?: string;
  phone?: string;
  serviceAreas?: string[];
  lastPostAt?: string | null;
};

export type SeoSettings = {
  client_id: string;
  enabled: boolean;
  paused: boolean;
  config: SeoConfig;
  state: SeoState;
  tracking_token: string;
  last_run_on: string | null;
  last_weekly_on: string | null;
  last_monthly_on: string | null;
  setup_done_at: string | null;
};

// ---------- Metrics ----------

export type Row = { key: string; clicks: number; impressions: number; position: number };
export type QueryPage = { query: string; page: string; clicks: number; impressions: number; position: number };
export type Pair = { cur: Row[]; prev: Row[] };
export type WeekPoint = { week: string; clicks: number; impressions: number; position: number; calls?: number; directions?: number; websiteClicks?: number };

// ---------- Actions ----------

export type ActionType = "Profile" | "Page" | "Content" | "Reviews" | "Technical" | "AI search" | "Manual";
export type Confidence = "High" | "Medium" | "Low";
export type Effort = "1 click" | "5 min manual" | "30 min manual";

export type ChainStep = { label: string; value: string; assumed?: boolean };

export type Evidence = {
  why: string; // one or two sentences with numbers and dates
  numbers?: { label: string; value: string }[];
  series?: { label: string; points: { week: string; value: number }[] };
  competitor?: string;
  page?: string;
  query?: string;
  queries?: string[];
};

export type ActionDetail = {
  evidence: Evidence;
  gain: { clicks?: number; calls?: number; gbp?: number };
  chain: ChainStep[];
  confidence: Confidence;
  effort: Effort;
  risk: "Low" | "Medium" | "High";
  undoable: boolean;
  autoOk?: boolean; // one of the safe kinds that auto-apply may handle
  links?: { label: string; url: string }[];
  alert?: boolean; // site down, crawlers blocked, disconnected: pinned to the top
};

export type ManualStep = { text: string; copy?: string; url?: string };

export type Draft = {
  target?: "site" | "profile" | "review" | "manual" | "email";
  page?: string; // path on the site
  fields?: { name: string; label: string; before: string; after: string }[];
  html?: string; // a block to add (FAQ section, answer block, new page body)
  files?: { path: string; content: string }[]; // whole files to add or replace (llms.txt, robots.txt)
  blocks?: { page: string; label: string; html: string }[]; // several small additions in one change (the launch check)
  steps?: ManualStep[];
  minutes?: number;
  note?: string; // gaps the AI left for Ayush
  needsAi?: boolean; // waiting for the AI to write it
};

export type ApplyInfo = {
  mode?: "pr" | "direct" | "list";
  prNumber?: number;
  prUrl?: string;
  branch?: string;
  previewUrl?: string;
  build?: "pending" | "ok" | "failed";
  visual?: { ok: boolean; note: string; shots?: { label: string; before?: string; after?: string }[] };
  changeList?: string;
  error?: string;
};

export type Measured = { at: string; verdict: "worked" | "no change" | "worse" | "too early"; text: string; before?: number; after?: number; control?: number };

export type SeoAction = {
  id: string;
  client_id: string;
  kind: string;
  type: ActionType;
  status: "new" | "approved" | "applied" | "dismissed" | "snoozed" | "failed" | "done";
  dedupe_key: string;
  score: number;
  summary: string;
  detail: ActionDetail;
  draft: Draft | null;
  apply: ApplyInfo | null;
  undo: unknown;
  result: Measured | null;
  goal: string | null;
  dismissed_reason: string | null;
  snoozed_until: string | null;
  applied_at: string | null;
  measure_at: string | null;
  created_at: string;
  updated_at: string;
};

/** What a detector hands back before it becomes an inbox row. */
export type Finding = {
  kind: string;
  type: ActionType;
  dedupe: string;
  summary: string;
  detail: ActionDetail;
  draft?: Draft;
};

export type SeoChange = {
  id: string;
  client_id: string;
  action_id: string | null;
  target: string;
  summary: string;
  before: unknown;
  after: unknown;
  undo: unknown;
  auto: boolean;
  undone_at: string | null;
  created_at: string;
};

export type Competitor = { placeId: string; name: string; rating?: number; reviews?: number; category?: string; website?: string; isClient?: boolean };
export type CompetitorCheck = { query: string; checkedOn: string; clientRank: number | null; top: Competitor[] };

export type AiCheck = { id?: string; checked_on: string; provider: string; question: string; named: boolean; sources: { title?: string; url: string }[]; excerpt: string | null };

export type Plan = { goals: { goal: string; why: string; measure: string; serves?: ActionType[] }[]; priorities: string[]; stop: string[]; summary: string };
export type WeeklyReview = { diagnosis: string; plan: string[] };

export type GoogleUpdate = { date: string; name: string };

export type MonthResult = { month: string; profileCalls: number; directions: number; profileWebsite: number; ascCalls: number; enquiries: number; siteCalls: number; forms: number; aiVisits: number; searchVisits: number };

export const LATEST_WEEK = "2000-01-03";

export const TYPE_ORDER: ActionType[] = ["Profile", "Reviews", "Technical", "Page", "AI search", "Content", "Manual"];
