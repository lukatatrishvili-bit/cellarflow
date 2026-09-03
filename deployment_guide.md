# VinOS Deployment Guide

This guide explains how to build, run, and publish VinOS in a production environment.

## Canonical deployment target

This repository deploys to **Google Cloud Run only**. The production service is
`cellarflow-app` in project `cellarflow`, region `europe-west1`. Do not publish
this application through ChatGPT Sites or another static hosting target: the
application depends on its Express API, Cloud SQL, Secret Manager, and GCS
backup configuration.

---

## Technical Architecture Overview
* **Frontend**: React + Vite (Single Page Application).
* **Backend**: Express (Node.js) server running on TypeScript.
* **Database**: Cloud SQL PostgreSQL in production, with per-organization JSONB state and GCS JSON backup/fallback.
* **AI Engine**: Google GenAI SDK (requires `GEMINI_API_KEY` configured in the environment).

---

## 0. Production Database on Google Cloud Run (IMPORTANT)

Production should use **Cloud SQL PostgreSQL** as the authoritative database.
The app stores users, organizations, memberships, and invitations in normalized
tables, and stores each organization's full winery/vineyard ERP state in the
`OrganizationState` JSONB table. This keeps the current app data shape stable
while removing the single shared `db.json` production risk.

GCS remains useful as a backup/export layer: after successful PostgreSQL saves,
the server mirrors a JSON backup to `GCS_BUCKET/GCS_DB_OBJECT`. If PostgreSQL is
unavailable during startup, the app can still fall back to GCS/local JSON.

### Step 0.1: Create Cloud SQL PostgreSQL
```bash
gcloud services enable sqladmin.googleapis.com secretmanager.googleapis.com --project cellarflow

gcloud sql instances create cellarflow-postgres \
  --project cellarflow \
  --database-version POSTGRES_16 \
  --region europe-west1 \
  --edition ENTERPRISE \
  --tier db-f1-micro \
  --storage-size 10GB \
  --storage-type SSD \
  --storage-auto-increase \
  --availability-type ZONAL \
  --backup-start-time 03:00

gcloud sql databases create cellarflow --instance cellarflow-postgres --project cellarflow
gcloud sql users create cellarflow_app --instance cellarflow-postgres --project cellarflow --password "REPLACE_WITH_STRONG_PASSWORD"
```

### Step 0.2: Store DATABASE_URL in Secret Manager
Use the Cloud SQL Unix socket path in the Prisma URL:

```text
postgresql://cellarflow_app:REPLACE_WITH_STRONG_PASSWORD@localhost/cellarflow?host=/cloudsql/cellarflow:europe-west1:cellarflow-postgres
```

Store it as `cellarflow-database-url`, and grant the Cloud Run runtime service
account `roles/secretmanager.secretAccessor` plus `roles/cloudsql.client`.

### Step 0.3: Deploy with Cloud SQL attached
```bash
gcloud run deploy cellarflow-app --source . --region europe-west1 --allow-unauthenticated \
  --max-instances=1 \
  --add-cloudsql-instances cellarflow:europe-west1:cellarflow-postgres \
  --update-secrets DATABASE_URL=cellarflow-database-url:latest \
  --update-env-vars NODE_ENV=production,GCS_BUCKET=cellarflow-db,GCS_DB_OBJECT=db.json
```

Do not use this manual service command when a schema migration is pending. The
GitHub deployment workflow runs the verified image as a one-task Cloud Run
migration job and waits for it to succeed before updating the service. The
service container never mutates the schema during startup.

The first migration-enabled rollout transitions the existing `db push` schema
to the committed `20260719000000_baseline`. It marks that baseline as applied
only after `prisma migrate diff --exit-code` proves the live database exactly
matches `prisma/schema.prisma`; any drift or migration failure stops deployment
before a new service revision is created.

