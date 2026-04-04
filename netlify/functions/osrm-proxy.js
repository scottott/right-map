/**
 * Same-origin proxy for OSRM (avoids browser CORS when the demo returns errors without CORS headers).
 * Uses Node https (no fetch) for compatibility with all Netlify Lambda Node runtimes.
 */

const https = require('https');
const { URL } = require('url');

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

function httpsGet(urlString) {
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
        timeout: 28000
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
    console.warn('osrm-proxy bad path', path && path.slice(0, 120));
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
    try {
      const res = await httpsGet(url);
      const tryNext =
        (res.statusCode >= 500 || res.statusCode === 429) && i < MIRRORS.length - 1;
      if (tryNext) {
        lastErr = new Error(`HTTP ${res.statusCode} from ${base}`);
        console.warn(lastErr.message);
        continue;
      }
      const ct = (res.headers['content-type'] || 'application/json').split(';')[0];
      return {
        statusCode: res.statusCode,
        headers: {
          ...CORS,
          'Content-Type': ct.includes('json') ? 'application/json; charset=utf-8' : ct
        },
        body: res.body
      };
    } catch (e) {
      lastErr = e;
      console.warn('osrm-proxy mirror error', base, e.message);
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
