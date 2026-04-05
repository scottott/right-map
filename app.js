/**
 * Right Turn Route PoC
 * Uses: Leaflet, OSM tiles, Nominatim (geocoding), OSRM (routing)
 * No API keys required.
 */

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'RightTurnRoutePoC/1.0 (contact@example.com)';

/**
 * Only Netlify needs the serverless proxy (AWS egress reaches OSRM; short client timeout).
 * Render’s datacenter often cannot reach public OSRM → 502; the browser can, with CORS.
 */
function useOsrmProxy() {
  const h = typeof window !== 'undefined' ? window.location.hostname : '';
  return h.endsWith('.netlify.app');
}

/** @param {string} path e.g. route/v1/driving/lon,lat;lon,lat (coords segment may be encodeURIComponent) */
function osrmProxyUrl(path, queryString) {
  const p = new URLSearchParams();
  p.set('path', path);
  if (queryString) p.set('q', queryString);
  return `/.netlify/functions/osrm-proxy?${p}`;
}

/** Same bases as server proxy / Netlify function (parallel mirrors). */
const OSRM_BROWSER_MIRRORS = [
  'https://router.project-osrm.org',
  'https://routing.openstreetmap.de/routed-car'
];

function osrmMirrorUrls(path, queryString) {
  const q = queryString ? `?${queryString}` : '';
  return OSRM_BROWSER_MIRRORS.map((base) => `${base}/${path}${q}`);
}

/** Avoid hanging forever on a stuck OSRM demo (Safari will wait a long time by default). */
function fetchWithTimeout(url, ms, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

/** Browser → public OSRM (Render/rightmap.app, localhost, preview URLs). */
const OSRM_DIRECT_CLIENT_MS = 32000;

/** Netlify: serverless proxy timeout. */
const OSRM_PROXY_CLIENT_MS = 90000;

function fetchOsrmProxy(path, queryString) {
  return fetchWithTimeout(osrmProxyUrl(path, queryString), OSRM_PROXY_CLIENT_MS);
}

/**
 * Race OSRM mirrors from the browser (same idea as the Netlify function). CORS allows this on the public demos.
 */
async function fetchOsrmDirectMirrors(path, queryString, ms) {
  const urls = osrmMirrorUrls(path, queryString);
  const settled = await Promise.allSettled(urls.map((u) => fetchWithTimeout(u, ms)));
  const ok = [];
  const other = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const r = s.value;
    if (r.ok) ok.push(r);
    else other.push(r);
  }
  if (ok.length) {
    ok.sort((a, b) => a.status - b.status);
    return ok[0];
  }
  if (other.length) {
    other.sort((a, b) => a.status - b.status);
    return other[0];
  }
  throw new Error('Routing service timed out or unavailable. Try again.');
}

/**
 * Netlify: same-origin function (dual mirror server-side). Elsewhere: browser → OSRM mirrors (Render cannot rely on server-side OSRM).
 */
async function fetchOsrm(path, queryString) {
  if (useOsrmProxy()) {
    return fetchOsrmProxy(path, queryString);
  }
  return fetchOsrmDirectMirrors(path, queryString, OSRM_DIRECT_CLIENT_MS);
}

/** Distance in meters to place the "right-turn" via point past the intersection */
const VIA_OFFSET_M = 80;
/** Max ratio: right-turn route distance / standard route distance (reject huge detours) */
const MAX_DETOUR_RATIO = 1.6;
/** Max number of via points (fix up to this many left turns, one at a time) */
const MAX_VIA_ITERATIONS = 3;

/** Zoom level when following location (street-level, similar to navigation apps). */
const NAVIGATION_ZOOM = 17;

let map;
let standardLayer = null;
let rightturnLayer = null;

/** Current route used for snap-to-route and step index (set when showing Standard/Right-Turn/Both). */
let currentRouteForLocation = null;
/** Leaflet marker for user's (snapped) position when following. */
let locationMarker = null;
/** navigator.geolocation.watchPosition id, so we can clear it. */
let locationWatchId = null;

function setStatus(msg, isError = false) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : msg ? ' loading' : '');
}

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([32.7767, -96.7970], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  if (map.getContainer().offsetWidth <= 600) {
    map.zoomControl.setPosition('bottomright');
  }
}

/** Call after the map container gets real size (e.g. when results panel is shown or when switching to Map view). */
function refreshMapSize() {
  if (!map) return;
  requestAnimationFrame(() => {
    map.invalidateSize();
  });
}