Start new production deployments with
`--max-instances=1`, verify the Master Admin "Cloud Run Scaling Readiness"
panel, then raise max instances gradually only after smoke/load testing. Cloud
SQL deployments now use PostgreSQL-backed auth/org metadata, a shared login
attempt store, request-scoped winery reads, and versioned JSONB writes.

## 0b. GCS backup/fallback bucket

Cloud Run's container filesystem is **ephemeral** — `db.json` (all per-user data)
is wiped on every new revision, deploy, or instance scale-up. To make data
durable, the server can mirror `db.json` to a **Google Cloud Storage** bucket.
This is **opt-in**: when `GCS_BUCKET` is unset the app uses the local file
(unchanged for local/dev). When set, it loads the DB from the bucket on startup
and writes it back (debounced) on every change.

### Step 0.1: Create a bucket (once)
```bash
gcloud storage buckets create gs://cellarflow-db --location=europe-west1 --uniform-bucket-level-access
```

### Step 0.2: Grant the Cloud Run service account access
Find the service account your service runs as (defaults to the Compute SA,
`PROJECT_NUMBER-compute@developer.gserviceaccount.com`), then:
```bash
gcloud storage buckets add-iam-policy-binding gs://cellarflow-db \
  --member="serviceAccount:445298255193-compute@developer.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

### Fallback-only deploy with the bucket configured
```bash
gcloud run deploy cellarflow-app --source . --region europe-west1 --allow-unauthenticated \
  --max-instances=1 \
  --set-env-vars NODE_ENV=production,GCS_BUCKET=cellarflow-db
```
Use this only when Cloud SQL is intentionally not configured. The object key defaults to `db.json`; override with `GCS_DB_OBJECT=...` if needed.
Auth uses the service account automatically (Application Default Credentials) —
no key files. On first boot the freshly-seeded DB is uploaded; thereafter every
revision restores from the bucket, so data survives redeploys.

### Step 0.4: Verify and deploy from GitHub Actions

The repository has two release workflows:

```text
.github/workflows/ci.yml
.github/workflows/google-cloud-run.yml
```

`Continuous Integration` runs on every pull request to `main`, every push to
`main`, manual dispatch, and as the first job of a production deployment. It
runs a high/critical production-dependency audit, locked dependency
installation, Prisma generation, typecheck, the
pre-build tests, a fresh production build, bundle budgets, and the production
boot smoke in that order.

`Google Cloud Run Deploy` then:

* builds one commit/run-tagged container image;
* verifies required-secret fail-fast behavior inside that image;
* boots that exact image and runs the HTTP production smoke against it;
* pushes it to an immutable-tag Artifact Registry repository;
* runs the image as a single-task, zero-retry Cloud Run migration job and waits for success;
* resolves the image digest and deploys with `gcloud run deploy --image`;
* verifies that Cloud Run's latest ready revision references the expected digest;
* updates three deterministic AI monitoring jobs (hourly, daily, and weekly);
* updates an AI email delivery job and schedules it every 15 minutes;
* secures every AI schedule with an OAuth-authenticated Cloud Scheduler trigger;
* public unauthenticated access
* `--max-instances=1` by default for conservative rollout
* GCS-backed `db.json` backup
* automatic bucket creation if missing
* `/api/health` verification and an explicit commit/revision/image summary

The scheduled AI jobs run the same verified image digest as the service.
Monitoring remains rules-only and cannot spend model tokens. Delivery reads the
durable outbox, rechecks the recipient's current opt-in and role, and processes
at most 100 records per execution. Master administrators can inspect run leases,
delivery backlog, and terminal failures from **AI Operations** in the admin
console; manual retry is available only after eligibility is revalidated.

There is no deployment-time source rebuild. The digest that passed the
container smoke is used by both the migration job and the Cloud Run service.

In GitHub repository settings:

1. Protect `main` and require the **Continuous Integration / Release gates** status check before merge.
2. Create a `production` environment, add required reviewers, prevent self-review where available, and restrict deployment branches to `main` or the release branches you explicitly support.
3. Keep deployment concurrency enabled; a second production run queues instead of cancelling an active rollout.

The named live application secrets are read from **Google Cloud Secret
Manager**, not GitHub. Create these secret resources in the target project and
grant the Cloud Run runtime service account access:

```text
cellarflow-session-secret
cellarflow-database-url
cellarflow-gemini-api-key
cellarflow-google-client-id
cellarflow-google-client-secret
cellarflow-admin-username
cellarflow-admin-passcode
cellarflow-smtp-pass
```

Optional non-secret SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_USER`, and `MAIL_FROM`) remain GitHub repository or `production`
environment secrets.

