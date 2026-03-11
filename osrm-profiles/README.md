# OSRM profile for right-turn-preferred routing

Use this when building OSRM data so that the router **penalizes left turns** and prefers routes with more right turns.

## What to change

There is no separate profile file in this repo. You change **one value** in OSRM's car profile (or a copy of it).

See **`car_right_turn.patch.md`** for the exact change: in `setup()`, set **`turn_bias = 2.0`** (default is `1.075`).

## How to use

1. Clone [Project-OSRM/osrm-backend](https://github.com/Project-OSRM/osrm-backend) and use its `profiles/` (including `lib/`).
2. For the **right-turn** dataset: copy `profiles/car.lua` to e.g. `profiles/car_right_turn.lua` and in that file set `turn_bias = 2.0`.
3. Build the graph with the right-turn profile:

   ```bash
   osrm-extract --profile profiles/car_right_turn.lua north-america-latest.osm.pbf --output /data/car_right_turn
   osrm-partition /data/car_right_turn/car_right_turn.osrm
   osrm-customize /data/car_right_turn/car_right_turn.osrm
   osrm-routed --algorithm mld /data/car_right_turn/car_right_turn.osrm
   ```

4. Run a second OSRM instance with the default `car.lua` if you want "standard" routes from your own server.

See **NEXT_STEPS.md** in the repo root for hosting and wiring the app.
