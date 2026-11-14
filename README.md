# ASC Platform

ASC Development's own client platform. Module 1 is **onboarding**: from a Stripe payment to a live site, with no manual chasing.

## How it works

1. **Client pays** through a Stripe Payment Link (£200/month subscription).
2. **Stripe webhook** (`/api/stripe/webhook`) creates the client, emails them a welcome message with their personal onboarding form link and your booking link, and emails you.
3. **Client fills in the form** (`/onboarding/<token>`): business details, services, areas, logo, 5 to 15 job photos, access details. Files upload straight to Supabase Storage.
4. **Submitting starts the 48-hour clock**: the client gets a confirmation, you get every answer by email, and a "Build and launch" task is created, due in 48 hours.
5. **Hourly cron** (`/api/cron/chase`):
   - form not in after 24h: nudge email
   - after 48h: second email
   - after 72h: a call task for you, plus an alert
   - 12h before a build deadline: warning; past the deadline: overdue alert
   - 30 days after launch: a task to send the report and referral ask
6. **Admin** (`/admin`, password protected): every client, status, build countdown, tasks, form answers, photos, timeline of what's been sent, notes. **Mark live** saves the URL and sends the launch email.

Every automated message is recorded in `client_messages`, so nothing is ever sent twice, even if Stripe or the cron retries.

Stripe events handled: `checkout.session.completed`, `invoice.payment_failed` (status becomes "Payment failed" and you're alerted), `invoice.paid` (restores status), `customer.subscription.deleted` (cancelled).

## Setup (about 30 minutes)

### 1. Supabase
- Create a project at supabase.com.
- SQL Editor: paste and run `supabase/migrations/20261114160000_onboarding.sql`. This creates the tables and the private `client-assets` storage bucket.
- Copy the project URL, anon key and service role key into your env.

### 2. Resend
- Add and verify your sending domain (for example ascdev.tech) by adding the DNS records Resend gives you. No mailbox is needed.
- Create an API key. Set `EMAIL_FROM` to an address on that domain. Client replies go to `ADMIN_EMAIL`.

### 3. Deploy to Vercel
- Import this repo into Vercel and add every variable from `.env.example`.
- Set `APP_URL` to the deployed URL (or a subdomain like app.ascdev.tech).
- The cron in `vercel.json` runs hourly. Vercel's Hobby plan only allows daily crons, so use Pro, or point a free external cron (cron-job.org) at `/api/cron/chase` hourly with the header `Authorization: Bearer <CRON_SECRET>`.

### 4. Stripe
- Create a Product: "ASC Growth Plan", £200/month recurring.
- Create a Payment Link for it. Recommended: collect phone number, and add a custom text field with the key `business_name` ("Business name"). Add your terms URL so clients must accept them.
- Developers > Webhooks > Add endpoint: `https://<APP_URL>/api/stripe/webhook`, events `checkout.session.completed`, `invoice.payment_failed`, `invoice.paid`, `customer.subscription.deleted`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

### 5. Test it end to end
- Switch Stripe to test mode (test keys and a test webhook), pay with card `4242 4242 4242 4242`.
- Check: welcome email arrives, client appears in `/admin`, form link works, photos upload, submitting shows the 48-hour countdown, Mark live sends the launch email.
- Test the cron by calling it with the secret: `curl -H "Authorization: Bearer $CRON_SECRET" https://<APP_URL>/api/cron/chase`

Existing clients who didn't pay through Stripe: use **Add a client manually** on the admin page. It sends them the welcome email and form.

## Local development

```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev
# forward Stripe events locally:
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

## Code map

| Path | What it does |
| --- | --- |
| `src/app/api/stripe/webhook/route.ts` | Payment events |
| `src/lib/onboarding.ts` | Creates the client, sends the welcome email |
| `src/app/onboarding/[token]/` | Client-facing form, uploads, submit action |
| `src/lib/onboarding-fields.ts` | Form fields and validation (shared by client and server) |
| `src/app/api/cron/chase/route.ts` | Chasers, deadline alerts, day-30 tasks |
| `src/app/admin/` | Dashboard, client page, actions |
| `src/lib/email.ts` | All email copy (edit wording here) |
| `src/proxy.ts` | Password on /admin |
| `supabase/migrations/` | Database schema |

## Next modules

SMS (Twilio) for the welcome and 24h chase, website generation from the form answers, SEO page generator, Google Business Profile post batches, review requests, monthly reports.
