# Profile change for right-turn-preferred routing

Use this when building OSRM data for the **right-turn** route. No separate profile file is required.

## Change in `car.lua`

In the **`setup()`** return table, change the `turn_bias` value:

```lua
-- Default (standard car profile):
turn_bias = 1.075,

-- Right-turn-preferred profile (use this when building the right-turn dataset):
turn_bias = 2.0,
```

So in your OSRM `profiles/car.lua` (or a copy named e.g. `car_right_turn.lua`), set:

```lua
turn_bias = 2.0,
```

## Effect

- **1.075** (default): Slight preference for right turns.
- **2.0**: Stronger penalty on left turns; router will prefer routes with more right turns.
- **2.5–3.0**: Even stronger preference if needed.

## Build steps

1. Copy OSRM’s `profiles/` (including `lib/`) and either:
   - keep one `car.lua` for standard (turn_bias = 1.075) and one copy as `car_right_turn.lua` with turn_bias = 2.0, or  
   - build standard from upstream OSRM and build right-turn from a clone where `car.lua` has turn_bias = 2.0.
2. Download OSM data (e.g. from Geofabrik: Texas or North America).
3. Run extract/partition/customize/routed **twice** (once per profile) if you want both standard and right-turn from your own server.
4. Point the app’s “right-turn” requests at the OSRM instance built with `turn_bias = 2.0`.

See **NEXT_STEPS.md** in the repo root for hosting and app wiring.
