/**
 * RightMap on Render: static files + OSRM proxy (replaces Netlify function).
 */

const express = require('express');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const MIRRORS = [
  'https://router.project-osrm.org',
  'https://routing.openstreetmap.de/routed-car'
];

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

const app = express();
const port = process.env.PORT || 3000;
const root = __dirname;

app.options('/api/osrm-proxy', (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  res.sendStatus(204);
});

app.get('/api/osrm-proxy', async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  const p = req.query.path;
  const q = req.query.q || '';

  if (!allowedPath(p)) {
    console.warn('osrm-proxy bad path', p && String(p).slice(0, 120));
    return res.status(400).json({ error: 'Invalid path' });
  }

  const query = q ? (String(q).startsWith('?') ? String(q).slice(1) : q) : '';
  const qs = query ? `?${query}` : '';
  const urls = MIRRORS.map((base) => `${base}/${p}${qs}`);

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
    return res.status(502).json({
      message: 'Routing service timed out or unavailable. Try again.',
      detail: 'Both OSRM mirrors failed within deadline'
    });
  }

  const ct = (best.headers['content-type'] || 'application/json').split(';')[0];
  res.status(best.statusCode);
  res.setHeader(
    'Content-Type',
    ct.includes('json') ? 'application/json; charset=utf-8' : ct
  );
  res.send(best.body);
});

app.use(express.static(root));

app.listen(port, () => {
  console.log(`RightMap listening on ${port}`);
});
