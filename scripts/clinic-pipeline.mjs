#!/usr/bin/env node
// Clinic outbound pipeline, stages 1 to 3: source -> enrich -> AI search check.
// Each clinic is a row in public.outbound_prospects (Supabase). Zero dependencies, Node 20+.
//
// Usage:
//   node --env-file=.env.local scripts/clinic-pipeline.mjs source  --vertical physio --limit 40
//   node clinic-pipeline.mjs enrich  --vertical physio --limit 30
//   node clinic-pipeline.mjs aicheck --vertical physio --limit 30
//   node clinic-pipeline.mjs all     --vertical physio --limit 30
//
// Env (put in .env.local, never commit):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required
//   ANTHROPIC_API_KEY                         required for enrich and aicheck
//   OUTSCRAPER_API_KEY                        required for source
//   OPENAI_API_KEY, PERPLEXITY_API_KEY        at least one for aicheck
//   COMPANIES_HOUSE_API_KEY                   optional, verifies Ltd status
//   CLAUDE_MODEL (default claude-haiku-5-5), OPENAI_MODEL (default gpt-5), PERPLEXITY_MODEL (default sonar)

const env = { ...process.env };
// The platform's own env names work too.
env.SUPABASE_URL ||= env.NEXT_PUBLIC_SUPABASE_URL;
const CLAUDE_MODEL = env.CLAUDE_MODEL || 'claude-haiku-5-5';
const OPENAI_MODEL = env.OPENAI_MODEL || 'gpt-5';
const PERPLEXITY_MODEL = env.PERPLEXITY_MODEL || 'sonar';
const TABLE = 'outbound_prospects';

// What to search for per vertical, and the phrase used in the AI search query.
const VERTICALS = {
  physio: {
    queries: ['physiotherapy clinic', 'sports physio', 'osteopath', 'sports massage clinic'],
    noun: 'physio',
  },
  specialist: {
    queries: ['private dermatologist', 'private ENT consultant', 'private gynaecologist', 'private urologist', 'private orthopaedic consultant'],
    noun: 'private consultant',
  },
  meded: {
    queries: ['BLS training course', 'first aid training provider', 'PLAB course', 'MRCP exam course', 'medical school interview tutor'],
    noun: 'course provider',
  },
};
const AREAS = ['Marylebone London', 'Harley Street London', 'Fitzrovia London', 'Mayfair London', 'Baker Street London', 'City of London', 'Victoria London'];
// Size proxy for 1 to 5 staff: enough reviews to be real, not so many it is a chain.
const MIN_REVIEWS = 15;
const MAX_REVIEWS = 300;
const CHAIN_HINTS = ['six physio', 'bodyset', 'ten health', 'tenphysio', 'pure sports medicine', 'nuffield', 'hca', 'bupa', 'spire', 'isokinetic', 'the london clinic'];

// ---------- helpers ----------
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function need(...keys) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(url, opts = {}, label = url) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout || 60000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} -> ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

// ---------- Supabase (PostgREST) ----------
function sbHeaders(extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}
const sbUrl = (qs = '') => `${env.SUPABASE_URL}/rest/v1/${TABLE}${qs}`;

async function sbSelect(qs) {
  return http(sbUrl(qs), { headers: sbHeaders() }, 'supabase select');
}
async function sbUpsert(rows) {
  if (!rows.length) return;
  // Only the columns sent are updated on conflict, so later-stage fields are never overwritten.
  await http(sbUrl('?on_conflict=place_id'), {
    method: 'POST',
    headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
  }, 'supabase upsert');
}
async function sbUpdate(id, patch) {
  await http(sbUrl(`?id=eq.${id}`), {
    method: 'PATCH',
    headers: sbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  }, 'supabase update');
}

