/**
 * Right Turn Route PoC
 * Uses: Leaflet, OSM tiles, Nominatim (geocoding), OSRM (routing)
 * No API keys required.
 */

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const OSRM_NEAREST = 'https://router.project-osrm.org/nearest/v1/driving';
const USER_AGENT = 'RightTurnRoutePoC/1.0 (contact@example.com)';

/** Distance in meters to place the "right-turn" via point past the intersection */
const VIA_OFFSET_M = 80;
/** Max ratio: right-turn route distance / standard route distance (reject huge detours) */
const MAX_DETOUR_RATIO = 1.6;
/** Max number of via points (fix up to this many left turns, one at a time) */
const MAX_VIA_ITERATIONS = 3;

let map;
let standardLayer = null;
let rightturnLayer = null;

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

async function geocode(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: 1
  });
  const res = await fetch(`${NOMINATIM_BASE}?${params}`, {
    headers: { 'User-Agent': USER_AGENT }
  });
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
  const res = await fetch(`${OSRM_BASE}/${encodeURIComponent(coords)}?${params}`);
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
  const res = await fetch(`${OSRM_BASE}/${encodeURIComponent(coords)}?${params}`);
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
  const res = await fetch(`${OSRM_NEAREST}/${lon},${lat}?number=1`);
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
    };

    const showStandard = () => {
      map.removeLayer(rightturnLayer);
      map.addLayer(standardLayer);
      if (stdGeo.length > 0) {
        map.fitBounds(L.latLngBounds(stdGeo.map(c => [c[1], c[0]])), { padding: [40, 40], maxZoom: 14 });
      }
      setActiveToggle('toggle-standard');
    };

    const showRightturn = () => {
      map.removeLayer(standardLayer);
      map.addLayer(rightturnLayer);
      if (rtGeo.length > 0) {
        map.fitBounds(L.latLngBounds(rtGeo.map(c => [c[1], c[0]])), { padding: [40, 40], maxZoom: 14 });
      }
      setActiveToggle('toggle-rightturn');
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

    document.getElementById('results-panel').setAttribute('aria-hidden', 'false');
    document.getElementById('results-panel').style.display = 'block';

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
    setStatus(err.message || 'Something went wrong.', true);
  } finally {
    btn.disabled = false;
  }
});

initMap();
