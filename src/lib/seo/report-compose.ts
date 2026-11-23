// The client's weekly progress report, in their words. Pure: numbers in, plain sentences out.
// Rules: compare 4 weeks with the 4 before (single weeks jump around), leave out anything that isn't connected,
// and say a fall as plainly as a rise.
import type { AiCheck, CompetitorCheck, WeekPoint } from "./types";

export type Pair = { cur: number; prev: number };
export type ReportItem = { kind: string; page?: string; query?: string };

export type ReportInput = {
  name: string;
  firstName: string | null;
  weeks: WeekPoint[]; // oldest first; clicks and impressions from Search Console, calls and directions from the profile
  hasSearch: boolean;
  hasProfile: boolean;
  siteLeads: Pair | null; // call taps and forms on the website (tracking script)
  enquiries: Pair;
  textBacks: number; // missed calls answered with a text, last 4 weeks
  reviewRequests: number;
  reviewsNew7: number;
  reviewsNew28: number;
  reviewCount: number | null;
  rating: number | null;
  competitors: CompetitorCheck[];
  ranksBefore: Record<string, number | null>; // the earliest stored map position per search
  aiChecks: AiCheck[]; // the latest check only
  done: ReportItem[]; // went live in the last 7 days
  next: ReportItem[]; // biggest things in progress
};

export type ReportSection = { key: string; title: string; headline: string; lines: string[]; chart?: { label: string; points: { week: string; value: number }[] } };
export type ClientReport = { name: string; firstName: string | null; period: string; sections: ReportSection[]; done: string[]; next: string[] };