// ---------- Claude ----------
async function claudeJson(system, user) {
  const data = await http('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: `${system}\nReply with one JSON object only. No prose, no code fences.`,
      messages: [{ role: 'user', content: user }],
    }),
  }, 'anthropic');
  const text = (data.content || []).map((c) => c.text || '').join('');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error(`Claude returned no JSON: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1));
}

// ---------- Stage 1: source ----------
async function source(vertical, limit) {
  need('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OUTSCRAPER_API_KEY');
  const cfg = VERTICALS[vertical];
  const perQuery = Math.max(10, Math.ceil(limit / 2));
  const found = new Map();
  for (const q of cfg.queries) {
    for (const area of AREAS) {
      if (found.size >= limit) break;
      const url = `https://api.app.outscraper.com/maps/search-v3?query=${encodeURIComponent(`${q}, ${area}`)}&limit=${perQuery}&language=en&region=GB&async=false`;
      let data;
      try {
        data = await http(url, { headers: { 'X-API-KEY': env.OUTSCRAPER_API_KEY }, timeout: 180000 }, 'outscraper');
      } catch (e) { console.error(`  skip "${q}, ${area}": ${e.message}`); continue; }
      for (const p of (data.data || []).flat()) {
        if (!p || !p.place_id || found.has(p.place_id)) continue;
        const reviews = p.reviews ?? 0;
        const lower = (p.name || '').toLowerCase();
        let status;
        let exclude_reason;
        if (CHAIN_HINTS.some((c) => lower.includes(c))) { status = 'excluded'; exclude_reason = 'chain'; }
        else if (reviews < MIN_REVIEWS || reviews > MAX_REVIEWS) { status = 'excluded'; exclude_reason = `review count ${reviews} outside ${MIN_REVIEWS} to ${MAX_REVIEWS}`; }
        else if (!p.site) { status = 'excluded'; exclude_reason = 'no website'; }
        const row = {
          vertical,
          name: p.name,
          address: p.full_address || null,
          postcode: p.postal_code || null,
          phone: p.phone || null,
          website: p.site ? p.site.split('?')[0] : null,
          place_id: p.place_id,
          rating: p.rating ?? null,
          review_count: reviews,
          source: 'outscraper',
        };
        if (status) { row.status = status; row.exclude_reason = exclude_reason; }
        found.set(p.place_id, row);
      }
      console.log(`  "${q}, ${area}": ${found.size} unique so far`);
    }
  }
  // PostgREST bulk upsert needs identical keys on every row, so split by shape.
  const all = [...found.values()];
  await sbUpsert(all.filter((r) => !r.status));
  await sbUpsert(all.filter((r) => r.status));
  console.log(`source: upserted ${all.length} (${all.filter((r) => !r.status).length} qualified)`);
}

// ---------- Stage 2: enrich ----------
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>/gi, ' [link:$1] ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ASCResearch/1.0; +https://ascdev.tech)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('html')) return null;
    return { url: res.url, text: htmlToText(await res.text()).slice(0, 9000) };
  } catch { return null; }
}

const ENRICH_SYSTEM = `You extract facts about a small UK clinic or training provider from its own website text.
Rules: use ONLY what the supplied pages say. If a fact is not clearly stated, return null. Never guess a name or email.
Every non-null fact must have a source_url taken from the page it came from.
JSON shape:
{
 "owner_name": string|null,            // founder, owner, clinical director or lead clinician
 "owner_email": string|null,           // a personal or direct email if shown, else the general contact email
 "area": string|null,                  // neighbourhood a patient would say, e.g. "Marylebone"
 "specialties": string[],              // up to 6 treatments or conditions they say they focus on
 "has_online_booking": boolean|null,   // true only if a book-online link or widget is present
 "booking_system": string|null,        // e.g. Cliniko, Jane, TM3, Nookal, Acuity, Calendly
 "missing_specialty_page": string|null,// one specialty they name that has no dedicated page link, else null
 "company_name": string|null,          // registered company name from footer or legal pages
 "company_number": string|null,        // Companies House number if shown
 "claim_sources": { "<field>": "<source_url>" }
}`;

