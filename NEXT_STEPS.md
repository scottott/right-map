# Next Step: Routing Engine That Can Prefer Right Turns

## Constraint: Only Engines That Support Turn Penalties

To get **genuinely different** standard vs right-turn-preferred routes, the routing engine must support **left-turn penalties** (or equivalent). Public APIs that only return “alternatives” are not enough.

| Option | Turn penalties? | Verdict |
|--------|----------------|---------|
| **Public OSRM** (router.project-osrm.org) | No custom profiles | Cannot prefer right turns |
| **GraphHopper Directions API (cloud)** | Not exposed in API (as of 2024–25) | Cannot use for this |
| **Self-hosted OSRM** with custom profile | Yes, via Lua `process_turn` / `turn_bias` | **Use this** |
| **Self-hosted GraphHopper** | Yes, in engine | Alternative; not in cloud API |

So the only practical path that matches the app’s objective is: **self-hosted OSRM with a custom car profile that penalizes left turns.**

---

## Next Step: Run OSRM With a Right-Turn Profile

1. **Use a custom profile**  
   The repo includes `osrm-profiles/car_right_turn.lua`. It is based on OSRM’s default car profile with a higher `turn_bias` so left turns get a larger penalty and the router prefers right turns.

2. **Host OSRM**  
   You need a server that can run OSRM (Docker is the usual way):
   - **VPS** (e.g. DigitalOcean, Hetzner, Fly.io): 4GB+ RAM recommended for a region like Texas or a US extract.
   - **Workflow**: download OSM data (e.g. Geofabrik), run `osrm-extract`, `osrm-partition`, `osrm-customize` with `car_right_turn.lua`, then run `osrm-routed`.  
   Or use a pre-built Docker image that supports custom profiles and run the same pipeline.

3. **Two routes from one engine**  
   - **Standard route**: Call your OSRM with the **default** car profile (or the same engine with default `turn_bias`).  
   - **Right-turn route**: Call the **same** OSRM with the **right-turn** profile (different `.osrm` data built from `car_right_turn.lua`).  
   So you either run two OSRM instances (same server, two ports/data dirs) or one instance with a way to select profile (if your setup supports it).

4. **Wire the app to your OSRM**  
   - **Option A**: Frontend calls your OSRM base URL for the right-turn route (and keeps using public OSRM for “standard” if you want zero backend).  
   - **Option B**: Small backend (e.g. Node on Render) that proxies “standard” and “right-turn” to the right OSRM endpoint(s). Frontend only talks to your backend; no CORS, one place to change URLs.

---

## Summary

- **Objective**: Only use routing engines that can perform the core function (prefer right turns via turn penalties).
- **Next step**: Run **self-hosted OSRM** with the provided **car_right_turn.lua** (or equivalent), host it on a VPS (or similar), then point the app at it for the right-turn route and at standard OSRM (or default profile) for the standard route.
- **After that**: Add a small backend proxy if you want (recommended), then update the PoC frontend to request “right-turn” from your OSRM and “standard” from public or your default OSRM.

The `osrm-profiles/` folder in this repo contains a **profile snippet** (the single change to make). Because the full OSRM car profile is large and depends on OSRM’s `lib/`, we don’t ship a full copy here; you add one line to your OSRM `car.lua` or a copy of it when building the right-turn data.
