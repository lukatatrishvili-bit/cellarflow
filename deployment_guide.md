# Vinea ERP Deployment Guide

This guide explains how to build, run, and publish the Vinea ERP application in a production environment.

---

## Technical Architecture Overview
* **Frontend**: React + Vite (Single Page Application).
* **Backend**: Express (Node.js) server running on TypeScript.
* **Database**: Local JSON storage (`db.json`) handled by Express sync.
* **AI Engine**: Google GenAI SDK (requires `GEMINI_API_KEY` configured in the environment).

---

## 0. Persistent Database on Google Cloud Run (IMPORTANT)

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

### Step 0.3: Deploy with the bucket configured
```bash
gcloud run deploy cellarflow-app --source . --region europe-west1 --allow-unauthenticated \
  --max-instances=1 \
  --set-env-vars NODE_ENV=production,GCS_BUCKET=cellarflow-db
```
The object key defaults to `db.json`; override with `GCS_DB_OBJECT=...` if needed.
Auth uses the service account automatically (Application Default Credentials) —
no key files. On first boot the freshly-seeded DB is uploaded; thereafter every
revision restores from the bucket, so data survives redeploys.

> **`--max-instances=1` is required.** The whole DB is a single shared GCS
> object held in each instance's memory. With two or more instances running
> concurrently, their writes overwrite each other (last upload wins → lost
> data). Capping at one instance avoids this. To scale beyond one instance,
> move to per-user object keys, Cloud SQL, or Firestore. The server logs a
> warning at startup reminding you of this.

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
    * Add **Authorized JavaScript Origins** (if running custom domains or testing):
      * Local: `http://localhost:3000`
      * Production: `https://cellarflow-app-445298255193.europe-west1.run.app`
    * Add **Authorized Redirect URIs**:
      * Local: `http://localhost:3000/api/auth/google/callback`
      * Production: `https://cellarflow-app-445298255193.europe-west1.run.app/api/auth/google/callback`
    * Click **Create** and copy the generated **Client ID** and **Client Secret**.
 
 ### Step 6.2: Set Environment Variables
 Add the Client ID and Secret to your environment configurations:
 
 * **Locally**: Set them in your `.env` file:
   ```env
   GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-your_client_secret_here
   ```
 * **On Google Cloud Run**: You can configure these environment variables in your Cloud Run service configuration via the GCP Console or by redeploying the service with:
   ```bash
   gcloud run deploy cellarflow-app --set-env-vars GOOGLE_CLIENT_ID="your_client_id_here",GOOGLE_CLIENT_SECRET="your_client_secret_here" --region europe-west1
   ```
 Or set them directly on the setup screen at `/api/auth/google/login?reconfigure=true`.

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
