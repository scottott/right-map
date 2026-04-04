/**
 * Same-origin proxy for OSRM. Must finish within Netlify's default ~10s function limit
 * (long upstream timeouts cause Netlify to return 502 before we respond).
 * Hits both public mirrors in parallel and returns the best successful response.
 */

const https = require('https');
const { URL } = require('url');

const MIRRORS = [
  'https://router.project-osrm.org',
  'https://routing.openstreetmap.de/routed-car'
];

/** Stay under Netlify's ~10s sync limit including cold start + JSON parse. */
const UPSTREAM_MS = 6500;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

function allowedPath(p) {
  if (!p || typeof p !== 'string' || p.length > 4096) return false;
  if (p.includes('..')) return false;
  if (!p.startsWith('route/v1/driving/') && !p.startsWith('nearest/v1/driving/')) return false;
  return true;
}

function httpsGet(urlString, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'RightMap/1.0 (https://rightmap.app; OSRM proxy)',
          Accept: 'application/json'
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 502,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Upstream timeout'));
    });
    req.end();
  });
}

function lambdaJson(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
    body
  };
}

function pickBestResponse(settled) {
  const ok = [];
  const other = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const r = s.value;
    if (r.statusCode >= 200 && r.statusCode < 300) ok.push(r);
    else other.push(r);
  }
  if (ok.length) {
    ok.sort((a, b) => a.statusCode - b.statusCode);
    return ok[0];
  }
  if (other.length) {
    other.sort((a, b) => (a.statusCode || 999) - (b.statusCode || 999));
    return other[0];
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return lambdaJson(405, JSON.stringify({ error: 'Method not allowed' }));
  }

  const path = event.queryStringParameters?.path;
  const q = event.queryStringParameters?.q || '';

  if (!allowedPath(path)) {
    console.warn('osrm-proxy bad path', path && path.slice(0, 120));
    return lambdaJson(400, JSON.stringify({ error: 'Invalid path' }));
  }

  const query = q ? (q.startsWith('?') ? q.slice(1) : q) : '';
  const qs = query ? `?${query}` : '';
  const urls = MIRRORS.map((base) => `${base}/${path}${qs}`);

  const settled = await Promise.allSettled(urls.map((u) => httpsGet(u, UPSTREAM_MS)));
  const rejected = settled.filter((s) => s.status === 'rejected');
  if (rejected.length) {
    console.warn(
      'osrm-proxy upstream errors',
      rejected.map((s) => s.reason && s.reason.message).join('; ')
    );
  }

  const best = pickBestResponse(settled);
  if (!best) {
    return lambdaJson(
      502,
      JSON.stringify({
        message: 'Routing service timed out or unavailable. Try again.',
        detail: 'Both OSRM mirrors failed within deadline'
      })
    );
  }

  const ct = (best.headers['content-type'] || 'application/json').split(';')[0];
  return {
    statusCode: best.statusCode,
    headers: {
      ...CORS,
      'Content-Type': ct.includes('json') ? 'application/json; charset=utf-8' : ct
    },
    body: best.body
  };
};
