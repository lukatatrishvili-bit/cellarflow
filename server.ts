import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from "@google/genai";
import { getDB, saveDB, createEmptyUserData } from './server/db';
import { verifySessionToken, createSessionToken, hashPassword, verifyPassword } from './server/auth';
import { applyDeletions, mergeCollections } from './server/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env manually if running locally and process.env.GEMINI_API_KEY is not set
if (!process.env.GEMINI_API_KEY) {
  try {
    const envPath = path.resolve(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const firstEqual = trimmed.indexOf('=');
          if (firstEqual !== -1) {
            const key = trimmed.slice(0, firstEqual).trim();
            let val = trimmed.slice(firstEqual + 1).trim();
            // remove surrounding quotes
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            process.env[key] = val;
          }
        }
      });
    }
  } catch (err) {
    console.warn("Could not load .env file manually:", err);
  }
}

// Gemini model used for all Winemaker AI features. Centralized here so the
// model can be swapped in a single place.
const GEMINI_MODEL = "gemini-2.5-flash";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper to parse cookies manually
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const key = parts[0].trim();
    const val = parts.slice(1).join('=');
    list[key] = decodeURIComponent(val);
  });
  return list;
}

// Authentication endpoints
app.post('/api/auth/register', (req, res) => {
  const { username, email, fullName, role, language, rememberMe, passcode } = req.body;
  const db = getDB();
  
  const cleanUsername = username.toLowerCase().replace(/\s+/g, '_');
  
  let user = db.users.find(u => u.username === cleanUsername);
  if (user) {
    return res.status(400).json({ error: 'Username is already taken' });
  }
  
  user = {
    username: cleanUsername,
    email,
    fullName,
    role,
    language: language || 'en',
    passwordHash: hashPassword(passcode || 'vinea2026')
  };
  db.users.push(user);

  // Initialize empty user-scoped data container
  if (!db.userData) {
    db.userData = {};
  }
  db.userData[cleanUsername] = createEmptyUserData();
  
  saveDB();
  
  const token = createSessionToken({ username: user.username, role: user.role }, rememberMe);
  const maxAge = rememberMe ? 2592000 : 86400; // 30 days vs 24 hours
  res.setHeader('Set-Cookie', `vinea_session=${token}; Path=/; HttpOnly; Max-Age=${maxAge}`);
  res.json({
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    language: user.language
  });
});

