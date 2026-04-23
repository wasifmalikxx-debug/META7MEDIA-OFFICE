# Office Manager — Setup

A generic HR / attendance / payroll / leaves / fines app. Employees check in
and out, the system auto-fines lateness and absences, monthly payroll is
computed from attendance, and WhatsApp notifications go out through the Meta
Cloud API. Forked from a production app; strip or extend as you like.

## Prereqs

- A GitHub account (to fork / clone)
- Node 20+ and npm
- A phone number you can register with Meta WhatsApp Business (any SIM that
  isn't already linked to a personal WhatsApp account works)
- A Vercel account (for deployment) and a Supabase account (for Postgres)

## Step 1 — Clone and install

```bash
git clone <your-fork-url> office-manager
cd office-manager
npm install
cp .env.example .env
```

Open `.env` in your editor. You will fill it in as you go through the next
steps.

## Step 2 — Database (Supabase)

1. Go to https://supabase.com, create a new project, and pick a region close
   to where most of your employees are.
2. In the project, open **Settings → Database → Connection string**.
3. Copy the **Transaction pooler** URL into `DATABASE_URL` in `.env`.
4. Copy the **Session / direct** URL into `DIRECT_URL`.
5. Generate an auth secret and paste it into `AUTH_SECRET`:

```bash
openssl rand -base64 32
```

## Step 3 — Migrate and seed

```bash
npx prisma migrate deploy
npx prisma db seed
```

The seed creates one admin account (`admin@example.com` / `password123`), a
single "General" department, and three demo employees. Change the admin
password on first login.

Then run the app locally:

```bash
npm run dev
```

Open http://localhost:3000 and sign in.

## Step 4 — WhatsApp (Meta Cloud API)

WhatsApp is optional — leave `META_WA_ENABLED="false"` in `.env` and the
app runs fine without it.

If you do want the WhatsApp notifications:

1. Go to https://business.facebook.com and create a WhatsApp Business
   account. Add a phone number.
2. At https://developers.facebook.com, create an app → **Add a product → WhatsApp**.
3. From **WhatsApp → API Setup**, copy the **Phone number ID** into
   `META_WA_PHONE_NUMBER_ID` and generate a **Permanent access token** via
   System User, then paste it into `META_WA_TOKEN`.
4. Open **WhatsApp → Message Templates** and create the five templates the
   app uses. Names and parameter counts must match exactly:

   | Template name  | Body parameters | Example body                                                                    |
   | -------------- | --------------- | -------------------------------------------------------------------------------- |
   | `late_notice`  | 3 (`{{1}}` `{{2}}` `{{3}}`) | `Hi {{1}}, you arrived {{2}} minutes late. A fine of {{3}} has been applied.` |
   | `break_fine`   | 3               | `Hi {{1}}, you returned {{2}} minutes late from break. Fine: {{3}}.`           |
   | `absent_fine`  | 2               | `Hi {{1}}, you were marked absent today. Deduction: {{2}}.`                    |
   | `manual_fine`  | 3               | `Hi {{1}}, a fine of {{2}} has been issued. Reason: {{3}}.`                    |
   | `salary_paid`  | 3               | `Hi {{1}}, your {{2}} salary of {{3}} has been credited.`                      |

5. Wait for each template to show **Approved** (usually < 1 hour). Meta
   rejects template sends that use an un-approved template.
6. Set `META_WA_ENABLED="true"` in `.env`.

## Step 5 — Deploy to Vercel

```bash
npx vercel
```

Follow the prompts. Link the project, then push your env vars to production
— mark `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `META_WA_TOKEN`, and
`CRON_SECRET` as **Sensitive** in the Vercel dashboard.

`vercel.json` already schedules three cron jobs:

- `end-of-day-checkout` — auto-checks-out anyone who forgot, runs on workdays
- `daily-absent` — marks no-shows as absent
- `cleanup` — monthly housekeeping, prunes records older than ~3 months

## Step 6 — First login

1. Open your Vercel URL and sign in with `admin@example.com` / `password123`.
2. Open **Profile** and change the password immediately.
3. Open **Settings** to set office hours, weekend days, and fine tiers.
4. Open **Employees** and replace the seeded demo employees with your real
   team (you can also delete them and keep just the admin).

## Customizing with Claude Code

This project was built with Claude Code in mind. A starting prompt:

> This is a forked HR app. Customize it for my business: [describe the
> company, team size, working hours, timezone, fine policy]. Rename the
> company in Office Settings, adjust office hours, replace the seeded
> employees with my real team, set the currency to X (the default is PKR —
> change it in `prisma/schema.prisma` `SalaryStructure.currency` default and
> in the UI labels), and adjust the late-fine thresholds and break window.

## Known limits

- Meta WhatsApp templates **must** be pre-approved before the app can send
  them — check the WhatsApp Manager dashboard. A template "In review" will
  fail every send until it flips to Approved.
- The app is timezone-aware for Pakistan Time (PKT, UTC+5). If your team is
  in a different zone, search for `pkt.ts` and `nowPKT` in the source and
  adjust the offset and weekend days.
- Cron schedules in `vercel.json` use UTC. The defaults assume a PKT office
  (end-of-day at 20:00 PKT = 15:00 UTC). Adjust if your timezone differs.
- Device-approval flow assumes one device per employee. First login from a
  new device is blocked until the admin approves it from **Login Approvals**.
