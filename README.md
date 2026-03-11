# Right Turn Route – PoC

A proof-of-concept web app that compares standard routes with right-turn-preferred alternatives and shows a safety rating based on left-turn avoidance.

## Run locally

```bash
cd right-turn-poc
npx serve .
```

Or with Python:

```bash
cd right-turn-poc
python3 -m http.server 3456
```

Then open http://localhost:3456 (or 3000 for npx serve).

## Deploy to Render

1. Push this folder to a GitHub repo (or add to an existing repo).
2. In Render: New → Static Site.
3. Connect the repo, set **Root Directory** to `right-turn-poc` (if it's a subfolder).
4. Build command: leave empty. Publish directory: `.`

## Stack

- **Map**: Leaflet + OpenStreetMap tiles
- **Geocoding**: Nominatim (OSM)
- **Routing**: OSRM public demo

No API keys or signups required.

## How the right-turn option is computed (no self-hosting)

1. Get the **standard route** from origin to destination (public OSRM).
2. Find the **first left turn** in that route (intersection location and approach bearing).
3. Compute a point **80 m** in the “right” direction from that intersection (approach bearing + 90°).
4. **Snap** that point to the nearest road (OSRM nearest service).
5. Request a new route **origin → snapped via point → destination**.
6. If that route exists and isn’t a huge detour (≤ 1.6× standard distance) and has **fewer left turns** (or more right turns), keep it and repeat from step 2 on this new route (find its first left, add another via, route through all vias). Stop after **3** via points (`MAX_VIA_ITERATIONS` in `app.js`) or when no improvement is found.

So the app explores right-turn options **one left turn at a time**, up to 3 fixes, using only public OSRM. No self-hosted engine is required.

**Suggested test:** Open the app and click **Get Routes** with the pre-filled addresses (Little Elm, TX → Dallas, TX). You should see status messages like “Exploring right-turn at left turn 1 of 3…” and, when it works, a Right-Turn Preferred route with fewer left turns than the standard route.