async function companiesHouseActive(number) {
  if (!env.COMPANIES_HOUSE_API_KEY || !number) return null;
  const padded = String(number).replace(/\s/g, '').padStart(8, '0');
  try {
    const data = await http(`https://api.company-information.service.gov.uk/company/${padded}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${env.COMPANIES_HOUSE_API_KEY}:`).toString('base64')}` },
    }, 'companies house');
    return data.company_status === 'active';
  } catch { return null; }
}

async function enrich(vertical, limit) {
  need('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY');
  const rows = await sbSelect(`?vertical=eq.${vertical}&status=eq.sourced&website=not.is.null&order=review_count.asc&limit=${limit}`);
  console.log(`enrich: ${rows.length} rows`);
  for (const row of rows) {
    try {
      const base = new URL(row.website);
      const paths = ['', '/about', '/about-us', '/team', '/our-team', '/contact', '/contact-us', '/services', '/treatments'];
      const pages = (await Promise.all(paths.map((p) => fetchPage(new URL(p || '/', base).href)))).filter(Boolean);
      const unique = [...new Map(pages.map((p) => [p.url, p])).values()];
      if (!unique.length) { await sbUpdate(row.id, { notes: 'enrich: site could not be fetched' }); continue; }
      const out = await claudeJson(
        ENRICH_SYSTEM,
        `Clinic: ${row.name}\nAddress: ${row.address}\n\n${unique.map((p) => `=== PAGE ${p.url} ===\n${p.text}`).join('\n\n')}`,
      );
      // PECR: only email corporate bodies. Unknown stays null, which means phone, not email.
      let incorporated = null;
      if (out.company_number) {
        const active = await companiesHouseActive(out.company_number);
        incorporated = active === null ? true : active;
      } else if (out.company_name && /\b(ltd|limited|llp|plc)\b/i.test(out.company_name)) {
        incorporated = true;
      }
      await sbUpdate(row.id, {
        status: 'enriched',
        owner_name: out.owner_name || null,
        owner_email: out.owner_email || null,
        area: out.area || row.area || null,
        specialties: out.specialties || [],
        has_online_booking: out.has_online_booking ?? null,
        booking_system: out.booking_system || null,
        missing_specialty_page: out.missing_specialty_page || null,
        company_name: out.company_name || null,
        company_number: out.company_number || null,
        is_incorporated: incorporated,
        claim_sources: out.claim_sources || {},
        enriched_at: new Date().toISOString(),
      });
      console.log(`  ok  ${row.name}`);
    } catch (e) {
      console.error(`  err ${row.name}: ${e.message}`);
      await sbUpdate(row.id, { notes: `enrich error: ${e.message.slice(0, 200)}` }).catch(() => {});
    }
    await sleep(500);
  }
}

// ---------- Stage 3: AI search check ----------
async function askOpenAI(q) {
  const data = await http('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_MODEL, tools: [{ type: 'web_search' }], input: q }),
    timeout: 120000,
  }, 'openai');
  return (data.output || [])
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content || [])
    .map((c) => c.text || '')
    .join('\n');
}
async function askPerplexity(q) {
  const data = await http('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: PERPLEXITY_MODEL, messages: [{ role: 'user', content: q }] }),
    timeout: 120000,
  }, 'perplexity');
  return data.choices?.[0]?.message?.content || '';
}

const AICHECK_SYSTEM = `You are given answers from AI search tools to a "best clinic" question, and the name of one target clinic.
List the businesses each answer recommends, in order, and say whether the target is among them (allow for small naming differences).
JSON shape: { "engines": { "<engine>": { "named": string[], "mentions_target": boolean } } }`;

async function aicheck(vertical, limit) {
  need('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY');
  const engines = {};
  if (env.OPENAI_API_KEY) engines.openai_api = askOpenAI;
  if (env.PERPLEXITY_API_KEY) engines.perplexity_api = askPerplexity;
  if (!Object.keys(engines).length) throw new Error('Set OPENAI_API_KEY or PERPLEXITY_API_KEY for aicheck');
  const rows = await sbSelect(`?vertical=eq.${vertical}&status=eq.enriched&order=review_count.asc&limit=${limit}`);
  console.log(`aicheck: ${rows.length} rows`);
  for (const row of rows) {
    try {
      const specialty = (row.specialties || [])[0];
      const area = row.area || 'central London';
      const q = specialty
        ? `Who is the best ${VERTICALS[vertical].noun} in ${area}, London for ${specialty}? Name specific clinics.`
        : `Who is the best ${VERTICALS[vertical].noun} in ${area}, London? Name specific clinics.`;
      const raw = {};
      for (const [name, fn] of Object.entries(engines)) {
        try { raw[name] = await fn(q); } catch (e) { raw[name] = null; console.error(`    ${name} failed: ${e.message}`); }
      }
      const answered = Object.entries(raw).filter(([, v]) => v);
      if (!answered.length) { await sbUpdate(row.id, { notes: 'aicheck: no engine answered' }); continue; }
      const parsed = await claudeJson(
        AICHECK_SYSTEM,
        `Target clinic: ${row.name}\n\n${answered.map(([k, v]) => `=== ${k} ===\n${v.slice(0, 5000)}`).join('\n\n')}`,
      );
      const per = parsed.engines || {};
      const mentions = Object.values(per).some((e) => e.mentions_target);
      const competitors = [...new Set(Object.values(per).flatMap((e) => e.named || []))]
        .filter((n) => n.toLowerCase() !== row.name.toLowerCase())
        .slice(0, 6);
      await sbUpdate(row.id, {
        status: 'checked',
        ai_query: q,
        ai_results: { asked_at: new Date().toISOString(), raw, parsed: per },
        ai_named_competitors: competitors,
        ai_mentions_clinic: mentions,
        ai_checked_at: new Date().toISOString(),
      });
      console.log(`  ok  ${row.name}: ${mentions ? 'MENTIONED' : 'not mentioned'} (${competitors.slice(0, 2).join(', ')})`);
    } catch (e) {
      console.error(`  err ${row.name}: ${e.message}`);
    }
    await sleep(500);
  }
}

// ---------- main ----------
const cmd = process.argv[2];
const vertical = arg('vertical', 'physio');
const limit = parseInt(arg('limit', '30'), 10);
if (!VERTICALS[vertical]) { console.error(`Unknown vertical. Use: ${Object.keys(VERTICALS).join(', ')}`); process.exit(1); }

const run = { source, enrich, aicheck, all: async (v, l) => { await source(v, l); await enrich(v, l); await aicheck(v, l); } }[cmd];
if (!run) { console.error('Usage: node clinic-pipeline.mjs <source|enrich|aicheck|all> --vertical physio --limit 30'); process.exit(1); }
run(vertical, limit).catch((e) => { console.error(e.message); process.exit(1); });
