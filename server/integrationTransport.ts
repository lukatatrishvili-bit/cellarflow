import dns from 'dns/promises';
import net from 'net';
import type { IntegrationConnectorConfig } from '../lib/integrations';
import { openIntegrationSecret } from './integrationSecrets';

/**
 * Outbound HTTP transport for live 1C OData exchange.
 *
 * The endpoint URL is user-supplied and the server runs inside GCP, so every
 * request goes through an SSRF guard: HTTPS only, no credentials/ports in the
 * URL beyond 443/standard, hostname must not be an IP-literal or resolve to a
 * private / loopback / link-local / metadata address. Responses are size- and
 * time-capped so a hostile endpoint cannot exhaust the instance.
 */

export const MAX_ODATA_RESPONSE_BYTES = 5_000_000;
const OUTBOUND_TIMEOUT_MS = 12_000;
// 1C OData entity sets: Catalog_Номенклатура, Document_РеализацияТоваровУслуг…
const ENTITY_SET_RE = /^[A-Za-z0-9_Ѐ-ӿ]{1,120}$/;

function isPrivateIPv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||   // CGNAT
    (a === 169 && b === 254) ||             // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||               // 192.0.0.0/24 special + 192.0.2.0/24 doc
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224                                // multicast + reserved
  );
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
  if (lower.startsWith('::ffff:')) return isPrivateIPv4(lower.slice(7)); // v4-mapped
  return false;
}

/** Throws with a user-facing message when the URL must not be fetched. */
export async function assertSafeOutboundUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Endpoint is not a valid URL.');
  }
  if (url.protocol !== 'https:') {
    throw new Error('Live exchange requires an HTTPS endpoint.');
  }
  if (url.username || url.password) {
    throw new Error('Endpoint URL must not embed credentials.');
  }
  if (url.port && url.port !== '443') {
    throw new Error('Live exchange only connects on the standard HTTPS port.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    throw new Error('Endpoint host is not allowed.');
  }
  if (net.isIP(hostname)) {
    if (net.isIP(hostname) === 4 ? isPrivateIPv4(hostname) : isPrivateIPv6(hostname)) {
      throw new Error('Endpoint host resolves to a private or reserved address.');
    }
    return url;
  }
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Endpoint host could not be resolved.');
  }
  if (!addresses.length) throw new Error('Endpoint host could not be resolved.');
  for (const { address, family } of addresses) {
    if (family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address)) {
      throw new Error('Endpoint host resolves to a private or reserved address.');
    }
  }
  return url;
}

function authHeaders(connector: IntegrationConnectorConfig): Record<string, string> {
  const secret = openIntegrationSecret(connector.sealedSecret);
  switch (connector.authMode) {
    case 'basic': {
      if (!secret) throw new Error('Connector credential is missing — re-enter the password and save.');
      const user = connector.username || '';
      return { Authorization: `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}` };
    }
    case 'bearer': {
      if (!secret) throw new Error('Connector credential is missing — re-enter the token and save.');
      return { Authorization: `Bearer ${secret}` };
    }
    case 'api_key': {
      if (!secret) throw new Error('Connector credential is missing — re-enter the API key and save.');
      return { 'X-API-Key': secret };
    }
    default:
      return {};
  }
}

async function fetchOneCJson(connector: IntegrationConnectorConfig, path: string): Promise<unknown> {
  if (!connector.endpointUrl) throw new Error('Connector endpoint URL is not configured.');
  const base = await assertSafeOutboundUrl(connector.endpointUrl);
  const target = new URL(base.toString().replace(/\/+$/, '') + path);
  if (target.origin !== base.origin) throw new Error('Resolved request escaped the configured endpoint.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OUTBOUND_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      headers: { Accept: 'application/json', ...authHeaders(connector) },
      redirect: 'error', // a redirect could bounce us to a private address
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`1C endpoint responded with HTTP ${response.status}.`);
    }
    const text = await response.text();
    if (text.length > MAX_ODATA_RESPONSE_BYTES) {
      throw new Error('1C response exceeds the size limit — narrow the query with a smaller batch.');
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('1C endpoint did not return JSON — check the OData path and $format=json support.');
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('1C endpoint timed out.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface OneCConnectionProbe {
  ok: boolean;
  entitySets: string[];
  message: string;
}

/** GET the OData service document and list the published entity sets. */
export async function testOneCConnection(connector: IntegrationConnectorConfig): Promise<OneCConnectionProbe> {
  const body = await fetchOneCJson(connector, '/?$format=json');
  const value = (body as any)?.value;
  const entitySets = Array.isArray(value)
    ? value.map((entry: any) => String(entry?.name || '')).filter(Boolean).slice(0, 200)
    : [];
  return {
    ok: true,
    entitySets,
    message: entitySets.length
      ? `Connected. 1C publishes ${entitySets.length} OData entity sets.`
      : 'Connected, but no OData entity sets are published — enable them in 1C (Администрирование → Публикация OData).',
  };
}

export interface OneCPulledRecord {
  externalId: string;
  localId?: string;
  displayName?: string;
  [key: string]: unknown;
}

/**
 * Pull one entity set from 1C and normalize rows for the existing import
 * pipeline: Ref_Key becomes the idempotent externalId; a CellarFlowID
 * attribute (additional requisite maintained in 1C) links back to a local
 * record. Rows without it surface as review conflicts by design.
 */
export async function pullOneCEntitySet(
  connector: IntegrationConnectorConfig,
  entitySet: string,
  top = 50,
): Promise<OneCPulledRecord[]> {
  if (!ENTITY_SET_RE.test(entitySet)) {
    throw new Error('Entity set name contains unsupported characters.');
  }
  const boundedTop = Math.max(1, Math.min(500, Math.floor(top) || 50));
  const body = await fetchOneCJson(
    connector,
    `/${encodeURIComponent(entitySet)}?$format=json&$top=${boundedTop}`,
  );
  const rows = (body as any)?.value;
  if (!Array.isArray(rows)) {
    throw new Error('1C response has no rows — expected an OData collection.');
  }
  return rows.slice(0, boundedTop).map((row: any) => {
    const externalId = String(row?.Ref_Key || row?.Code || '').trim();
    const localId = String(row?.CellarFlowID || row?.cellarflowLocalId || '').trim() || undefined;
    return {
      ...row,
      externalId,
      localId,
      displayName: String(row?.Description || row?.Presentation || '').trim() || undefined,
    };
  });
}