/** Fit the map so the initial view includes the user's location (once). Call after showing results. */
function fitMapToIncludeUser() {
  if (!map || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const bounds = map.getBounds().clone();
      bounds.extend([lat, lon]);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    },
    () => { /* ignore: keep current route-only view */ },
    { enableHighAccuracy: false, maximumAge: 60000, timeout: 10000 }
  );
}

// --- Snap to route (for location-aware list and map marker) ---

/** Closest point on segment [a, b] to point p. a, b, p are [lon, lat]. Returns { point: [lon, lat], t: 0..1 }. */
function closestPointOnSegment(a, b, p) {
  const ax = a[0], ay = a[1], bx = b[0], by = b[1], px = p[0], py = p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { point: [ax, ay], t: 0 };
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { point: [ax + t * dx, ay + t * dy], t };
}

/** Haversine distance in meters between two [lon, lat] points. */
function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180, lat2 = b[1] * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Snap (lat, lon) to the route polyline. coords = array of [lon, lat]. Returns { lat, lon, distanceAlong } or null if coords empty. */
function snapToRoute(lat, lon, coords) {
  if (!coords || coords.length < 2) return null;
  const p = [lon, lat];
  let best = null;
  let bestDist = Infinity;
  let distanceAlong = 0;
  let segStartAlong = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    const segLen = haversineMeters(a, b);
    const { point } = closestPointOnSegment(a, b, p);
    const d = haversineMeters(p, point);
    const t = segLen > 0 ? haversineMeters(a, point) / segLen : 0;
    const along = segStartAlong + t * segLen;
    if (d < bestDist) {
      bestDist = d;
      best = { lat: point[1], lon: point[0], distanceAlong: along };
    }
    segStartAlong += segLen;
  }
  return best;
}

/** Map distance-along (meters) to step index. route has legs[].steps[].distance. */
function distanceAlongToStepIndex(route, distanceAlong) {
  if (!route.legs || !route.legs.length) return 0;
  let sum = 0;
  let stepIndex = 0;
  for (const leg of route.legs) {
    if (!leg.steps) continue;
    for (const step of leg.steps) {
      const stepEnd = sum + (step.distance != null ? step.distance : 0);
      if (distanceAlong <= stepEnd) return stepIndex;
      sum = stepEnd;
      stepIndex++;
    }
  }
  return Math.max(0, stepIndex - 1);
}

/** Update list and map from a snapped position (step index). */
function updateLocationFromSnap(snapped, stepIndex) {
  setActiveStep(stepIndex);
  if (locationMarker && snapped) {
    locationMarker.setLatLng([snapped.lat, snapped.lon]);
  }
  if (map && snapped && locationWatchId != null) {
    map.panTo([snapped.lat, snapped.lon]);
  }
}

function startFollowingLocation() {
  if (!currentRouteForLocation) {
    setStatus('Get a route first, then tap Follow my location.', true);
    return;
  }
  if (!navigator.geolocation) {
    setStatus('Geolocation is not supported by this browser.', true);
    return;
  }

  const btn = document.getElementById('follow-location-btn');
  if (locationWatchId != null) {
    stopFollowingLocation();
    return;
  }

  const coords = currentRouteForLocation.coords;
  const start = coords && coords.length ? [coords[0][1], coords[0][0]] : [0, 0];

  if (!locationMarker && map) {
    locationMarker = L.circleMarker(start, {
      radius: 10,
      fillColor: '#3fb950',
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9
    });
    locationMarker.addTo(map);
  } else if (locationMarker) {
    locationMarker.setLatLng(start);
  }
  if (locationMarker && !map.hasLayer(locationMarker)) {
    locationMarker.addTo(map);
  }

  map.setView(start, NAVIGATION_ZOOM);

  locationWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const snapped = snapToRoute(lat, lon, currentRouteForLocation.coords);
      if (!snapped) return;
      const stepIndex = distanceAlongToStepIndex(currentRouteForLocation.route, snapped.distanceAlong);
      updateLocationFromSnap(snapped, stepIndex);
      setStatus('');
    },
    (err) => {
      if (err.code === 1) setStatus('Location permission denied.', true);
      else if (err.code === 3) setStatus('Location unavailable.', true);
      else setStatus('Location error.', true);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );

  btn.setAttribute('aria-pressed', 'true');
  btn.textContent = 'Stop following';
  setStatus('Following your location…');
}