app.post('/api/auth/login', (req, res) => {
  const { identifier, passcode, rememberMe } = req.body;
  const db = getDB();
  
  const user = db.users.find(u => u.username === identifier || u.email === identifier);
  if (!user || !verifyPassword(passcode, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or passcode' });
  }
  
  const token = createSessionToken({ username: user.username, role: user.role }, rememberMe);
  const maxAge = rememberMe ? 2592000 : 86400; // 30 days vs 24 hours
  res.setHeader('Set-Cookie', `vinea_session=${token}; Path=/; HttpOnly; Max-Age=${maxAge}`);
  res.json({
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    language: user.language
  });
});

const getRedirectUri = (req: any) => {
  const isLocal = req.headers.host.includes('localhost') || req.headers.host.includes('127.0.0.1');
  const proto = isLocal ? 'http' : 'https';
  return `${proto}://${req.headers.host}/api/auth/google/callback`;
};

app.get('/api/auth/google/login', (req, res) => {
  const db = getDB() as any;
  const clientId = process.env.GOOGLE_CLIENT_ID || db.googleConfig?.clientId;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || db.googleConfig?.clientSecret;
  
  const reconfigure = req.query.reset === 'true' || req.query.reconfigure === 'true';
  
  if (!clientId || !clientSecret || reconfigure) {
    const displayClientId = db.googleConfig?.clientId || '';
    const displayClientSecret = db.googleConfig?.clientSecret || '';

    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Google OAuth2 Setup Required</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8f6f2; color: #1b1715; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
          .card { background: white; border: 1px solid #e8dfd5; padding: 40px; border-radius: 20px; max-width: 600px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.03); box-sizing: border-box; }
          h1 { font-family: Georgia, serif; color: #4e0e15; margin-top: 0; }
          pre { background: #f0ebe4; padding: 15px; border-radius: 10px; font-family: monospace; overflow-x: auto; font-size: 13px; margin: 15px 0; line-height: 1.5; }
          ol { padding-left: 20px; line-height: 1.6; font-size: 14px; }
          li { margin-bottom: 10px; }
          .btn { display: inline-block; background: #4e0e15; color: white; text-decoration: none; padding: 12px 24px; border-radius: 10px; font-weight: bold; border: none; font-size: 13px; cursor: pointer; transition: background 0.2s; font-family: sans-serif; }
          .btn:hover { background: #681820; }
          .form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 15px; }
          .form-group label { font-size: 11px; text-transform: uppercase; font-family: monospace; font-weight: bold; color: #8c7f76; }
          .form-group input { padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; font-family: monospace; width: 100%; box-sizing: border-box; outline: none; background: #fcfbfa; }
          .form-group input:focus { border-color: #4e0e15; background: white; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Google OAuth2 Credentials Setup</h1>
          <p>The application requires <strong>GOOGLE_CLIENT_ID</strong> and <strong>GOOGLE_CLIENT_SECRET</strong> to be configured for Google Sign-In to function.</p>
          
          <div style="background: #fef2f2; border: 1px solid #fee2e2; color: #991b1b; padding: 15px; border-radius: 12px; font-size: 13px; margin: 15px 0; line-height: 1.5; font-family: sans-serif;">
            <strong>Warning:</strong> If you get a <code>401: invalid_client</code> error on the Google page, the Client ID is incorrect, has trailing spaces, or is not yet propagated in Google Cloud Console. Double check your settings below.
          </div>

          <p>Please follow these setup steps:</p>
          <ol>
            <li>Go to the <a href="https://console.cloud.google.com/" target="_blank" style="color: #4e0e15; font-weight: bold; text-decoration: underline;">Google Cloud Console</a>.</li>
            <li>Create a new project or select an existing one.</li>
            <li>Configure the <strong>OAuth Consent Screen</strong> (scopes: <code>openid</code>, <code>email</code>, <code>profile</code>).</li>
            <li>Go to <strong>Credentials > Create Credentials > OAuth client ID</strong> (Application type: <strong>Web application</strong>).</li>
            <li>Add the following Authorized Redirect URIs:
              <pre>http://localhost:3000/api/auth/google/callback<br>https://cellarflow-app.fly.dev/api/auth/google/callback</pre>
            </li>
          </ol>
          
          <h2 style="font-family: Georgia, serif; color: #4e0e15; margin-top: 30px; font-size: 18px; border-top: 1px solid #e8dfd5; padding-top: 25px; margin-bottom: 15px;">Configure & Save Credentials</h2>
          <p style="font-size: 13px; color: #666; margin-bottom: 20px;">You can save your credentials directly to the local database file (<code>db.json</code>). They will be persisted securely across app updates and restarts.</p>
          <form action="/api/auth/google/configure" method="POST">
            <div class="form-group">
              <label>Google Client ID</label>
              <input type="text" name="clientId" required value="${displayClientId}" placeholder="e.g. xxxxx.apps.googleusercontent.com" />
            </div>
            <div class="form-group">
              <label>Google Client Secret</label>
              <input type="password" name="clientSecret" required value="${displayClientSecret}" placeholder="e.g. GOCSPX-xxxxx" />
            </div>
            <div style="display: flex; gap: 15px; align-items: center; margin-top: 10px;">
              <button type="submit" class="btn">Save & Continue to Google</button>
              <a href="/" style="color: #666; text-decoration: none; font-size: 13px; font-weight: bold; font-family: sans-serif;">Cancel</a>
            </div>
          </form>
        </div>
      </body>
      </html>
    `);
    return;
  }
  
  const redirectUri = getRedirectUri(req);
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + 
    `response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=openid%20email%20profile` +
    `&access_type=offline` +
    `&prompt=consent`;
    
  res.redirect(authUrl);
});

app.post('/api/auth/google/configure', (req, res) => {
  const { clientId, clientSecret } = req.body;
  if (!clientId || !clientSecret) {
    return res.status(400).send('Client ID and Client Secret are required');
  }
  
  const db = getDB() as any;
  db.googleConfig = {
    clientId: String(clientId).trim(),
    clientSecret: String(clientSecret).trim()
  };
  saveDB();
  
  res.redirect('/api/auth/google/login');
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Authorization code missing');
  }
  
  const db = getDB() as any;
  const clientId = process.env.GOOGLE_CLIENT_ID || db.googleConfig?.clientId;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || db.googleConfig?.clientSecret;
  const redirectUri = getRedirectUri(req);
  
  try {
    // 1. Exchange auth code for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId || '',
        client_secret: clientSecret || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      }).toString()
    });
    
    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Google token exchange failed:', errText);
      return res.status(tokenRes.status).send(`Failed to exchange code: ${errText}`);
    }
    
    const tokenData = await tokenRes.json() as any;
    const accessToken = tokenData.access_token;
    
    // 2. Fetch user information using access token
    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!userinfoRes.ok) {
      const errText = await userinfoRes.text();
      console.error('Google userinfo fetch failed:', errText);
      return res.status(userinfoRes.status).send(`Failed to fetch userinfo: ${errText}`);
    }
    
    const userinfo = await userinfoRes.json() as any;
    const email = userinfo.email;
    const fullName = userinfo.name || 'Google User';
    
    if (!email) {
      return res.status(400).send('Email not returned by Google');
    }
    
    // 3. Find or register the user in the database
    const db = getDB();
    const cleanEmail = email.toLowerCase().trim();
    let user = db.users.find(u => u.email.toLowerCase().trim() === cleanEmail);
    
    let username = '';
    if (user) {
      username = user.username;
    } else {
      // Create a unique username based on the email prefix
      const emailPrefix = cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
      let baseUsername = emailPrefix || 'google_user';
      username = baseUsername;
      
      let suffix = 1;
      while (db.users.some(u => u.username === username)) {
        username = `${baseUsername}_${suffix}`;
        suffix++;
      }
      
      user = {
        username,
        email: cleanEmail,
        fullName,
        role: 'Winemaker',
        language: 'en',
        passwordHash: ''
      };
      
      db.users.push(user);
      
      if (!db.userData) {
        db.userData = {};
      }
      db.userData[username] = createEmptyUserData();
      saveDB();
    }
    
    // 4. Create and set session cookie
    const token = createSessionToken({ username: user.username, role: user.role }, true);
    res.setHeader('Set-Cookie', `vinea_session=${token}; Path=/; HttpOnly; Max-Age=2592000`);
    
    // Redirect to main site
    res.redirect('/');
  } catch (err) {
    console.error('OAuth2 callback error:', err);
    res.status(500).send(`OAuth2 authentication failed: ${err}`);
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'vinea_session=; Path=/; HttpOnly; Max-Age=0');
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['vinea_session'];
  const session = verifySessionToken(token);
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const db = getDB();
  const user = db.users.find(u => u.username === session.username);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  
  res.json({
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    language: user.language
  });
});

// Administrative database reset endpoint
app.post('/api/admin/reset', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['vinea_session'];
  const session = verifySessionToken(token);
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (session.role !== 'Owner/Admin') {
    return res.status(403).json({ error: 'Forbidden: Only Owner/Admin can reset the database.' });
  }

  const db = getDB();
  if (!db.userData) db.userData = {};
  db.userData[session.username] = createEmptyUserData();

  saveDB();
  res.json(db.userData[session.username]);
});

// Helper to validate ID structure
function isValidId(id: any): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 128 && /^[a-zA-Z0-9_\- ]+$/.test(id);
}

// Sync endpoint
app.post('/api/sync', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['vinea_session'];
  const session = verifySessionToken(token);
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (session.role === 'Read-Only') {
    return res.status(403).json({ error: 'Forbidden: Read-only access.' });
  }

  const db = getDB();
  if (!db.userData) db.userData = {};
  if (!db.userData[session.username]) {
    db.userData[session.username] = createEmptyUserData();
  }
  const userDb = db.userData[session.username];

  const { deletedIds, ...collections } = req.body;

  try {
    // 1. Validate deletedIds syntax & block deletions of bottled lots or audit logs
    if (deletedIds !== undefined) {
      if (!Array.isArray(deletedIds)) {
        throw new Error('deletedIds must be an array');
      }
      for (const id of deletedIds) {
        if (!isValidId(id)) {
          throw new Error(`Invalid deleted ID syntax: ${id}`);
        }
        // Volatile Content Lock
        const existingLot = userDb.lots.find((l: any) => l.id === id);
        if (existingLot && existingLot.stage === 'bottled') {
          throw new Error(`Volatile Content Lock: Bottled wine lot ${id} cannot be deleted.`);
        }
        // Audit Immutability
        const existingAudit = userDb.auditLogs.find((l: any) => l.id === id);
        if (existingAudit) {
          throw new Error(`Audit Immutability: Deletion of audit log ${id} is forbidden.`);
        }
      }
    }

    // 2. Validate collections syntax and schema integrity
    for (const key of Object.keys(collections)) {
      if (key === 'users') {
        throw new Error('Modifying user credentials via sync is forbidden');
      }
      if (key === 'companyProfile') {
        const profile = collections[key];
        if (profile && typeof profile === 'object') {
          if (profile.latitude !== undefined && typeof profile.latitude !== 'number') {
            throw new Error('companyProfile latitude must be a number');
          }
          if (profile.longitude !== undefined && typeof profile.longitude !== 'number') {
            throw new Error('companyProfile longitude must be a number');
          }
        }
        continue;
      }
      
      const clientList = collections[key];
      if (clientList !== undefined) {
        if (!Array.isArray(clientList)) {
          throw new Error(`Collection ${key} must be an array of objects`);
        }
        for (const item of clientList) {
          if (!item || typeof item !== 'object') {
            throw new Error(`Items in ${key} must be valid objects`);
          }
          if (!isValidId(item.id)) {
            throw new Error(`Item in ${key} has invalid or missing ID: ${item.id}`);
          }

          // General Time Invariance / Immutable properties check
          const existingItem = (userDb as any)[key]?.find((x: any) => x.id === item.id);
          if (existingItem) {
            if (item.createdAt !== undefined && item.createdAt !== existingItem.createdAt) {
              throw new Error(`Immortal Field Mutation: createdAt cannot be modified on item ${item.id}.`);
            }
            if (item.originalOwnerId !== undefined && item.originalOwnerId !== existingItem.originalOwnerId) {
              throw new Error(`Immortal Field Mutation: originalOwnerId cannot be modified on item ${item.id}.`);
            }
          }

          // Viticulture log referential integrity check (blockId must exist and not be deleted)
          const hasBlockRef = ['scoutings', 'phenologyLogs', 'sprays', 'soilRecords', 'samplings', 'harvests', 'irrigationLogs', 'fertilizerLogs'].includes(key);
          if (hasBlockRef && item.blockId !== undefined) {
            if (!isValidId(item.blockId)) {
              throw new Error(`Item in ${key} has invalid referenced blockId.`);
            }
            const blockExists = userDb.blocks.some((b: any) => b.id === item.blockId) || (collections.blocks && collections.blocks.some((b: any) => b.id === item.blockId));
            const blockDeleted = deletedIds && deletedIds.includes(item.blockId);
            if (!blockExists || blockDeleted) {
              throw new Error(`Orphaned Reference: Item in ${key} references non-existent or deleted Block (${item.blockId}).`);
            }
          }

          if (key === 'vessels') {
            const capacity = item.capacity !== undefined ? item.capacity : (existingItem ? existingItem.capacity : undefined);
            const currentVolume = item.currentVolume !== undefined ? item.currentVolume : (existingItem ? existingItem.currentVolume : undefined);
            const assignedLotId = item.assignedLotId !== undefined ? item.assignedLotId : (existingItem ? existingItem.assignedLotId : undefined);

            if (capacity !== undefined) {
              if (typeof capacity !== 'number' || capacity <= 0) {
                throw new Error(`Vessel ${item.id} capacity must be a positive number.`);
              }
            } else {
              throw new Error(`Vessel ${item.id} must have a capacity.`);
            }

            if (currentVolume !== undefined) {
              if (typeof currentVolume !== 'number' || currentVolume < 0) {
                throw new Error(`Vessel ${item.id} volume cannot be negative.`);
              }
              if (currentVolume > capacity) {
                throw new Error(`Capacity Theft: Vessel ${item.id} volume (${currentVolume}) exceeds physical capacity (${capacity}).`);
              }
            }

            if (assignedLotId !== undefined && assignedLotId !== null) {
              if (!isValidId(assignedLotId)) {
                throw new Error(`Vessel ${item.id} has invalid referenced assignedLotId.`);
              }
              const lotExists = userDb.lots.some((l: any) => l.id === assignedLotId) || (collections.lots && collections.lots.some((l: any) => l.id === assignedLotId));
              const lotDeleted = deletedIds && deletedIds.includes(assignedLotId);
              if (!lotExists || lotDeleted) {
                throw new Error(`Orphaned Reference: Vessel ${item.id} references non-existent or deleted Lot (${assignedLotId}).`);
              }
              
              const lot = userDb.lots.find((l: any) => l.id === assignedLotId) || (collections.lots && collections.lots.find((l: any) => l.id === assignedLotId));
              if (lot && lot.stage === 'bottled') {
                if (existingItem && currentVolume !== undefined && currentVolume < existingItem.currentVolume) {
                  throw new Error(`Volatile Content Lock: Vessel ${item.id} volume containing bottled lot cannot decrease.`);
                }
              }
            }
          }
          
          else if (key === 'lots') {
            const existingLot = existingItem;
            const currentVolume = item.currentVolume !== undefined ? item.currentVolume : (existingLot ? existingLot.currentVolume : undefined);
            const initialVolume = item.initialVolume !== undefined ? item.initialVolume : (existingLot ? existingLot.initialVolume : undefined);

            if (initialVolume !== undefined && (typeof initialVolume !== 'number' || initialVolume < 0)) {
              throw new Error(`Lot ${item.id} initial volume cannot be negative.`);
            }
            if (currentVolume !== undefined && (typeof currentVolume !== 'number' || currentVolume < 0)) {
              throw new Error(`Lot ${item.id} volume cannot be negative.`);
            }

            if (existingLot && existingLot.stage === 'bottled') {
              if (currentVolume !== undefined && currentVolume < existingLot.currentVolume) {
                throw new Error(`Volatile Content Lock: Bottled wine lot ${item.id} volume cannot decrease.`);
              }
              const frozenFields = ['name', 'vintage', 'variety', 'vineyardBlock', 'region', 'wineClass', 'stage'];
              for (const field of frozenFields) {
                if (item[field] !== undefined && item[field] !== existingLot[field]) {
                  throw new Error(`Volatile Content Lock: Bottled wine lot ${item.id} parameter '${field}' is frozen.`);
                }
              }
            }
          }

          else if (key === 'fermlogs') {
            if (!isValidId(item.tankId) || !isValidId(item.lotId)) {
              throw new Error(`Fermentation log ${item.id} has invalid referenced IDs.`);
            }
            const lotExists = (userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId))) &&
                              !(deletedIds && deletedIds.includes(item.lotId));
            const tankExists = (userDb.vessels.some((v: any) => v.id === item.tankId) || (collections.vessels && collections.vessels.some((v: any) => v.id === item.tankId))) &&
                               !(deletedIds && deletedIds.includes(item.tankId));
            if (!lotExists || !tankExists) {
              throw new Error(`Orphaned Fermentation: Fermentation log ${item.id} references non-existent or deleted Lot (${item.lotId}) or Vessel (${item.tankId}).`);
            }
            if (item.temperature !== undefined && typeof item.temperature !== 'number') {
              throw new Error(`Fermentation log ${item.id} temperature must be a number`);
            }
            if (item.density !== undefined && (typeof item.density !== 'number' || item.density < 0)) {
              throw new Error(`Fermentation log ${item.id} density cannot be negative`);
            }
            if (item.sugar !== undefined && (typeof item.sugar !== 'number' || item.sugar < 0)) {
              throw new Error(`Fermentation log ${item.id} sugar cannot be negative`);
            }
            if (item.ph !== undefined && (typeof item.ph !== 'number' || item.ph < 0)) {
              throw new Error(`Fermentation log ${item.id} pH cannot be negative`);
            }
          }

          else if (key === 'lablogs') {
            if (!isValidId(item.tankId) || !isValidId(item.lotId)) {
              throw new Error(`Lab analysis ${item.id} has invalid referenced IDs.`);
            }
            const lotExists = (userDb.lots.some((l: any) => l.id === item.lotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.lotId))) &&
                              !(deletedIds && deletedIds.includes(item.lotId));
            const tankExists = (userDb.vessels.some((v: any) => v.id === item.tankId) || (collections.vessels && collections.vessels.some((v: any) => v.id === item.tankId))) &&
                               !(deletedIds && deletedIds.includes(item.tankId));
            if (!lotExists || !tankExists) {
              throw new Error(`Orphaned Lab Log: Lab analysis ${item.id} references non-existent or deleted Lot (${item.lotId}) or Vessel (${item.tankId}).`);
            }
            const checkFields = ['alcoholPct', 'volatileAcid', 'freeSo2', 'totalSo2', 'residualSugar', 'ph', 'malicAcid', 'lacticAcid', 'turbidity', 'titratableAcidity'];
            for (const field of checkFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Lab analysis ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'inventory') {
            if (item.stock !== undefined && (typeof item.stock !== 'number' || item.stock < 0)) {
              throw new Error(`Inventory item ${item.id} stock cannot be negative.`);
            }
            if (item.minThreshold !== undefined && (typeof item.minThreshold !== 'number' || item.minThreshold < 0)) {
              throw new Error(`Inventory item ${item.id} minThreshold cannot be negative.`);
            }
            if (item.costPerUnit !== undefined && (typeof item.costPerUnit !== 'number' || item.costPerUnit < 0)) {
              throw new Error(`Inventory item ${item.id} costPerUnit cannot be negative.`);
            }
          }

          else if (key === 'tasks') {
            if (item.priority && !['high', 'medium', 'low'].includes(item.priority)) {
              throw new Error(`Task ${item.id} has invalid priority: ${item.priority}`);
            }
            if (item.status && !['pending', 'completed'].includes(item.status)) {
              throw new Error(`Task ${item.id} has invalid status: ${item.status}`);
            }
          }

          else if (key === 'blocks') {
            if (item.area !== undefined && (typeof item.area !== 'number' || item.area < 0)) {
              throw new Error(`Block ${item.id} area cannot be negative.`);
            }
            if (item.elevation !== undefined && (typeof item.elevation !== 'number' || item.elevation < 0)) {
              throw new Error(`Block ${item.id} elevation cannot be negative.`);
            }
            if (item.rowsCount !== undefined && (typeof item.rowsCount !== 'number' || item.rowsCount < 0)) {
              throw new Error(`Block ${item.id} rowsCount cannot be negative.`);
            }
            if (item.vinesCount !== undefined && (typeof item.vinesCount !== 'number' || item.vinesCount < 0)) {
              throw new Error(`Block ${item.id} vinesCount cannot be negative.`);
            }
          }

          else if (key === 'sprays') {
            const checkFields = ['dosePerHa', 'waterVolumePerHa', 'totalProductUsed', 'totalWaterUsed', 'windSpeed', 'temperature', 'humidity'];
            for (const field of checkFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Spray record ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'soilRecords') {
            const checkFields = ['pH', 'organicMatterPct', 'nitrogenMgKg', 'phosphorusMgKg', 'potassiumMgKg', 'calciumMgKg', 'magnesiumMgKg', 'salinityDsm'];
            for (const field of checkFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Soil record ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'samplings') {
            const checkFields = ['brix', 'pH', 'totalAcidityGL', 'berryWeightG'];
            for (const field of checkFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Sampling record ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'harvests') {
            if (item.estimatedTons !== undefined && (typeof item.estimatedTons !== 'number' || item.estimatedTons < 0)) {
              throw new Error(`Harvest ${item.id} estimatedTons cannot be negative.`);
            }
            if (item.actualHarvestedKg !== undefined && (typeof item.actualHarvestedKg !== 'number' || item.actualHarvestedKg < 0)) {
              throw new Error(`Harvest ${item.id} actualHarvestedKg cannot be negative.`);
            }
          }

          else if (key === 'irrigationLogs') {
            const checkFields = ['durationHours', 'waterVolumeLiters', 'soilMoistureBeforePct', 'soilMoistureAfterPct'];
            for (const field of checkFields) {
              if (item[field] !== undefined && (typeof item[field] !== 'number' || item[field] < 0)) {
                throw new Error(`Irrigation record ${item.id} property ${field} must be non-negative.`);
              }
            }
          }

          else if (key === 'fertilizerLogs') {
            if (item.dosePerHa !== undefined && (typeof item.dosePerHa !== 'number' || item.dosePerHa < 0)) {
              throw new Error(`Fertilizer log ${item.id} dosePerHa cannot be negative.`);
            }
            if (item.totalAmountUsed !== undefined && (typeof item.totalAmountUsed !== 'number' || item.totalAmountUsed < 0)) {
              throw new Error(`Fertilizer log ${item.id} totalAmountUsed cannot be negative.`);
            }
          }

          else if (key === 'phenologyLogs') {
            if (item.gdd !== undefined && (typeof item.gdd !== 'number' || item.gdd < 0)) {
              throw new Error(`Phenology record ${item.id} gdd cannot be negative.`);
            }
            if (item.confidence !== undefined && (typeof item.confidence !== 'number' || item.confidence < 0 || item.confidence > 100)) {
              throw new Error(`Phenology record ${item.id} confidence must be between 0 and 100.`);
            }
          }

          else if (key === 'notes') {
            if (item.relatedLotId !== undefined && item.relatedLotId !== null) {
              if (!isValidId(item.relatedLotId)) {
                throw new Error(`Note ${item.id} has invalid referenced relatedLotId.`);
              }
              const lotExists = userDb.lots.some((l: any) => l.id === item.relatedLotId) || (collections.lots && collections.lots.some((l: any) => l.id === item.relatedLotId));
              const lotDeleted = deletedIds && deletedIds.includes(item.relatedLotId);
              if (!lotExists || lotDeleted) {
                throw new Error(`Orphaned Reference: Note ${item.id} references non-existent or deleted Lot (${item.relatedLotId}).`);
              }
            }
          }

          else if (key === 'auditLogs') {
            const existingAudit = userDb.auditLogs.find((l: any) => l.id === item.id);
            if (existingAudit) {
              throw new Error(`Audit Immutability: Modify log ${item.id} is forbidden.`);
            }
          }
        }
      }
    }
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Validation error' });
  }

  // Apply deletions, then merge with optimistic-concurrency conflict
  // detection. Conflicted items are not applied; everything else is.
  applyDeletions(userDb, deletedIds);
  const conflicts = mergeCollections(userDb, collections);

  saveDB();

  if (conflicts.length > 0) {
    return res.json({ hasConflicts: true, conflicts, serverDb: userDb });
  }
  res.json(userDb);
});

// Load DB values initial route
app.get('/api/db', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['vinea_session'];
  const session = verifySessionToken(token);
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getDB();
  if (!db.userData) db.userData = {};
  if (!db.userData[session.username]) {
    db.userData[session.username] = createEmptyUserData();
    saveDB();
  }
  res.json(db.userData[session.username]);
});

// --- MOCK TELEMETRY ENGINE ---
interface TelemetryReading {
  lotId: string;
  tankId: string;
  timestamp: string;
  density: number; // Specific Gravity (SG)
  temperature: number; // °C
  ph: number;
  dissolvedOxygen: number; // mg/L
  dailySlope: number; // SG drop per day
  status: 'active' | 'slow' | 'stuck' | 'finished';
}

let simulatedTelemetry: Record<string, Record<string, TelemetryReading>> = {};

function initTelemetry(username: string, userDb: any) {
  const fermentingLots = userDb.lots.filter((l: any) => l.stage === 'fermenting');
  if (!simulatedTelemetry[username]) {
    simulatedTelemetry[username] = {};
  }
  const userSimulated = simulatedTelemetry[username];
  const newTelemetry: Record<string, TelemetryReading> = {};
  
  for (const lot of fermentingLots) {
    const vessel = userDb.vessels.find((v: any) => v.assignedLotId === lot.id);
    if (!vessel) continue;
    
    if (userSimulated[lot.id]) {
      newTelemetry[lot.id] = userSimulated[lot.id];
      newTelemetry[lot.id].tankId = vessel.id;
    } else {
      const isStuck = lot.name.toLowerCase().includes('stuck') || lot.id.toLowerCase().includes('stuck');
      newTelemetry[lot.id] = {
        lotId: lot.id,
        tankId: vessel.id,
        timestamp: new Date().toISOString(),
        density: isStuck ? 1.024 : 1.012,
        temperature: isStuck ? 15.5 : 21.8,
        ph: 3.5,
        dissolvedOxygen: isStuck ? 0.04 : 0.35,
        dailySlope: isStuck ? 0.0008 : 0.012,
        status: isStuck ? 'stuck' : 'active'
      };
    }
  }
  simulatedTelemetry[username] = newTelemetry;
}

app.get('/api/telemetry/active', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['vinea_session'];
  const session = verifySessionToken(token);
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getDB();
  if (!db.userData) db.userData = {};
  if (!db.userData[session.username]) {
    db.userData[session.username] = createEmptyUserData();
  }
  const userDb = db.userData[session.username];

  initTelemetry(session.username, userDb);

  const userSimulated = simulatedTelemetry[session.username] || {};
  Object.keys(userSimulated).forEach((lotId) => {
    const t = userSimulated[lotId];
    t.timestamp = new Date().toISOString();
    
    if (t.status === 'stuck') {
      t.density = parseFloat((t.density - 0.00005 + (Math.random() - 0.5) * 0.0001).toFixed(4));
      t.temperature = parseFloat((15.5 + (Math.random() - 0.5) * 0.3).toFixed(1));
      t.dailySlope = 0.0008;
    } else if (t.status === 'active') {
      t.density = parseFloat((t.density - 0.0012 + (Math.random() - 0.5) * 0.0002).toFixed(4));
      t.temperature = parseFloat((21.8 + (Math.random() - 0.5) * 0.5).toFixed(1));
      t.dailySlope = 0.012;
      if (t.density <= 0.992) {
        t.density = 0.992;
        t.status = 'finished';
        t.dailySlope = 0;
      }
    }
  });

  res.json(Object.values(userSimulated));
});

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// -------------------------------------------------------------
// POST /api/gemini — Winemaker AI assistant
// Consumed by the AI chat (AiWinemaker) and the Weather tab.
// -------------------------------------------------------------
app.post('/api/gemini', async (req, res) => {
  try {
    const { prompt, cellarState, stream } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({
        error: "API key is not configured yet. Please configure GEMINI_API_KEY in Settings."
      });
    }

    const SYSTEM_PROMPT = `You are the Vinea AI Winemaker Assistant, a world-class enological advisor, biochemist, and cellar processes expert.
You help winemakers worldwide with:
1. Stuck and sluggish fermentation diagnostics (sugar curves, temperature, nitrogen, density) and restart protocols.
2. Chemical additions and pH modeling: free SO2 calculations, potassium metabisulfite (KMBS) formulations, tartaric acid / calcium carbonate additions.
3. Traditional Georgian winemaking in clay Qvevris: skin contact maceration times, lid sealing, lime water lining, buried marani temperature dynamics.
4. Malolactic fermentation (MLF) management, volatile acidity (VA) mitigation, barrel aging, oak toast selections, and cellaring sanitation.

Provide highly professional, authentic, scientifically accurate enological advice. Answer concisely, using markdown tables or bullet points where helpful.`;

    let chemicalContext = "";
    if (cellarState) {
      chemicalContext = `
[CURRENT CELLAR SUMMARY]
- Total active vessels: ${cellarState.tanksCount}
- Active fermentations: ${cellarState.activeFermsCount}
- Average fermenter temperature: ${cellarState.avgTemp}°C
- Low SO2 warnings: ${cellarState.lowSo2Count}
- High Volatile Acidity alerts: ${cellarState.highVaCount}

[REPRESENTATIVE TANKS/LOTS]
${JSON.stringify(cellarState.sampleData || [], null, 2)}
`;
    }

    const fullPrompt = `${SYSTEM_PROMPT}\n\n${chemicalContext}\n\nWinemaker Query: ${prompt}\n\nAI Winemaker Response:\n`;

    const client = getAiClient();

    // Streaming (Server-Sent Events) for the chat UI. Callers that don't ask for
    // a stream (e.g. the Weather tab) still get a single JSON response below.
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      try {
        const streamed = await client.models.generateContentStream({
          model: GEMINI_MODEL,
          contents: fullPrompt,
        });
        for await (const chunk of streamed) {
          const piece = chunk.text;
          if (piece) res.write(`data: ${JSON.stringify({ text: piece })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      } catch (streamErr: any) {
        res.write(`data: ${JSON.stringify({ error: streamErr?.message || 'Streaming failed' })}\n\n`);
      }
      return res.end();
    }

    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: fullPrompt,
    });

    return res.json({ text: response.text });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    if (error?.message?.includes("GEMINI_API_KEY")) {
      return res.status(400).json({
        error: "API key is not configured yet. Please configure GEMINI_API_KEY in Settings."
      });
    }
    return res.status(500).json({
      error: "I am offline. Please verify settings or connection, or ask about general winemaking.",
      details: error?.message || "Unknown error"
    });
  }
});

// Serve frontend
const isProd = process.env.NODE_ENV === 'production';
const server = http.createServer(app);

if (isProd) {
  // Serve production build static files
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*any', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
} else {
  // In development, load Vite middleware dynamically to provide live reload on same port!
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { 
      middlewareMode: true,
      hmr: { server }
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

const PORT = parseInt(process.env.PORT || '3000', 10);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running in ${isProd ? 'production' : 'development'} on http://0.0.0.0:${PORT}`);
});

