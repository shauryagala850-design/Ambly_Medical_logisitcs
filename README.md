# Ambly Ops & Compliance

Web app that tracks the recurring obligations in Ambly's ambulance-standby contracts, keeps audit-ready
records, and (from Phase 3) produces the monthly client report. Multi-site from day one; configured first
for **Marathon Futurex, Lower Parel**.

## What is built so far (Phase 1)

| Module | Where | What it does |
| --- | --- | --- |
| Dashboard | `/` | Who is on shift, open alerts, upcoming contract deadlines, red banner for expired documents |
| Staff and approved pool | `/staff` | Profiles, main/relief, client approval (including deemed approval after 3 days), documents per person |
| Documents and expiry | `/documents` | All staff and vehicle documents, alerts at 60 / 30 / 7 days, missing required documents |
| Roster | `/roster` | Weekly planner; flags 8 h/day and 48 h/week breaches and any gap in 24x7 cover; refuses unapproved staff or expired documents; monthly CSV export |
| Duty register | `/duty` | Mobile check-in / check-out with the client's security guard signing each handover |
| Users | `/users` | Who can log in and with which role (admin only) |
| Audit trail | `/audit` | Who changed what and when (admin only) |

Coming next: Phase 2 (absence tracker and service credits, emergency call log, ambulance movement log,
daily readiness checklist), Phase 3 (compliance calendar, incident and breach alerts, waste log, monthly
report, client view), Phase 4 (patient health profile portal).

## Changing contract rules

Every time, limit, amount and notice period lives in one file per client site:

- `config/sites/marathon-futurex.ts`

Edit the value, commit, and the app redeploys with the new rule. To add a client site, copy that file,
change the values, register it in `config/sites/index.ts`, and add a row to the `sites` table with the
same `slug`.

> The **Commencement Date** in that file is currently a placeholder (`2026-11-01`). Replace it with the
> real first day of deployment so the trial-end and renewal-notice dates are right.

## One-time setup (about 20 minutes, all in the browser)

### 1. Create the database (Supabase)

1. Go to <https://supabase.com>, sign up, and create a **New project**.
   - Name: `ambly-ops`
   - Region: **South Asia (Mumbai)** so data stays in India
   - Set a database password and keep it somewhere safe
2. When the project is ready, open **SQL Editor** in the left menu.
3. In GitHub, open `supabase/setup_all.sql`, click **Raw**, select everything and copy it.
4. Paste into the SQL Editor and press **Run**. You should see "Success". This creates the tables,
   the access rules, the private file storage, and sample data for Marathon Futurex (made-up people only).

### 2. Turn on phone login

Real SMS needs a paid provider with Indian DLT registration, which we will add later. Until then, use
Supabase **test numbers**: real phone numbers with a fixed code that you choose.

1. In Supabase open **Authentication → Sign In / Providers → Phone** and enable it.
2. It asks for an SMS provider. Choose Twilio and type any placeholder text in the required fields
   (they are not used while you are on test numbers).
3. In **Test Phone Numbers and OTPs** enter each number that should be able to log in, with a 6-digit
   code of your choice, separated by commas. Use the country code and no `+`. Example:
   `919876543210=482913,919812345678=175520`
4. Set the "valid until" date for the test codes a few months ahead, then **Save**.

Treat those codes like passwords: anyone who knows a number and its code can log in as that person.

### 3. Copy the two keys

In Supabase open **Project Settings → API** (or the **Connect** button) and copy:

- **Project URL** (looks like `https://abcdefgh.supabase.co`)
- **anon / publishable key**

Never copy the `service_role` / secret key anywhere; the app does not need it.

### 4. Put the app online (Vercel)

1. Go to <https://vercel.com>, **Sign up with GitHub**.
2. **Add New → Project**, pick the `Ambly_Medical_logisitcs` repository, and click **Import**.
3. Open **Environment Variables** and add:
   - `NEXT_PUBLIC_SUPABASE_URL` = the Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the anon / publishable key
4. Click **Deploy**. After a minute or two Vercel shows your live link.

### 5. First login

1. Open the live link and log in with one of your test numbers and its code.
2. The app sees that no admin exists yet and offers **Make me the admin**. Enter your name.
3. Go to **Users** to add your co-founder (Admin), the Ezung ops manager, and each driver or doctor
   (On-shift staff, linked to their staff profile). Each number must also be in the Supabase test list
   until real SMS is switched on.

You stay logged in on a device until you press **Log out**.

## Sample data to try

- **Sample Relief Driver B** has an expired BLS certificate: red banner, and the roster refuses them.
- **Sample Relief Driver C** had documents sent yesterday: approval pending, so they cannot be rostered yet.
- **Sample Relief Driver A** was never explicitly approved but is deemed approved (documents sent 10 days ago).
- **Sample Driver Three**'s licence expires in 5 days: 7-day alert, and their later shifts are flagged.
- Next week's Tuesday night shift is deliberately unfilled, so the gap warning shows.
- Motor insurance for MH-48-K-1058 is recorded with its real expiry, 11 July 2027. Everything else is made up.

When you are ready for real data, remove the sample staff and documents (or ask for a clean-up script).

## Access rules

| Role | Can do |
| --- | --- |
| Admin | Everything, including users, audit trail, opening staff ID files |
| Ops manager | Staff, documents (can open vehicle files, not staff ID files), roster, duty register |
| On-shift staff | Duty screen only: check in and out of their own shifts |
| Client | No access yet (read-only view arrives in Phase 3) |

Access is enforced in the database itself (row-level security), not only in the screens. Uploaded files
are private and opened through links that expire after 60 seconds.

## For developers

```
npm install
npm test          # rule logic: expiry, approval, shift-hour limits, 24x7 cover, deadlines
npm run typecheck
npm run dev       # needs .env.local, see .env.example
npm run db:bundle # rebuild supabase/setup_all.sql after editing the numbered SQL files
```

Rule logic is pure TypeScript in `lib/rules/` with tests in `tests/`. Stack: Next.js (App Router),
Supabase (Postgres, phone auth, storage), Tailwind CSS, Vitest.
