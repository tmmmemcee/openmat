# Deploying OpenMat on Render (free tier)

This project ships a `render.yaml` **Blueprint** so Render can build all three
pieces (web static site, API web service, Postgres) in one click and then
auto-deploy on every push to `main` on GitHub.

## One-time setup (~2 minutes)

1. Sign in to <https://render.com> with **"Sign in with GitHub"** (use the
   `tmmmemcee` GitHub account). No credit card needed for the free tier.

2. In the Render dashboard: **New → Blueprint**.

3. Point it at this repo: <https://github.com/tmmmemcee/openmat>

4. Render reads `render.yaml` and shows three resources to create:
   - `openmat-web` — static site (free)
   - `openmat-api` — web service (free; spins down after 15 min idle, cold
     starts in ~30 s)
   - `openmat-db` — Postgres (free for 90 days, then $7/mo; you can swap for
     Neon / Supabase later by changing `DATABASE_URL` on `openmat-api`)

5. Click **Apply**. Render kicks off the first deploy. First build takes
   ~3–5 minutes because pnpm has to install everything.

6. While you wait, open the `openmat-api` service page and set its
   `PUBLIC_BASE_URL` env var to your web URL:

   ```
   PUBLIC_BASE_URL = https://openmat-web.onrender.com
   ```

   (or your custom domain). This is what gets baked into emailed director
   links. After you change it, Render auto-redeploys the API.

7. When both services show green ✅, visit the web URL. You should land on the
   public OpenMat home page with the "live demo" widget.

## Verify

- Web home loads → `https://openmat-web.onrender.com/`
- API health → `https://openmat-api.onrender.com/api/health` returns
  `{"ok":true}`
- Create an event: click **Create event**, fill the wizard, then check your
  email or the API log for the director link (no SMTP set → link prints to
  the API logs in the Render dashboard).

## Day-to-day

Every `git push` to `main` triggers Render to redeploy both services.

```sh
git push                                # auto-deploys web + api
```

## Free-tier limits to know

- **Web service cold start.** Free web services on Render sleep after 15 min
  idle. First request to a sleeping API takes ~30 s. Fine for a demo;
  upgrade to the $7/mo plan to keep it always-warm.
- **Postgres free tier is 90 days.** Set a calendar reminder. To migrate off,
  dump with `pg_dump` and restore into Neon / Supabase / etc.
- **No email by default.** Without `SMTP_URL` set, emails are logged
  (visible in the Render API logs); add `SMTP_URL` and `MAIL_FROM` to send
  real email. Push alerts work out of the box: the API creates its web push
  (VAPID) keys on first use and keeps them in the database. To manage the
  keys yourself, set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.
- **Database migrations run automatically** each time the API starts, so a
  fresh database gets its tables on the first deploy.

## Going custom-domain later

Once you own a domain, add it in Render for both services. The `_redirects`
file in `apps/web/public/_redirects` hard-codes
`https://openmat-api.onrender.com`; if you rename the API service you'll need
to update that file.