function stopFollowingLocation() {
  if (locationWatchId != null) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
  if (locationMarker && map) {
    map.removeLayer(locationMarker);
    locationMarker = null;
  }
  const btn = document.getElementById('follow-location-btn');
  if (btn) {
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = 'Follow my location';
  }
  setStatus('');
}

async function geocode(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: 1
  });
  const res = await fetch(`${NOMINATIM_BASE}?${params}`);
  if (!res.ok) throw new Error('Geocoding failed');
  const data = await res.json();
  if (!data || data.length === 0) throw new Error(`No results for "${query}"`);
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchRoute(coordPairs) {
  const coords = coordPairs.map(c => `${c.lon},${c.lat}`).join(';');
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: 'true',
    alternatives: 'true'
  });
  const path = `route/v1/driving/${encodeURIComponent(coords)}`;
  const res = await fetchOsrm(path, params.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Routing failed');
  }
  return res.json();
}

/** Fetch a single route with given waypoints (no alternatives). */
async function fetchRouteWithWaypoints(coordPairs) {
  const coords = coordPairs.map(c => `${c.lon},${c.lat}`).join(';');
  const params = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: 'true',
    alternatives: 'false'
  });
  const path = `route/v1/driving/${encodeURIComponent(coords)}`;
  const res = await fetchOsrm(path, params.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Routing failed');
  }
  const data = await res.json();
  if (!data.routes || data.routes.length === 0) return null;
  return data.routes[0];
}

/** Snap (lon, lat) to the nearest road; returns { lat, lon } or null. */
async function snapToRoad(lon, lat) {
  const path = `nearest/v1/driving/${lon},${lat}`;
  const res = await fetchOsrm(path, 'number=1');
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.waypoints || data.waypoints.length === 0) return null;
  const [lonSnap, latSnap] = data.waypoints[0].location;
  return { lat: latSnap, lon: lonSnap };
}

/** Return a point VIA_OFFSET_M meters from (lat, lon) in direction bearingDeg (0=north, 90=east). */
function pointInDirection(lat, lon, bearingDeg, distM = VIA_OFFSET_M) {
  const R = 6371000; // earth radius m
  const br = (bearingDeg * Math.PI) / 180;
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(latR) * Math.cos(distM / R) +
    Math.cos(latR) * Math.sin(distM / R) * Math.cos(br)
  );
  const lon2 = lonR + Math.atan2(
    Math.sin(br) * Math.sin(distM / R) * Math.cos(latR),
    Math.cos(distM / R) - Math.sin(latR) * Math.sin(lat2)
  );
  return {
    lat: (lat2 * 180) / Math.PI,
    lon: (lon2 * 180) / Math.PI
  };
}

/**
 * Find the first left turn in the route.
 * Returns { lat, lon, bearingBefore } (intersection and approach bearing) or null.
 * OSRM: bearing_before 0–360, modifier 'left'|'slight left'|'sharp left'.
 */
function findFirstLeftTurn(route) {
  if (!route.legs) return null;
  for (const leg of route.legs) {
    if (!leg.steps) continue;
    for (const step of leg.steps) {
      const m = step.maneuver;
      if (!m || m.type === 'depart' || m.type === 'arrive') continue;
      const mod = (m.modifier || '').toLowerCase();
      if (!mod.includes('left')) continue;
      const [lon, lat] = m.location;
      const bearingBefore = m.bearing_before != null ? m.bearing_before : 0;
      return { lat, lon, bearingBefore };
    }
  }
  return null;
}

function countTurns(route) {
  let left = 0, right = 0;
  if (!route.legs) return { left, right, total: 0 };

  for (const leg of route.legs) {
    if (!leg.steps) continue;
    for (const step of leg.steps) {
      const m = step.maneuver;
      if (!m || m.type === 'depart' || m.type === 'arrive') continue;

      const mod = (m.modifier || '').toLowerCase();
      if (mod.includes('left')) left++;
      else if (mod.includes('right')) right++;
    }
  }
  return { left, right, total: left + right };
}

