import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distIndexPath = path.join(rootDir, 'dist', 'index.html');

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function reservePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  if (!port) throw new Error('Could not reserve a local port for the production smoke test.');
  return port;
}

function captureServer(env: NodeJS.ProcessEnv): {
  child: ChildProcess;
  output: () => string;
} {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: rootDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', chunk => { stdout += String(chunk); });
  child.stderr?.on('data', chunk => { stderr += String(chunk); });
  return { child, output: () => `${stdout}\n${stderr}`.trim() };
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Child process did not exit within ${timeoutMs} ms.`));
    }, timeoutMs);
    const onExit = (code: number | null) => {
      cleanup();
      resolve(code);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
    };
    child.once('exit', onExit);
  });
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  try {
    await waitForExit(child, 10_000);
  } catch {
    child.kill('SIGKILL');
    await waitForExit(child, 5_000).catch(() => undefined);
  }
}

async function waitForHealth(
  baseUrl: string,
  processHandle?: ReturnType<typeof captureServer>,
): Promise<Response> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (processHandle && processHandle.child.exitCode !== null) {
      throw new Error(`Production server exited before becoming healthy.\n${processHandle.output()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response;
    } catch {
      // Cold startup can refuse connections until database hydration finishes.
    }
    await delay(100);
  }
  const output = processHandle ? `\n${processHandle.output()}` : '';
  throw new Error(`Production server did not become healthy within 20 seconds.${output}`);
}

async function assertProductionHttpContract(baseUrl: string, healthResponse: Response): Promise<void> {
  if (JSON.stringify(await healthResponse.json()) !== JSON.stringify({ ok: true })) {
    throw new Error('Health endpoint returned an unexpected payload.');
  }

  const routeResponse = await fetch(`${baseUrl}/cellar/lots/lot-1`);
  const routeHtml = await routeResponse.text();
  if (!routeResponse.ok || !routeHtml.includes('<div id="root">')) {
    throw new Error('SPA fallback did not return the production index for a deep route.');
  }
  if (!/no-store/i.test(routeResponse.headers.get('cache-control') || '')) {
    throw new Error('SPA fallback must not be cached.');
  }

  const missingApi = await fetch(`${baseUrl}/api/this-route-must-not-exist`);
  if (missingApi.status !== 404 || !/application\/json/i.test(missingApi.headers.get('content-type') || '')) {
    throw new Error('Unknown API routes must return a JSON 404 instead of the SPA shell.');
  }

  const workerResponse = await fetch(`${baseUrl}/sw.js`);
  const workerCache = workerResponse.headers.get('cache-control') || '';
  if (!workerResponse.ok || !/no-cache/i.test(workerCache) || /immutable/i.test(workerCache)) {
    throw new Error('The stable service-worker URL must revalidate on deployment.');
  }

  const assetMatch = routeHtml.match(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/i);
  if (!assetMatch) throw new Error('Production index did not reference a hashed JS or CSS asset.');
  const assetResponse = await fetch(new URL(assetMatch[1], baseUrl));
  if (!assetResponse.ok || !/immutable/i.test(assetResponse.headers.get('cache-control') || '')) {
    throw new Error('Hashed production assets must use immutable caching.');
  }
}

async function assertHealthyProductionBoot(databasePath: string): Promise<void> {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const processHandle = captureServer({
    ...process.env,
    NODE_ENV: 'production',
    SESSION_SECRET: 'cellarflow-production-smoke-secret-32-bytes-minimum',
    PORT: String(port),
    DATABASE_URL: '',
    DATABASE_PATH: databasePath,
    GCS_BUCKET: '',
    PRISMA_DB_PUSH_ON_STARTUP: 'false',
    DEMO_LOGIN_ENABLED: 'false',
    VITEST: 'false',
  });

  try {
    const healthResponse = await waitForHealth(baseUrl, processHandle);
    await assertProductionHttpContract(baseUrl, healthResponse);
  } finally {
    await stopServer(processHandle.child);
  }
}

async function assertMissingSecretFailsClosed(databasePath: string): Promise<void> {
  const port = await reservePort();
  const processHandle = captureServer({
    ...process.env,
    NODE_ENV: 'production',
    SESSION_SECRET: '',
    PORT: String(port),
    DATABASE_URL: '',
    DATABASE_PATH: databasePath,
    GCS_BUCKET: '',
    VITEST: 'false',
  });

  try {
    const exitCode = await waitForExit(processHandle.child, 10_000);
    if (exitCode === 0 || !/SESSION_SECRET must be set in production/i.test(processHandle.output())) {
      throw new Error(`Production did not fail closed without SESSION_SECRET.\n${processHandle.output()}`);
    }
  } finally {
    await stopServer(processHandle.child);
  }
}

async function main(): Promise<void> {
  const externalBaseUrl = process.env.PRODUCTION_SMOKE_BASE_URL?.replace(/\/+$/, '');
  if (externalBaseUrl) {
    const healthResponse = await waitForHealth(externalBaseUrl);
    await assertProductionHttpContract(externalBaseUrl, healthResponse);
    console.log('Production HTTP smoke passed: health, SPA fallback, API 404, and cache policy.');
    return;
  }

  if (!fs.existsSync(distIndexPath)) {
    throw new Error('Production build is missing. Run `npm run build` before `npm run test:production-smoke`.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-production-smoke-'));
  const databasePath = path.join(tempDir, 'db.json');
  try {
    await assertHealthyProductionBoot(databasePath);
    await assertMissingSecretFailsClosed(databasePath);
    console.log('Production boot smoke passed: health, SPA fallback, API 404, cache policy, and secret fail-fast.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
