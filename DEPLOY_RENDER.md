# Deploying XLNC Platform to Render (free tier)

This file is written so an automation agent (Claude Code or similar) can execute it directly.
Every step is tagged `[HUMAN]` (requires a real person — account creation, OAuth clicks, secret
values — cannot be scripted) or `[AGENT]` (a literal shell command to run, no judgment calls needed).

`render.yaml` at the repo root has already been validated against Render's official JSON Schema
(`https://render.com/schema/render.yaml.json`) — see `render.yaml` in this repo. It defines:
- 1 free Postgres database (`xlnc-postgres`)
- 1 free web service for the API (`xlnc-api`), built from `apps/api/Dockerfile`
- 1 free web service for the dashboard (`xlnc-web`), built from `apps/web/Dockerfile`

---

## Prerequisites

- `[HUMAN]` A GitHub account. Sign up at https://github.com/signup if you don't have one.
- `[HUMAN]` A Render account, created via GitHub OAuth at https://dashboard.render.com/register
  (click "GitHub" — this also grants Render access to your repos, needed later).
- `[AGENT]` `git` installed locally. Verify:
  ```bash
  git --version
  ```
- `[AGENT]` `gh` (GitHub CLI) installed and authenticated, so repo creation can be scripted instead
  of clicked. Verify / install:
  ```bash
  gh --version || (echo "Install from https://cli.github.com/ then run: gh auth login" && exit 1)
  gh auth status
  ```
  `[HUMAN]` If `gh auth status` fails, run `gh auth login` interactively once (device-code flow —
  this is an authentication step and cannot be scripted).

---

## Step 1 — `[AGENT]` Push this repo to GitHub

Run from the root of the unzipped `xlnc-platform` folder:

```bash
cd xlnc-platform
git init
git add .
git commit -m "Initial commit: XLNC platform Phases 1-7"
gh repo create xlnc-platform --private --source=. --remote=origin --push
```

If you'd rather not install `gh`, do this instead:

```bash
cd xlnc-platform
git init
git add .
git commit -m "Initial commit: XLNC platform Phases 1-7"
```
then `[HUMAN]`: go to https://github.com/new, create an empty repo named `xlnc-platform`
(don't initialize it with a README), copy the two commands GitHub shows you under
"…or push an existing repository from the command line", and run those.

**Verify:**
```bash
git remote -v
git log --oneline -1
```
Both should succeed with no errors, and `git remote -v` should show a `github.com` URL.

---

## Step 2 — `[HUMAN]` Connect the repo to Render as a Blueprint (one-time click, cannot be scripted)

This step needs a human because it's an OAuth-backed authorization click in Render's dashboard —
there is no way for an agent to click a browser button on your behalf.

1. Go to https://dashboard.render.com/blueprints
2. Click **New Blueprint Instance**
3. Select the `xlnc-platform` repo you just pushed
4. Render will detect `render.yaml` automatically and show you the 3 resources it's about to
   create (`xlnc-postgres`, `xlnc-api`, `xlnc-web`)
5. You'll be prompted for the `sync: false` secret values from `render.yaml` — fill in:
   - `ADMIN_EMAIL` — your email (this becomes your login for the dashboard)
   - `ADMIN_PASSWORD` — make one up, write it down
   - `HOSTIFY_API_KEY` — your **rotated** Hostify key
   - `PRICELABS_API_KEY` — leave blank, you don't have one yet (the app runs on mock data
     automatically when this is blank — see README.md)
6. Click **Apply**

Render now builds and deploys all three resources. This takes 5-10 minutes the first time
(free tier builds are slower than paid). You can watch progress in the dashboard.

`[HUMAN]` Once it's done, note the two URLs Render assigns
(visible on each service's page, top of screen):
- API: `https://xlnc-api.onrender.com` (or similar — Render may append random characters if
  `xlnc-api` is taken)
- Dashboard: `https://xlnc-web.onrender.com`

If your actual API URL differs from `https://xlnc-api.onrender.com`, `[AGENT]` update it:
```bash
cd xlnc-platform
sed -i 's|https://xlnc-api.onrender.com|<YOUR_ACTUAL_API_URL>|' render.yaml
git add render.yaml
git commit -m "Fix API_URL to match actual assigned Render hostname"
git push
```
Render auto-redeploys `xlnc-web` on every push to the connected branch.

---

## Step 3 — `[AGENT]` Verify the deployment for real (don't just assume it worked)

Replace `<API_URL>` and `<WEB_URL>` with your actual Render URLs from Step 2.

```bash
# 1. API health check — expect HTTP 200 and "database":"connected"
curl -s https://<API_URL>/health

# 2. Confirm login works with the admin account you set in Step 2
curl -s -X POST https://<API_URL>/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<YOUR_ADMIN_EMAIL>","password":"<YOUR_ADMIN_PASSWORD>"}'
# Expect a JSON response containing "accessToken" and "refreshToken".
# If you get {"error":"Invalid credentials"}, the bootstrap admin wasn't created —
# check the xlnc-api service logs in the Render dashboard for a line starting
# "[auth] Bootstrapped initial admin user:" and confirm the email matches.

# 3. Trigger the first property sync (replace TOKEN with the accessToken from step 2)
curl -s -X POST https://<API_URL>/sync/properties \
  -H "Authorization: Bearer <TOKEN>"
# Expect: {"runId":"...","count":<some number greater than 0>}

# 4. Confirm the dashboard itself is reachable
curl -s -o /dev/null -w "%{http_code}\n" https://<WEB_URL>/
# Expect: 307 (redirects to /login, since you're not logged in via curl — this is correct)
```

`[HUMAN]` Now open `https://<WEB_URL>/` in an actual browser, log in with your admin
email/password, and confirm you see your properties listed.

---

## Known free-tier limitations (real, not hidden)

- **Free web services sleep after ~15 minutes of no traffic** and take ~30-50 seconds to wake up
  on the next request. This is Render's free-tier behavior, not a bug in this app.
- **Free Postgres databases on Render are deleted after 30 days** unless you upgrade to a paid
  plan. Before day 30, either upgrade the `xlnc-postgres` database's plan in the Render dashboard,
  or export your data:
  ```bash
  # [HUMAN] get the External Database URL from the xlnc-postgres page in Render's dashboard, then:
  pg_dump "<EXTERNAL_DATABASE_URL>" > backup.sql
  ```
- This is still the free tier used throughout this project's testing — no payment required to
  reach a fully working, publicly reachable deployment.

## What's still blocked regardless of hosting choice

Same as documented in `README.md`: PriceLabs (no account), Microsoft Graph (needs your Azure App
Registration), and Hostify's price-write endpoint (deliberately unverified). Deploying to Render
doesn't change any of that — it's still your `.env`/Render env var values that are missing, not
something this runbook can complete for you.
