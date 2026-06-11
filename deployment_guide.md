# Vinea ERP Deployment Guide

This guide explains how to build, run, and publish the Vinea ERP application in a production environment.

---

## Technical Architecture Overview
* **Frontend**: React + Vite (Single Page Application).
* **Backend**: Express (Node.js) server running on TypeScript.
* **Database**: Local JSON storage (`db.json`) handled by Express sync.
* **AI Engine**: Google GenAI SDK (requires `GEMINI_API_KEY` configured in the environment).

---

## 1. Local Production Test (Docker Compose)
Before publishing, you can run the production build inside a container locally to verify everything.

1. Ensure your `.env` file contains your API Key:
   ```env
   GEMINI_API_KEY=your_actual_gemini_api_key_here
   ```
2. Build and start the container:
   ```bash
   docker compose up --build -d
   ```
3. Open `http://localhost:3000` to verify the application. Your database state is saved to the local `db.json` file in your workspace via the volume mount.

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
5. Configure **Persistent Disk (Disks Section)**:
   * **Mount Path**: `/app/db.json` (or mount a disk at `/app/data` and configure the Express server DB path to write here).
   * **Size**: `1 GiB` is plenty for JSON logs.
6. Click **Deploy Web Service**. Render will build the image and publish it.

---

## 3. Deploying to Railway (PaaS)
Railway is another great PaaS that supports Docker configurations out of the box.

1. Go to [Railway](https://railway.app) and create a **New Project**.
2. Select **Deploy from GitHub repo** and connect your repository.
3. In the project dashboard:
   * Go to **Variables** and add `GEMINI_API_KEY`, `NODE_ENV=production`, and `PORT=3000`.
   * Go to **Settings** and add a **Volume** to persist `/app/db.json`.
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
3. Create a `.env` file with your `GEMINI_API_KEY`.
4. Run:
   ```bash
   docker-compose up -d --build
   ```
5. Setup a reverse proxy (e.g., Nginx) to route port 80/443 traffic to port 3000, and use **Certbot** to install SSL certificates.