function formatDistance(meters) {
  const mi = meters / 1609.34;
  return mi < 0.1 ? `${Math.round(meters)} m` : `${mi.toFixed(1)} mi`;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m} min`;
}

function safetyGrade(improvementPct) {
  if (improvementPct == null || isNaN(improvementPct) || improvementPct < 0) return { grade: 'na', label: '—' };
  if (improvementPct >= 50) return { grade: 'a', label: 'A' };
  if (improvementPct >= 25) return { grade: 'b', label: 'B' };
  if (improvementPct >= 10) return { grade: 'c', label: 'C' };
  if (improvementPct > 0) return { grade: 'd', label: 'D' };
  return { grade: 'f', label: 'F' };
}

function routeGrade(rightTurnPct) {
  if (rightTurnPct == null || isNaN(rightTurnPct)) return { grade: 'na', label: '—' };
  if (rightTurnPct >= 90) return { grade: 'a', label: 'A' };
  if (rightTurnPct >= 75) return { grade: 'b', label: 'B' };
  if (rightTurnPct >= 50) return { grade: 'c', label: 'C' };
  if (rightTurnPct >= 25) return { grade: 'd', label: 'D' };
  return { grade: 'f', label: 'F' };
}

function getRightTurnPct(turns) {
  if (!turns.total) return 100;
  return Math.round((turns.right / turns.total) * 100);
}

/** Build human-readable step instructions from an OSRM route. */
function getStepInstructions(route) {
  if (!route.legs) return [];
  const steps = [];
  for (const leg of route.legs) {
    if (!leg.steps) continue;
    for (const step of leg.steps) {
      const m = step.maneuver;
      const name = (step.name && step.name.trim()) || '';
      const dist = step.distance != null ? formatDistance(step.distance) : '';
      const type = (m && m.type) || '';
      const mod = (m && m.modifier && m.modifier.toLowerCase()) || '';

      let text = '';
      if (type === 'depart') {
        text = name ? `Head out on ${name}` : 'Head out';
      } else if (type === 'arrive') {
        text = 'Arrive at destination';
      } else if (type === 'turn' || type.includes('turn')) {
        if (mod.includes('left')) text = name ? `Turn left onto ${name}` : 'Turn left';
        else if (mod.includes('right')) text = name ? `Turn right onto ${name}` : 'Turn right';
        else if (mod.includes('straight')) text = name ? `Continue straight on ${name}` : 'Continue straight';
        else text = name ? `Turn onto ${name}` : 'Turn';
      } else {
        text = name ? `Continue on ${name}` : 'Continue';
      }
      if (dist && type !== 'arrive') text += ` — ${dist}`;
      steps.push({ text, distance: step.distance });
    }
  }
  return steps;
}

/** Current step index for highlighting (used by geolocation). Set via setActiveStep(). */
let activeStepIndex = null;

function renderDirectionsList(route) {
  const listEl = document.getElementById('directions-list');
  if (!listEl) return;
  const steps = getStepInstructions(route);
  listEl.innerHTML = steps.map((s, i) => {
    const id = `direction-step-${i}`;
    const active = i === activeStepIndex ? ' active' : '';
    return `<li data-step-index="${i}" id="${id}" class="${active}">${s.text}</li>`;
  }).join('');
}

/** Set the current/next step (e.g. from geolocation). Highlights that item and scrolls it into view. */
function setActiveStep(index) {
  const listEl = document.getElementById('directions-list');
  if (!listEl) return;
  activeStepIndex = index;
  listEl.querySelectorAll('li').forEach((li, i) => {
    li.classList.toggle('active', i === index);
  });
  scrollActiveStepIntoView();
}

/** Scroll the active step into view (for driver list view). Call after setActiveStep or when list view opens. */
function scrollActiveStepIntoView() {
  const active = document.querySelector('.directions-list li.active');
  if (active) {
    active.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

document.getElementById('route-btn').addEventListener('click', async () => {
  const origin = document.getElementById('origin').value.trim();
  const destination = document.getElementById('destination').value.trim();

  if (!origin || !destination) {
    setStatus('Please enter both origin and destination.', true);
    return;
  }

  const btn = document.getElementById('route-btn');
  btn.disabled = true;
  setStatus('Finding addresses…');

  try {
    setStatus('Geocoding…');
    const from = await geocode(origin);
    await delay(1100);
    const to = await geocode(destination);

    setStatus('Fetching standard route…');
    const data = await fetchRoute([from, to]);

    if (!data.routes || data.routes.length === 0) {
      throw new Error('No routes found');
    }

    const standard = data.routes[0];
    let rightturn = standard;
    const vias = [];
    let firstLeft = null;

    // Explore right-turn options one left turn at a time (up to MAX_VIA_ITERATIONS)
    for (let i = 0; i < MAX_VIA_ITERATIONS; i++) {
      firstLeft = findFirstLeftTurn(rightturn);
      if (!firstLeft) break;

      setStatus(`Exploring right-turn at left turn ${i + 1} of ${MAX_VIA_ITERATIONS}…`);
      const rightBearing = (firstLeft.bearingBefore + 90) % 360;
      const rightPoint = pointInDirection(firstLeft.lat, firstLeft.lon, rightBearing);
      const viaSnap = await snapToRoad(rightPoint.lon, rightPoint.lat);
      if (!viaSnap) break;

      const waypoints = [from, ...vias, viaSnap, to];
      const nextRoute = await fetchRouteWithWaypoints(waypoints);
      if (!nextRoute || nextRoute.distance > standard.distance * MAX_DETOUR_RATIO) break;

      const nextTurns = countTurns(nextRoute);
      const currentTurns = countTurns(rightturn);
      if (nextTurns.left >= currentTurns.left) break;

      rightturn = nextRoute;
      vias.push(viaSnap);
    }

    let onlyOneRoute = vias.length === 0;
    if (onlyOneRoute && data.routes.length > 1) {
      const stdTurnsCheck = countTurns(standard);
      for (let i = 1; i < data.routes.length; i++) {
        const turns = countTurns(data.routes[i]);
        if (turns.left < stdTurnsCheck.left) {
          rightturn = data.routes[i];
          onlyOneRoute = false;
          break;
        }
      }
    }

    let stdTurns = countTurns(standard);
    let rtTurns = countTurns(rightturn);
    if (rtTurns.left >= stdTurns.left) {
      rightturn = standard;
      onlyOneRoute = true;
      rtTurns = stdTurns;
    }

    const stdRightPct = getRightTurnPct(stdTurns);
    const rtRightPct = getRightTurnPct(rtTurns);
    const improvementPct = stdTurns.left > 0
      ? Math.round(((stdTurns.left - rtTurns.left) / stdTurns.left) * 100)
      : 0;

    const stdGeo = standard.geometry?.coordinates || [];
    const rtGeo = rightturn.geometry?.coordinates || [];

    if (standardLayer) map.removeLayer(standardLayer);
    if (rightturnLayer) map.removeLayer(rightturnLayer);

    standardLayer = L.geoJSON({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: stdGeo }
    }, {
      style: { color: '#8b949e', weight: 4, opacity: 0.8 }
    });

    rightturnLayer = L.geoJSON({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: rtGeo }
    }, {
      style: { color: '#58a6ff', weight: 5, opacity: 0.95 }
    });

    const routesDiffer = stdGeo.length !== rtGeo.length || stdGeo.some((c, i) => rtGeo[i] && (c[0] !== rtGeo[i][0] || c[1] !== rtGeo[i][1]));
    const bothBtn = document.getElementById('toggle-both');

    const setActiveToggle = (activeId) => {
      ['toggle-both', 'toggle-standard', 'toggle-rightturn'].forEach(id => {
        document.getElementById(id).classList.toggle('active', id === activeId);
      });
    };

    const showBoth = () => {
      map.addLayer(standardLayer);
      map.addLayer(rightturnLayer);
      const allCoords = [...stdGeo, ...rtGeo];
      if (allCoords.length > 0) {
        map.fitBounds(L.latLngBounds(allCoords.map(c => [c[1], c[0]])), { padding: [40, 40], maxZoom: 14 });
      }
      setActiveToggle('toggle-both');
      currentRouteForLocation = { route: standard, coords: stdGeo };
      renderDirectionsList(standard);
    };

    const showStandard = () => {
      map.removeLayer(rightturnLayer);
      map.addLayer(standardLayer);
      if (stdGeo.length > 0) {
        map.fitBounds(L.latLngBounds(stdGeo.map(c => [c[1], c[0]])), { padding: [40, 40], maxZoom: 14 });
      }
      setActiveToggle('toggle-standard');
      currentRouteForLocation = { route: standard, coords: stdGeo };
      renderDirectionsList(standard);
    };

    const showRightturn = () => {
      map.removeLayer(standardLayer);
      map.addLayer(rightturnLayer);
      if (rtGeo.length > 0) {
        map.fitBounds(L.latLngBounds(rtGeo.map(c => [c[1], c[0]])), { padding: [40, 40], maxZoom: 14 });
      }
      setActiveToggle('toggle-rightturn');
      currentRouteForLocation = { route: rightturn, coords: rtGeo };
      renderDirectionsList(rightturn);
    };

    bothBtn.onclick = showBoth;
    document.getElementById('toggle-standard').onclick = showStandard;
    document.getElementById('toggle-rightturn').onclick = showRightturn;

    if (onlyOneRoute) {
      bothBtn.style.display = 'none';
      showStandard();
    } else {
      bothBtn.style.display = '';
      showBoth();
    }
    document.getElementById('directions-panel').style.display = 'block';

    document.getElementById('results-panel').setAttribute('aria-hidden', 'false');
    document.getElementById('results-panel').style.display = 'block';
    document.getElementById('app-root').classList.add('has-results');

    refreshMapSize();
    fitMapToIncludeUser();

    document.getElementById('standard-distance').textContent = formatDistance(standard.distance);
    document.getElementById('standard-duration').textContent = formatDuration(standard.duration);
    document.getElementById('standard-turns').textContent =
      `${stdTurns.left} left, ${stdTurns.right} right`;

    document.getElementById('rightturn-distance').textContent = formatDistance(rightturn.distance);
    document.getElementById('rightturn-duration').textContent = formatDuration(rightturn.duration);
    document.getElementById('rightturn-turns').textContent =
      onlyOneRoute ? 'Same as standard' : `${rtTurns.left} left, ${rtTurns.right} right`;

    const stdGrade = routeGrade(stdTurns.total ? stdRightPct : null);
    const rtGrade = routeGrade(rtTurns.total ? rtRightPct : null);
    const impGrade = safetyGrade(improvementPct);

    document.getElementById('standard-badge').textContent = stdGrade.label;
    document.getElementById('standard-badge').className = 'safety-badge ' + stdGrade.grade;

    document.getElementById('rightturn-badge').textContent = rtGrade.label;
    document.getElementById('rightturn-badge').className = 'safety-badge ' + rtGrade.grade;

    const ratingEl = document.getElementById('rating-value');
    if (onlyOneRoute) {
      ratingEl.textContent = stdTurns.left > 0
        ? "Can't reduce the number of left turns for this trip."
        : (stdTurns.total === 0 ? 'No turns on this route.' : 'No left turns on the standard route.');
      ratingEl.className = 'rating-value rating-note';
    } else {
      ratingEl.innerHTML = `<span class="grade-badge ${impGrade.grade}">${impGrade.label}</span> ${improvementPct}% fewer left turns`;
      ratingEl.className = 'rating-value';
    }

    setStatus('');
  } catch (err) {
    const aborted =
      err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')));
    setStatus(
      aborted
        ? 'Routing timed out. If the site was idle, wait a minute and try again — or retry now.'
        : err.message || 'Something went wrong.',
      true
    );
  } finally {
    btn.disabled = false;
  }
});

function initViewToggle() {
  const app = document.getElementById('app-root');
  const btnMap = document.getElementById('view-map');
  const btnList = document.getElementById('view-list');
  if (!app || !btnMap || !btnList) return;

  btnMap.addEventListener('click', () => {
    app.classList.remove('view-list');
    app.classList.add('view-map');
    btnMap.classList.add('active');
    btnList.classList.remove('active');
    refreshMapSize();
  });

  btnList.addEventListener('click', () => {
    app.classList.remove('view-map');
    app.classList.add('view-list');
    btnList.classList.add('active');
    btnMap.classList.remove('active');
    scrollActiveStepIntoView();
  });
}

function initFollowLocation() {
  const btn = document.getElementById('follow-location-btn');
  if (!btn) return;
  btn.addEventListener('click', startFollowingLocation);
}

const THEME_STORAGE_KEY = 'rightmap-theme';

function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY) || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.textContent = saved === 'light' ? 'Dark' : 'Light';
  btn.setAttribute('aria-label', saved === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  btn.title = btn.getAttribute('aria-label');
  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    btn.textContent = next === 'light' ? 'Dark' : 'Light';
    btn.setAttribute('aria-label', next === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    btn.title = btn.getAttribute('aria-label');
  });
}

initTheme();
initMap();
initViewToggle();
initFollowLocation();

window.addEventListener('resize', () => {
  refreshMapSize();
});