### Custom domain: `PUBLIC_APP_URL`

Mapping a domain to the Cloud Run service is only half the job. The service will
answer on the domain immediately, but every link the server *generates* comes
from `APP_URL`, which the deploy workflow sets — and with no configuration it
sets it to the generated `*.run.app` URL.

After mapping the domain, set a repository variable:

```text
PUBLIC_APP_URL = https://vinos.ge
```

Absolute `https`, no trailing slash; the deploy fails fast on anything else.
Then redeploy so the new value reaches the service and the AI delivery job.

Until this is set, the app still works, but:

* Google sign-in started on the domain completes on run.app. The session cookie
  is host-only, so the user lands back on the domain **appearing signed out**,
  with nothing to indicate why.
* Email verification, password reset, invitation, and approval-review links all
  point at run.app.
* AI notification deep links point at run.app.

Register the same origin as an authorized JavaScript origin and redirect URI on
the Google OAuth client (section 6). `tests/deployAppUrl.test.ts` guards the
workflow behaviour.

`APP_URL` also decides which origin search engines may index. The service
answers on both the custom domain and the generated Cloud Run hostname with
byte-identical pages, so any request arriving on a host other than `APP_URL`
is served `X-Robots-Tag: noindex, nofollow`. Without that, the run.app URL
competes with the real domain in search results and can outrank it. Requests are
not redirected — reaching the service directly by its Cloud Run hostname stays a
valid way to check a deployment.

`public/robots.txt` and `public/sitemap.xml` both name `https://vinos.ge`
explicitly, because those files require absolute URLs. Update them if the
canonical domain ever changes.

For Google Cloud authentication, use one of these options:

**Recommended: Workload Identity Federation**

```text
GCP_WORKLOAD_IDENTITY_PROVIDER
GCP_SERVICE_ACCOUNT
```

**Fallback: service-account JSON**

```text
GCP_SA_KEY
```

The Google identity used by the workflow must be able to push/create the
Artifact Registry repository, deploy and inspect Cloud Run revisions, enable
the required services, manage the configured bucket IAM policy, and act as the
runtime service account. Pre-provision the repository, bucket, and APIs if you
want to grant a narrower day-to-day deployment role.

Then open GitHub Actions, choose **Google Cloud Run Deploy**, run the workflow,
and enter:

```text
project_id: your-gcp-project-id
region: europe-west1
service: cellarflow-app
artifact_repository: cellarflow
cloudsql_instance: your-project:europe-west1:cellarflow-postgres
gcs_bucket: cellarflow-db
gcs_db_object: db.json
demo_login_enabled: false
```

After deploy, open:

```text
https://YOUR_SERVICE_URL/api/health
```

The health endpoint intentionally exposes only non-secret deployment state:
persistence backend, Cloud Run revision metadata, configured/not-configured
integration booleans, and production warnings.

> **GCS fallback still requires `--max-instances=1`.** When Cloud SQL is not
> configured, the whole DB is a single shared GCS object held in each instance's
> memory. With two or more instances running concurrently, their writes can
> overwrite each other. Cloud SQL PostgreSQL is the scalable production backend:
> use the Master Admin readiness panel and load tests before raising Cloud Run
> above one instance.

---

## 1. Local Production Test (Docker Compose)
Before publishing, you can run the production build inside a container locally to verify everything.

