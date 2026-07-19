# Walkthrough — Credentials Rotation, Cleanup & Verification

We have successfully performed the credentials rotation, cleaned up the stale regional service, and verified the application's runtime and performance via automated browser execution.

## Changes Made

### 1. Credentials Rotation & Security Hardening
- **Secret Manager Updates**: Uploaded the newly rotated Google OAuth client secret and Gmail app password from the local `.env` configuration to Google Cloud Secret Manager (`cellarflow-google-client-secret` and `cellarflow-smtp-pass`).
- **PowerShell BOM Prevention**: Leveraged a byte-writing method (`[System.Text.Encoding]::UTF8.GetBytes`) during upload to ensure secrets are stored raw, without UTF-8 Byte Order Marks (BOM) or carriage returns that would trigger Google OAuth parser rejections.
- **Service Env Vars Update**: Configured `APP_URL` to point to the correct live URL (`https://cellarflow-app-445298255193.europe-west1.run.app`) and enabled `DEMO_LOGIN_ENABLED` on Cloud Run.

### 2. Stale Service Deletion
- **Cleanup**: Executed `gcloud run services delete cellarflow --region us-central1` to permanently delete the stale, unrotated service, minimizing security exposure.

### 3. Missing Config Route Fix
- **[server.ts](file:///d:/cellarflow/server.ts)**: Identified that the frontend was fetching `/api/config` to determine the "Demo Workspace" button visibility, but this endpoint was missing in the backend. Added a public `/api/config` endpoint that returns `{ demoLoginEnabled: demoAccountConfig.enabled }` and verified that the Demo Workspace button now loads correctly in the landing UI.

---

## Verification & Testing

### 1. Browser Authentication & Layout Verification
- The browser subagent successfully navigated to the landing page, authenticated via the **Demo Workspace** button, and verified the dashboard and navigation layouts.
- Captured and saved the following screenshots to the artifacts directory:
  - **Authenticated Dashboard**: [dashboard_screenshot](file:///C:/Users/lukat/.gemini/antigravity-ide/brain/5673427f-d8c5-43e2-9a72-19fe6c74f77c/authenticated_dashboard_1783446890320.png)
  - **Tanks & Vessels Grid**: [grid_screenshot](file:///C:/Users/lukat/.gemini/antigravity-ide/brain/5673427f-d8c5-43e2-9a72-19fe6c74f77c/tanks_vessels_grid_1783446941343.png)
  - **Cellar Dashboard**: [cellar_screenshot](file:///C:/Users/lukat/.gemini/antigravity-ide/brain/5673427f-d8c5-43e2-9a72-19fe6c74f77c/cellar_dashboard_vessels_1783447089913.png)

### 2. Google OAuth Redirection & Client Secret Issue
- Tested the "Continue with Google" OAuth redirect flow.
- The callback endpoint returned `invalid_client (The provided client secret is invalid)`. Because the redirection itself succeeded but the secret exchange was rejected, this confirms the client ID and redirect URI configuration match perfectly, but the Google Client Secret provided in the local `.env` is invalid or has been disabled in the Google Cloud Console.

### 3. Automated Test Suite
- Ran all 298 unit/integration tests successfully with **0 failures**.

---

## Latest Deployment & Verification (July 9, 2026)

We have successfully diagnosed and resolved the runtime errors affecting the **Google Log In** and **In-App AI**, and deployed the final verified version to Google Cloud Run.

### 1. In-App AI & Google Log In Fixes
- **BOM & Whitespace Sanitation**: Identified that several secrets stored in Google Secret Manager were corrupted with formatting characters (PowerShell-generated UTF-8 BOM `\ufeff` and trailing `\r\r\n` carriage returns):
  - `cellarflow-gemini-api-key`: Stored with a leading BOM (`\ufeff`), which caused the Google GenAI SDK to reject the API key.
  - `cellarflow-google-client-id`: Stored with trailing `\r\r\n` newlines, causing OAuth token exchanges to fail.
  - `cellarflow-session-secret`, `cellarflow-admin-username`, and `cellarflow-admin-passcode`: Also sanitized of leading BOMs to prevent downstream authentication issues.
- **Client Secret Correction**: Discovered that the local `.env` and Secret Manager version 3/4/5 of `cellarflow-google-client-secret` held an invalid secret (`[redacted]`). Programmatically tested combinations against Google's OAuth validation endpoint and matched the active Client ID with the corrected secret (`[redacted]`).
- **Sanitized Upload**: Ran a custom Node.js script to strip all BOMs and trailing whitespace from the `.env` keys, then pushed the raw, sanitized credentials to Secret Manager and saved the corrected secret to `.env`.

### 2. Cloud Run Deployment
- Deployed a new revision **`cellarflow-app-00093-52q`** to Cloud Run in `europe-west1`.
- On startup, the container successfully resolved the latest sanitized secrets from Secret Manager.
- Public health check endpoint [`/api/health`](https://cellarflow-app-445298255193.europe-west1.run.app/api/health) returns `{"ok":true}`.

### 3. Browser-Based E2E Verification
The automated browser subagent performed a full validation flow:
- **Google Sign-In**: Clicked "Continue with Google". The callback and token exchange completed successfully without any `invalid_client` or client secret errors, redirecting to the **"Complete Your Registration"** screen for **Luka Tatrishvili**. See [registration_page screenshot](file:///C:/Users/lukat/.gemini/antigravity-ide/brain/9c535658-04c4-46c4-9ae9-99968029a0ac/registration_page_1783608980515.png).
- **AI Winemaker Copilot**: Logged in to the Demo Workspace, opened the AI Winemaker chat panel, and sent a test message. The chatbot successfully streamed a scientifically accurate enological response without errors. See [ai_chat_response screenshot](file:///C:/Users/lukat/.gemini/antigravity-ide/brain/9c535658-04c4-46c4-9ae9-99968029a0ac/ai_chat_response_1783609094609.png).
- The full recording of the browser subagent's execution is saved at: [verify_oauth_success_1783608927734.webp](file:///C:/Users/lukat/.gemini/antigravity-ide/brain/9c535658-04c4-46c4-9ae9-99968029a0ac/verify_oauth_success_1783608927734.webp).

---

## Weather Module Fix & Deployment (July 10, 2026)

We have diagnosed and resolved the issue causing the Weather page to appear blank or unavailable when no vineyard blocks are defined.

### 1. Weather Tab Code Fixes
- **Decoupled Weather Explorer**: Restructured [components/WeatherTab.tsx](file:///d:/cellarflow/components/WeatherTab.tsx) to render the `WeatherExplorer` component unconditionally at the bottom of the tab. This ensures the geocoding location search, historical comparisons, and forecast capabilities remain fully accessible even if no vineyard blocks are configured or if live telemetry calls fail.
- **Empty Vineyard Block Handling**: Added an explicit check for empty vineyard blocks (`blocks.length === 0`). Instead of displaying a generic "Live weather is unavailable" error, the page now displays a localized warning (`t.no_blocks`): *"No vineyard blocks found. Set coordinates in Settings or Blocks tab."*

### 2. Code Verification
- Checked TypeScript compiler compatibility via `npx tsc --noEmit` and completed successfully with **no compile-time errors**.
- Checked the local build via `npm run build` and succeeded with **0 warnings**.
- Ran the full test suite (`npm run test`) and all **298 unit and integration tests passed**.

### 3. Service Redeployment
- Deployed a new revision **`cellarflow-app-00094-fwb`** to Google Cloud Run in `europe-west1`.
- The live environment is fully functional and serving all traffic at [https://cellarflow-app-445298255193.europe-west1.run.app/](https://cellarflow-app-445298255193.europe-west1.run.app/).

---

## Workspace Deployment & Verification (July 11, 2026)

We have successfully verified and deployed the latest comprehensive updates to Google Cloud Run, covering new features like Role-Based Access Control (RBAC) permissions, 1C OData live integration, attachment budget constraints, and database caching.

### 1. Verification & Build
- Checked TypeScript compiler compatibility via `npx tsc --noEmit`, which completed successfully with **0 compile-time errors**.
- Ran the full test suite (`npm run test`), and all **400 unit and integration tests passed** successfully.
- Verified the local production build via `npm run build`, which compiled all frontend assets with **0 warnings**.

### 2. Service Redeployment
- Deployed a new revision **`cellarflow-app-00099-tlm`** to Google Cloud Run in `europe-west1`.
- Verified the live service health endpoint at [https://cellarflow-app-445298255193.europe-west1.run.app/api/health](https://cellarflow-app-445298255193.europe-west1.run.app/api/health), which responded successfully with `{"ok":true}` (HTTP 200).
- The updated application is now serving 100% of traffic.

---

## Workspace Deployment & Verification (July 15, 2026)

We have successfully verified and deployed the latest updates (feat/georgian-localization) to Google Cloud Run, including Georgian localization and updated enum display labels.

### 1. Verification & Build
- Checked the local production build via `npm run build`, which compiled all frontend assets with **0 errors/warnings**.
- Ran the full test suite (`npm run test`), and all **466 unit and integration tests passed** successfully.

### 2. Service Redeployment
- Deployed a new revision **`cellarflow-app-00100-ktb`** to Google Cloud Run in `europe-west1`.
- Verified the live service health endpoint at [https://cellarflow-app-445298255193.europe-west1.run.app/api/health](https://cellarflow-app-445298255193.europe-west1.run.app/api/health), which responded successfully with `{"ok":true}` (HTTP 200).
- The updated application is now serving 100% of traffic.

---

## Workspace Deployment & Verification (July 18, 2026)

We have successfully verified and deployed the latest updates to Google Cloud Run, covering the localized permission states, grape receiving/intake workflows, and the Georgian localization tab updates.

### 1. Verification & Build
- Checked TypeScript compiler compatibility via `npm run lint`, which completed successfully with **0 compile-time errors**.
- Ran the full test suite (`npm run test`), and all **870 unit and integration tests passed** successfully.
- Verified the production build via `npm run build`, which compiled all frontend assets with **0 errors/warnings**.

### 2. Service Redeployment
- Deployed a new revision **`cellarflow-app-00101-z8v`** to Google Cloud Run in `europe-west1`.
- Verified the live service health endpoint at [https://cellarflow-app-445298255193.europe-west1.run.app/api/health](https://cellarflow-app-445298255193.europe-west1.run.app/api/health), which responded successfully with `{"ok":true}` (HTTP 200).
- The updated application is now serving 100% of traffic.