const sum = (rows: WeekPoint[], k: "clicks" | "impressions" | "calls" | "directions" | "websiteClicks") => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
const n = (x: number) => x.toLocaleString("en-GB");
export function versus(p: Pair): string {
  if (!p.prev && !p.cur) return "";
  if (!p.prev) return "the first we've counted";
  if (p.cur === p.prev) return `the same as the 4 weeks before`;
  return `${p.cur > p.prev ? "up" : "down"} from ${n(p.prev)} in the 4 weeks before`;
}
const page = (p?: string) => (!p || p === "/" || p === "*" ? "home" : p.replace(/^\//, "").replace(/[-/]+/g, " "));

/** What each kind of change means to the client, as something done and as something coming. */
const SAY: Record<string, { done: (i: ReportItem) => string; next: (i: ReportItem) => string }> = {
  title_rewrite: { done: (i) => `Rewrote how your ${page(i.page)} page appears on Google, so more people click it`, next: (i) => `A sharper Google listing for your ${page(i.page)} page` },
  meta_fix: { done: (i) => `Fixed how your ${page(i.page)} page appears on Google`, next: (i) => `Fixing how your ${page(i.page)} page appears on Google` },
  answer_block: { done: (i) => `Added answers to questions people search to your ${page(i.page)} page`, next: (i) => `Answering the questions people search on your ${page(i.page)} page` },
  faq_schema: { done: () => "Marked up your FAQs so Google and AI tools can quote them", next: () => "Marking up your FAQs for Google and AI tools" },
  new_page: { done: (i) => `Published a new page: ${page(i.page)}`, next: (i) => `A new page: ${page(i.page)}` },
  cost_guide: { done: () => "Published a cost guide for people comparing prices", next: () => "A cost guide for people comparing prices" },
  comparison: { done: () => "Published a comparison guide", next: () => "A comparison guide for people weighing options" },
  page_refresh: { done: (i) => `Refreshed your ${page(i.page)} page`, next: (i) => `Refreshing your ${page(i.page)} page` },
  page_boost: { done: (i) => `Strengthened your ${page(i.page)} page to push it up Google`, next: (i) => `Pushing your ${page(i.page)} page further up Google` },
  no_js_content: { done: () => "Made your website readable by ChatGPT and other AI search tools", next: () => "Making your website readable by ChatGPT and other AI search tools" },
  launch_check: { done: () => "Set up the technical basics so Google, Bing and AI tools can read your site properly", next: () => "Setting up the technical basics for Google, Bing and AI tools" },
  schema_local: { done: () => "Added your business details in the format Google and AI tools read", next: () => "Adding your business details in the format Google reads" },
  llms_txt: { done: () => "Added a summary of your business for AI tools", next: () => "A summary of your business for AI tools" },
  sitemap: { done: () => "Added a sitemap so Google finds every page", next: () => "A sitemap so Google finds every page" },
  tracking: { done: () => "Started counting calls and enquiries from your website", next: () => "Counting calls and enquiries from your website" },
  phone_click: { done: () => "Made your phone number one tap to call on mobiles", next: () => "Making your phone number one tap to call" },
  no_cta: { done: () => "Added a clear quote button to your home page", next: () => "A clearer quote button on your home page" },
  no_reviews_shown: { done: () => "Put your customer reviews on your website", next: () => "Putting your customer reviews on your website" },
  slow_site: { done: () => "Sped up your website on mobiles", next: () => "Speeding up your website on mobiles" },
  quotable: { done: () => "Added a clear facts and prices section to your site", next: () => "A clear facts and prices section for your site" },
  gbp_description: { done: () => "Rewrote your Google profile description", next: () => "A fuller Google profile description" },
  gbp_post: { done: () => "Published a post on your Google profile", next: () => "This week's post on your Google profile" },
  weather_post: { done: () => "Published a timely post on your Google profile ahead of the weather", next: () => "A timely post on your Google profile" },
  seasonal_post: { done: () => "Published a seasonal post on your Google profile", next: () => "A seasonal post on your Google profile" },
  gbp_categories: { done: () => "Added categories to your Google profile so it shows for more searches", next: () => "More categories on your Google profile" },
  gbp_hours: { done: () => "Added opening hours to your Google profile", next: () => "Opening hours on your Google profile" },
  gbp_services: { done: () => "Listed your services on your Google profile", next: () => "Your services listed on your Google profile" },
  gbp_service_area: { done: () => "Added more towns to your Google profile's service area", next: () => "More towns on your Google profile" },
  gbp_utm: { done: () => "Set up tracking on your Google profile's website link", next: () => "Tracking visits from your Google profile" },
  holiday_hours: { done: () => "Set your holiday hours on Google", next: () => "Your holiday hours on Google" },
  review_reply: { done: () => "Replied to a Google review", next: () => "Replying to your latest Google reviews" },
  citations: { done: () => "Listed your business on more directories", next: () => "Listing your business on the main directories" },
  link_outreach: { done: () => "Asked a local website to link to yours", next: () => "Getting local websites to link to yours" },
  map_rank: { done: () => "Worked on your Google Maps position", next: (i) => `Moving you up Google Maps${i.query ? ` for "${i.query}"` : ""}` },
};

function tally(items: ReportItem[], how: "done" | "next", max: number): string[] {
  const counts = new Map<string, number>();
  for (const i of items) {
    const say = SAY[i.kind]?.[how](i);
    if (say) counts.set(say, (counts.get(say) ?? 0) + 1);
  }
  return [...counts.entries()].slice(0, max).map(([text, c]) => (c > 1 && how === "done" ? `${text} (${c} times)` : text));
}

export function composeReport(i: ReportInput, period: string): ClientReport {
  const cur = i.weeks.slice(-4);
  const prev = i.weeks.slice(-8, -4);
  const sections: ReportSection[] = [];

  // Leads: every way a customer got in touch that we can count.
  const profileCalls: Pair = { cur: sum(cur, "calls"), prev: sum(prev, "calls") };
  const leadLines: string[] = [];
  if (i.hasProfile) {
    leadLines.push(`${n(profileCalls.cur)} calls from your Google profile${versus(profileCalls) ? `, ${versus(profileCalls)}` : ""}`);
    const dir: Pair = { cur: sum(cur, "directions"), prev: sum(prev, "directions") };
    if (dir.cur || dir.prev) leadLines.push(`${n(dir.cur)} people asked Google for directions to you`);
  }
  // Phone taps and forms on the website, however they were counted, as one figure.
  const web: Pair = { cur: (i.siteLeads?.cur ?? 0) + i.enquiries.cur, prev: (i.siteLeads?.prev ?? 0) + i.enquiries.prev };
  if (web.cur || web.prev) leadLines.push(`${n(web.cur)} calls and enquiries from your website${versus(web) ? `, ${versus(web)}` : ""}`);
  if (i.textBacks) leadLines.push(`${n(i.textBacks)} missed calls answered straight away with a text, so the customer didn't ring someone else`);
  const leads = (i.hasProfile ? profileCalls.cur : 0) + web.cur;
  if (leadLines.length) sections.push({ key: "leads", title: "Calls and enquiries", headline: leads ? `${n(leads)} calls and enquiries in the last 4 weeks` : "Counting has started", lines: leadLines, chart: i.hasProfile && i.weeks.some((w) => w.calls) ? { label: "Calls from your Google profile, by week", points: i.weeks.slice(-12).map((w) => ({ week: w.week, value: w.calls ?? 0 })) } : undefined });

  // Reviews.
  if (i.reviewCount !== null || i.reviewsNew28 || i.reviewRequests) {
    const lines: string[] = [];
    if (i.reviewsNew28) lines.push(`${n(i.reviewsNew28)} new Google review${i.reviewsNew28 === 1 ? "" : "s"} in the last 4 weeks${i.reviewsNew7 ? `, ${n(i.reviewsNew7)} of them this week` : ""}`);
    else lines.push("No new Google reviews in the last 4 weeks. Reviews are the biggest lever on Google Maps, so asking every happy customer matters.");
    if (i.reviewRequests) lines.push(`${n(i.reviewRequests)} review requests sent to customers after jobs`);
    const rival = i.competitors.flatMap((c) => c.top.filter((t) => !t.isClient && t.reviews)).sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0))[0];
    if (rival && i.reviewCount !== null) lines.push(rival.reviews! > i.reviewCount ? `The most-reviewed competitor nearby has ${n(rival.reviews!)}. Closing that gap is what moves you up the map.` : `You have more reviews than every competitor we track nearby.`);
    sections.push({ key: "reviews", title: "Google reviews", headline: i.reviewCount !== null ? `${n(i.reviewCount)} reviews${i.rating ? `, ${i.rating} stars` : ""}` : `${n(i.reviewsNew28)} new reviews`, lines });
  }

  // Google Maps.
  if (i.competitors.length) {
    const lines = i.competitors.slice(0, 4).map((c) => {
      const was = i.ranksBefore[c.query];
      const now = c.clientRank;
      const moved = was === undefined || was === now ? "" : was === null && now ? " (new on the first page of results)" : now && was ? (now < was ? `, up from ${was}` : `, down from ${was}`) : "";
      return `"${c.query}": ${now ? `position ${now}${moved}` : "not in the top 10 yet"}`;
    });
    const top3 = i.competitors.filter((c) => c.clientRank && c.clientRank <= 3).length;
    sections.push({ key: "maps", title: "Google Maps", headline: `In the top 3 for ${top3} of ${i.competitors.length} main searches`, lines: [...lines, "The top 3 on the map get most of the calls."] });
  }

  // Google search.
  if (i.hasSearch && i.weeks.some((w) => w.impressions)) {
    const clicks: Pair = { cur: sum(cur, "clicks"), prev: sum(prev, "clicks") };
    const seen: Pair = { cur: sum(cur, "impressions"), prev: sum(prev, "impressions") };
    sections.push({ key: "search", title: "Google search", headline: `${n(clicks.cur)} people clicked through from Google in the last 4 weeks`, lines: [`${n(clicks.cur)} clicks${versus(clicks) ? `, ${versus(clicks)}` : ""}`, `Your site was shown ${n(seen.cur)} times in Google's results${versus(seen) ? `, ${versus(seen)}` : ""}`], chart: { label: "Visitors from Google, by week", points: i.weeks.slice(-12).map((w) => ({ week: w.week, value: w.clicks })) } });
  }

  // AI search.
  if (i.aiChecks.length) {
    const named = i.aiChecks.filter((c) => c.named).length;
    sections.push({ key: "ai", title: "AI search (ChatGPT and Google's AI answers)", headline: `Recommended in ${named} of ${i.aiChecks.length} AI answers`, lines: [`We ask AI tools the questions your customers would, like "${i.aiChecks[0].question}", and check whether they name you.`, named === i.aiChecks.length ? "They named you every time." : named ? "They name you some of the time. The work on your listings and website is what gets you named more often." : "They don't name you yet. Getting your details consistent across the web and your site readable by AI tools is how that changes."] });
  }

  return { name: i.name, firstName: i.firstName, period, sections, done: tally(i.done, "done", 6), next: tally(i.next, "next", 3) };
}

