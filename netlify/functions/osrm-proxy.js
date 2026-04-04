/**
 * Same-origin proxy for OSRM (avoids browser CORS when the demo returns 4xx/504 without CORS headers).
 * Tries a primary host, then a public mirror.
 */

const MIRRORS = [
  'https://router.project-osrm.org',
  'https://routing.openstreetmap.de/routed-car'
];

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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const path = event.queryStringParameters?.path;
  const q = event.queryStringParameters?.q || '';

  if (!allowedPath(path)) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid path' })
    };
  }

  const query = q ? (q.startsWith('?') ? q.slice(1) : q) : '';
  let lastErr = null;

  for (let i = 0; i < MIRRORS.length; i++) {
    const base = MIRRORS[i];
    const url = `${base}/${path}${query ? `?${query}` : ''}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'RightMap/1.0 (https://rightmap.app; OSRM proxy)' },
        signal: ctrl.signal
      });
      clearTimeout(timer);
      const text = await res.text();
      const tryNext = (res.status >= 500 || res.status === 429) && i < MIRRORS.length - 1;
      if (tryNext) {
        lastErr = new Error(`HTTP ${res.status} from ${base}`);
        continue;
      }
      const ct = res.headers.get('content-type') || 'application/json';
      return {
        statusCode: res.status,
        headers: {
          ...CORS,
          'Content-Type': ct.includes('json') ? 'application/json; charset=utf-8' : ct
        },
        body: text
      };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
    }
  }

  return {
    statusCode: 502,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Routing service unavailable. Try again in a moment.',
      detail: lastErr && lastErr.message ? lastErr.message : 'upstream failed'
    })
  };
};
