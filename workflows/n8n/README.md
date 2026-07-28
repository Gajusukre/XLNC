# XLNC n8n Workflows — Phase 4

Two importable workflow files:

- `xlnc-daily-pricing-sync.json` — the actual scheduled job: logs in as a service account, syncs Hostify properties into Postgres, syncs each property's reservations for the next 30 days, then computes (and, per Phase 2/3 API behavior, persists) pricing recommendations for every property for the next 7 days.
- `xlnc-pricing-sync-error-handler.json` — a companion workflow wired as the pricing sync's "error workflow" in n8n's settings, so any failed execution triggers this instead of failing silently.

## Honest caveat before you import these

**These have not been imported into a live n8n instance.** I could not install n8n in this build sandbox to verify the import directly — one of its dependencies (`@n8n/n8n-nodes-langchain` → `@langchain/community` → an `xlsx` package fetched from `cdn.sheetjs.com`) is hosted on a domain this sandbox's network isn't allowed to reach, the same category of limitation as Docker not being available here.

What I *did* verify, programmatically, before handing these to you:
- Both files are valid JSON.
- Every connection in the workflow graph references a real, existing node — no dangling references.
- Every node except the trigger is reachable from the trigger (no orphaned branches).
- Node `type` strings match n8n's real core node catalog (`scheduleTrigger`, `httpRequest`, `set`, `splitOut`, `if`, `noOp`, `errorTrigger`) as of my knowledge — but I have not run these against an actual n8n instance's node registry, so **please do a real `Import from File` on your n8n instance and open both workflows in the editor before activating them**, the same way you're validating Docker Compose on your VPS.

## Setup on your n8n instance

1. **Create a dedicated service account** — don't reuse your own admin login here. Log into the API as an admin and create a `manager`-role account specifically for automation:
   ```bash
   curl -X POST https://your-vps:4000/auth/users \
     -H "Authorization: Bearer <your admin access token>" \
     -H "Content-Type: application/json" \
     -d '{"email":"n8n-automation@xlnc.local","password":"<generate a strong one>","role":"manager"}'
   ```
   `manager` is enough for this job (sync + pricing reads) — don't give it `admin`.

2. **Set environment variables on the n8n instance itself** (not in the workflow JSON — these are referenced via `$env` expressions):
   - `XLNC_API_URL` — e.g. `http://api:4000` if n8n and the API share a Docker network, or the VPS's public/internal address otherwise.
   - `XLNC_SYNC_EMAIL` — the service account email from step 1.
   - `XLNC_SYNC_PASSWORD` — its password.

3. **Import both workflow files** via n8n's UI (Workflows → Import from File), or the CLI (`n8n import:workflow --input=xlnc-daily-pricing-sync.json`).

4. **Wire the error workflow**: open `XLNC - Daily Pricing Sync` → workflow settings → "Error Workflow" → select `XLNC - Pricing Sync Error Handler`.

5. **Replace the No-Op placeholders** in the error handler and in the pricing sync's "persistence failed" branch with real alerting once you've decided on a channel (Slack, email, etc.) — these are deliberately left as clearly-labeled placeholders rather than wired to a channel that doesn't exist yet, the same pattern used for the PriceLabs/Microsoft Graph mock adapters in earlier phases.

6. **Activate the workflow** once you've confirmed a manual test execution succeeds end-to-end.

## What this workflow does NOT do yet

- Doesn't rotate the service account's refresh token — it re-logs-in fresh on every scheduled run, which is simple and fine at once-a-day frequency but would be wasteful at higher frequencies.
- No real alerting — see the No-Op placeholders above.
- Reservation sync failures for one property are set to `neverError` so they don't abort the rest of the run — check `sync_runs` (or `GET /sync/runs`) for per-property failures rather than relying on the workflow execution status alone.