/** The email: short, plain, the same facts as the page. */
export function weeklyEmail(r: ClientReport, url: string, signoff = "Any questions, just reply.\n\nAyush\nASC Development"): { subject: string; body: string } {
  // A blank line between a heading and its list, so the email shows real bullet points.
  const lines = [`Hi ${r.firstName ?? "there"},`, "", `Here's your progress for ${r.period}.`, ""];
  const head = (s: ReportSection) => (s.headline.toLowerCase().includes(s.title.toLowerCase()) ? s.headline : `${s.title.replace(/ \(.*\)$/, "")}: ${s.headline}`);
  for (const s of r.sections) lines.push(`**${head(s)}**`, "", ...s.lines.slice(0, 4).map((l) => `- ${l}`), "");
  if (r.done.length) lines.push("**What we did this week**", "", ...r.done.map((d) => `- ${d}`), "");
  if (r.next.length) lines.push("**Coming next**", "", ...r.next.map((d) => `- ${d}`), "");
  lines.push(`The full page, with charts: ${url}`, "", signoff);
  const lead = r.sections.find((s) => s.key === "leads") ?? r.sections[0];
  return { subject: `Your weekly progress${lead ? `: ${lead.headline.toLowerCase()}` : ""}`, body: lines.join("\n") };
}