1. Ensure your `.env` file contains your API Key:
   ```env
   GEMINI_API_KEY=your_actual_gemini_api_key_here
   ```
2. Create a local folder named `data` and copy your existing `db.json` into it as `data/db.json`:
   ```bash
   mkdir data
   cp db.json data/db.json
   ```
3. Build and start the container:
   ```bash
   docker compose up --build -d
   ```
4. Open `http://localhost:3000` to verify the application. Your database state is saved to `data/db.json`.

---

## 2. Deploying to Render (PaaS)
Render is one of the easiest ways to publish this application.

### Step 2.1: Host Code on GitHub
Ensure all code (including the new `Dockerfile`, `.dockerignore`, and `package.json` modifications) is pushed to a private or public GitHub repository.

### Step 2.2: Setup Render Web Service
1. Log in to [Render](https://render.com) and click **New > Web Service**.
2. Connect your GitHub repository.
3. Configure the service settings:
   * **Language**: `Docker` (Render will automatically detect the `Dockerfile`).
   * **Branch**: `main` (or your default branch).
   * **Region**: Choose the region closest to your operations.
4. Add **Environment Variables**:
   * `GEMINI_API_KEY` = `[Your Google Gemini API Key]`
   * `NODE_ENV` = `production`
   * `PORT` = `3000`
   * `DATABASE_PATH` = `/app/data/db.json`
5. Configure **Persistent Disk (Disks Section)**:
   * **Mount Path**: `/app/data` (Do NOT mount directly to a file like `/app/db.json` as it blocks write/rename execution).
   * **Size**: choose a size that fits your needs, e.g., `5 GiB` for larger datasets. Render allows you to increase the disk size later without redeploying.
   * **Name** (optional): `cellarflow-data`.
6. Click **Deploy Web Service**. Render will build the image and publish it.

---
> **Free‑Tier Note**: Render’s free plan provides a **single 1 GiB persistent disk** and does not support resizing. If your `db.json` grows beyond this, consider upgrading to a paid plan or using an external database (e.g., Supabase, MongoDB Atlas) for larger storage.

## 3. Deploying to Railway (PaaS)
Railway is another great PaaS that supports Docker configurations out of the box.

1. Go to [Railway](https://railway.app) and create a **New Project**.
2. Select **Deploy from GitHub repo** and connect your repository.
3. In the project dashboard:
   * Go to **Variables** and add `GEMINI_API_KEY`, `NODE_ENV=production`, `PORT=3000`, and `DATABASE_PATH=/app/data/db.json`.
   * Go to **Settings** and add a **Volume** to persist `/app/data`.
4. Railway will automatically build and expose the web container with a public domain.

---

## 4. Manual Deployment on a Virtual Private Server (VPS)
If you prefer cheap VPS hosting (e.g., DigitalOcean, Linode, Hetzner, AWS EC2):

1. Install Docker on your server:
   ```bash
   sudo apt-get update
   sudo apt-get install -y docker.io docker-compose
   ```
2. Clone your repository on the server.
3. Create a local `data` directory and copy `db.json` into it: `mkdir data && cp db.json data/db.json`
4. Create a `.env` file with your `GEMINI_API_KEY`.
5. Run:
   ```bash
   docker-compose up -d --build
   ```
6. Setup a reverse proxy (e.g., Nginx) to route port 80/443 traffic to port 3000, and use **Certbot** to install SSL certificates.
## 5. Free Alternative Hosting Options

Below are some free‑tier services you can use to host the Vinea ERP app.

### Fly.io (Free tier)
> **Note (2026-07):** this repo no longer targets Fly — the `fly.toml` and deploy
> workflow were removed after the account trial ended; Cloud Run is the supported
> path. The steps below remain as generic from-scratch guidance. `SESSION_SECRET`
> is now also required in production alongside the variables listed below.
* **Plan**: Free tier gives you 3 GB RAM, 1 vCPU, and a 1 GiB persistent volume.
* **Setup**:
  1. Install the Fly CLI: `curl -L https://fly.io/install.sh | sh`.
  2. `fly launch` – choose Docker image, select a region, and accept the default settings.
  3. When prompted for a volume, accept the default size (1 GiB) and mount it at `/app/data`.
  4. Add environment variables (`GEMINI_API_KEY`, `NODE_ENV=production`, `PORT=3000`, `DATABASE_PATH=/app/data/db.json`) via `fly secrets set`.
  5. Deploy: `fly deploy`.

### Vercel (Free tier – Serverless Functions)
* Good for the **frontend** (React/Vite) and simple API routes.
* Create a `vercel.json` that proxies API requests to a serverless function.
* Store the JSON DB in a **Vercel KV** (free tier up to 1 GiB) or use an external free DB like Supabase.

### Supabase (Free tier – Hosted PostgreSQL)
* Use Supabase as a fully‑managed PostgreSQL database (up to 500 MB storage for free).
* Replace the local `db.json` with a tiny API layer that reads/writes to Supabase.
* Deploy the API on Fly.io, Railway, or Render (free tier) and keep only the DB on Supabase.

### GitHub Codespaces / GitHub Actions + GitHub Pages
* Build the Docker image in a GitHub Action and push it to the GitHub Container Registry.
* Use GitHub Pages (free) to host the static frontend; the backend can run as a **GitHub Action‑triggered** container on the free tier of **GitHub Packages**.

### Railway (Free Tier – already listed)
* Gives you a 500 MB volume; sufficient for small `db.json` files.

> **Tip**: For any of these services, make sure the **mount path** is a directory (e.g., `/app/data`) and set `DATABASE_PATH` accordingly, as the app expects a writable folder.

Feel free to pick the one that best fits your needs; I can help you modify the code or configuration for any of these platforms.

---

## 6. Configuring Google OAuth2 (Google Sign-In)

For the "Continue with Google" button to successfully authenticate users using their real Google accounts:

### Step 6.1: Create Google OAuth Credentials
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or select an existing one).
3. Search for and open the **OAuth Consent Screen** page:
   * Select **External** user type.
   * Configure the App Information (app name, support email).
   * In the **Scopes** step, add the following scopes:
     * `.../auth/userinfo.email` (openid email)
     * `.../auth/userinfo.profile` (openid profile)
     * `openid`
4. Search for and open the **Credentials** page:
   * Click **Create Credentials** > **OAuth Client ID**.
   * Select **Web Application** as the Application Type.
    * Add **Authorized JavaScript Origins** — every hostname the service answers
      on:
      * Local: `http://localhost:3000`
      * Production (custom domain): `https://vinos.ge`
      * Production: `https://cellarflow-app-445298255193.europe-west1.run.app`
      * Production (alternate Cloud Run hostname): `https://cellarflow-app-tzjx5orr7q-ew.a.run.app`
    * Add **Authorized Redirect URIs**:
      * Local: `http://localhost:3000/api/auth/google/callback`
      * Production (custom domain): `https://vinos.ge/api/auth/google/callback`
      * Production: `https://cellarflow-app-445298255193.europe-west1.run.app/api/auth/google/callback`
      * Production (alternate): `https://cellarflow-app-tzjx5orr7q-ew.a.run.app/api/auth/google/callback`

      > **Which one is actually used.** `appBaseUrl` returns `APP_URL` whenever
      > it is set, and the deploy workflow always sets it, so in production the
      > callback is built from `APP_URL` alone — *not* from the host the user
      > arrived on. Only the `APP_URL` origin's redirect URI is exercised there;
      > the others are for local work and for reaching the service directly by
      > its Cloud Run hostname before `APP_URL` is configured.
      >
      > This is why `PUBLIC_APP_URL` must point at the custom domain. With
      > `APP_URL` left on the run.app URL, a user who signs in from `vinos.ge`
      > is redirected to run.app, and the session cookie — host-only, with no
      > `Domain=` attribute — is set there. Returning to `vinos.ge` they appear
      > signed out, with no error to explain it.
    * Click **Create** and copy the generated **Client ID** and **Client Secret**.
 
 ### Step 6.2: Set Environment Variables
 Add the Client ID and Secret to your environment configurations:
 
 * **Locally**: Set them in your `.env` file:
   ```env
   GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-your_client_secret_here
   ```
* **On Google Cloud Run**: Configure these values through Secret Manager or Cloud Run environment variables; Secret Manager is preferred for production. Redeploying with environment variables looks like:
  ```bash
  gcloud run deploy cellarflow-app --set-env-vars GOOGLE_CLIENT_ID="your_client_id_here",GOOGLE_CLIENT_SECRET="your_client_secret_here",ALLOW_RUNTIME_OAUTH_CONFIG=false --region europe-west1
  ```
* **Production safety**: keep `ALLOW_RUNTIME_OAUTH_CONFIG=false`. In production, the in-browser setup screen at `/api/auth/google/login?reconfigure=true` and the `/api/auth/google/configure` endpoint are blocked by default so OAuth credentials cannot be changed from the public app. If you ever enable `ALLOW_RUNTIME_OAUTH_CONFIG=true` for maintenance, redeploy it back to `false` immediately after updating credentials.

### Step 6.3: Replacing a deleted or rotated OAuth client

`Access blocked: Authorization Error — Error 401: deleted_client` on the Google
consent page means the client ID the app sent no longer exists in Cloud Console.
No code change can revive it; a new client has to be created and rolled out.

Confirm which failure you have before rebuilding anything — a dead client answers
the token endpoint distinctly (`deleted_client` vs `invalid_client` for a wrong
secret, and `invalid_grant` for a client that is alive and well):

```bash
curl -s -X POST https://oauth2.googleapis.com/token -d "grant_type=authorization_code&code=probe&client_id=$GOOGLE_CLIENT_ID&client_secret=$GOOGLE_CLIENT_SECRET&redirect_uri=http://localhost:3000/api/auth/google/callback"
```

Then create a replacement client per Step 6.1 and publish it:

```bash
printf %s "NEW_CLIENT_ID" | gcloud secrets versions add cellarflow-google-client-id --project=cellarflow --data-file=-
```

```bash
printf %s "NEW_CLIENT_SECRET" | gcloud secrets versions add cellarflow-google-client-secret --project=cellarflow --data-file=-
```

```bash
gcloud run services update cellarflow-app --region europe-west1 --project cellarflow --update-secrets "GOOGLE_CLIENT_ID=cellarflow-google-client-id:latest,GOOGLE_CLIENT_SECRET=cellarflow-google-client-secret:latest"
```

Cloud Run resolves `:latest` at instance start, so the service update above is
what actually picks up the new secret versions. Use `printf %s` (never `echo` or
PowerShell `Out-File`) — a trailing newline or a UTF-8 BOM in the secret payload
makes Google reject the token exchange with a misleading `invalid_client`.

Finally, verify the deployed service is pointing at the new client:

```bash
curl -s -o /dev/null -D - https://cellarflow-app-445298255193.europe-west1.run.app/api/auth/google/login
```

The `location:` header shows the `client_id` in use.

---

## 7. Optional Public Demo Workspace

The public demo is opt-in and uses the same persistence, sync, weather, and AI
paths as a normal account. It does **not** inject sample vessels, lots, weather,
lab analyses, tasks, or documents.

Configure the deployment with:

```env
DEMO_LOGIN_ENABLED=true
DEMO_USERNAME=demo
DEMO_EMAIL=demo@your-domain.example
DEMO_FULL_NAME=Demo Cellar
DEMO_ROLE=Winemaker
```

When enabled, the sign-in page shows **Open Demo Workspace**. The account is
created on first use and its records are persisted in the configured database
backend. The default role is `Winemaker`, so the demo account cannot use
owner-only database reset controls. Set `DEMO_ROLE=Read-Only` for a browse-only
public deployment.
