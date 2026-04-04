# RightMap – Development Roadmap

This document outlines the product roadmap and target markets so we can stay on track and prioritize. RightMap’s core benefit: **safer, less stressful driving via right-turn preference** plus **location-aware turn-by-turn** and (planned) **multi-destination routes**.

---

## Current state (as of roadmap date)

- **Single A→B route**: Standard vs Right-Turn Preferred comparison, safety grade, turn count.
- **Turn-by-turn list**: Driver-sized type; Map / Directions view toggle; list below map (map first, no scroll).
- **Follow my location**: Snap position to route; green dot on map; list highlights current step and auto-scrolls; map pans with you at navigation zoom (17).
- **Initial view**: Map fits route and expands to include user’s location when results load (one-time geolocation).
- **Deployment**: rightmap.app (Netlify), no API keys.

---

## In-the-car UX improvements (priority order)

Real-world feedback: tackle one step at a time, in this order.

| Step | Issue | Fix |
|------|--------|-----|
| **1** | White on black is hard to see in Texas sun | Improve daylight readability: light theme or higher-contrast palette (lighter surfaces, darker text). Optional theme toggle. |
| **2** | Follow button too close to other buttons; needs space; shouldn’t be so prominent | Add spacing (margin/padding) around Follow my location; style as secondary (e.g. outline, smaller) so it’s tappable but not dominant. |
| **3** | In list view, scrolling up to reach Map doesn’t work (screen springs back) | Always-visible way to switch to Map: sticky Map/Directions bar above the list, or floating “Map” button in list view, so user isn’t trapped by list scroll. |
| **4** | Map too small, not zoomed in enough; should fill screen and show tighter view | Map view: map fills available space; tighter default zoom when following (e.g. 18). Track/pan already works. |
| **5** | Buttons and route comparison need more real estate; data too small to read | Move route cards, toggles, and Follow into a pull-up (bottom sheet) panel; give map more room; make Standard vs Right-Turn stats larger and readable. |
| **6** | Off-route: app doesn’t recalculate when I leave the path | When user is detected far from route (snap distance > threshold), recalculate from current position to destination (or next waypoint); update route and list. |

**Suggested sequence:** Do 1 → 2 → 3 first (readability + tap targets + escape from list). Then 4 (map size/zoom), then 5 (pull-up + bigger data). Do 6 (recalculate) after the layout is solid.

---

## Development roadmap

### Phase 1 – Multi-stop, fixed order (no optimization)

**Goal:** Multiple destinations loaded in advance, in a set order; one route for the day with right-turn preference and full turn-by-turn.

- [ ] **Stops list UX**: Add multiple waypoints (addresses); reorder by drag; set “Start from” and “End at” (depot/home/last job).
- [ ] **Routing**: Single OSRM request with all waypoints in order (A→B→C→D…). Apply **right-turn preference per leg** (existing via-point logic per segment); stitch into one route and one turn-by-turn list.
- [ ] **Follow my location**: Current/next stop and current step from the multi-leg route; list and map behavior unchanged in spirit.
- [ ] **Save/load routes**: “Save as Tuesday route” / “Today’s route”; load in the morning without re-entering.
- [ ] **Destination input**: Support typing + autocomplete; add paste/import and (when possible) dictation and saved places (see *Ways for drivers to enter destinations*).
- [ ] **Voice guidance (optional)**: Turn-by-turn narration via Web Speech API when following location (see *Turn-by-turn narration*).

**Outcome:** Delivery drivers and service techs can load the day’s stops, lock the order (themselves or from dispatch), and drive one optimized-for-right-turns route with turn-by-turn, optional voice, and location following.

---

### Phase 2 – “Suggest best order” (lightweight optimization)

**Goal:** Help users who don’t have a fixed sequence by suggesting an order that reduces total time/distance.

- [ ] **Suggest order**: Button that runs a simple TSP (e.g. nearest-neighbor or small solver) to minimize total distance or time; output = ordered list of stops.
- [ ] **Accept or edit**: User can accept suggested order or drag to reorder; then run route as in Phase 1.
- [ ] No time windows yet; optimization is “best sequence for this set of stops.”

**Outcome:** Dispatchers or drivers with a list of stops but no sequence get a one-tap suggestion, then can tweak and go.

---

### Phase 3 – Per-stop details and time windows (display, then optimization)

**Goal:** Richer stop metadata and, later, order suggestions that respect time constraints.

- [ ] **Per-stop notes**: e.g. “Gate code 1234”, “Back door”, “Customer will meet at truck”. Shown in the list and when that stop is active.
- [ ] **Time windows (display)**: Optional “9–11” or “Afternoon” per stop; show as reminder only at first.
- [ ] **Suggest order with time windows**: When suggesting order, respect time windows (heuristic or proper VRP-lite) so the sequence is feasible.

**Outcome:** Service techs and delivery drivers with appointments or time promises get a route that’s both right-turn friendly and time-aware.

---

### Phase 4 – Polish and scale (as needed)

- [ ] **Depot / start & end**: Explicit “Start at” / “End at” in UX and in optimization (return to depot, go home, etc.).
- [ ] **Performance**: Large stop lists (e.g. 20+); chunked or batched routing if required.
- [ ] **Offline / PWA**: Cache tiles and route for areas; basic use without connection (stretch).

---

## Markets and users to pursue

These are audiences for whom **right-turn preference + location-aware turn-by-turn + (when built) multi-destination** is **useful to magical**.

### Already in scope

- **Delivery drivers** (packages, food, last-mile): Many stops, fixed or suggested order; safety and time matter; routes loaded in advance.
- **Small fleet / service techs**: HVAC, plumbers, electricians, dry cleaners, etc.; fewer stops, job duration, often routes built the night before; right turns + multi-stop + “suggest order” and notes = high value.

### Additional markets worth pursuing

1. **School bus / shuttle drivers**  
   Fixed stops and sequence; safety and predictability are paramount. Right-turn routes reduce left-turn exposure at busy intersections; parents and districts care about safety. Multi-stop with fixed order is the core need; “suggest order” less critical.

2. **Elderly or nervous drivers**  
   People who avoid left turns by choice. RightMap is literally “navigation that prefers right turns.” Single A→B today is already valuable; multi-stop (e.g. errands: pharmacy → grocery → home) would make it a daily tool.

3. **Rideshare / taxi (driver side)**  
   Drivers doing multiple pickups/drop-offs; stress and time in traffic matter. Right-turn preference on each leg can reduce exposure and delay; multi-stop and “suggest order” align with “I have a list of stops, optimize my order.”

4. **Fleet and safety managers**  
   Companies that want to reduce left-turn incidents and claims. RightMap as a “safer route” option for company phones or driver apps; multi-destination and reporting (e.g. “this route has X fewer left turns”) could support safety KPIs.

5. **New drivers and driver’s ed**  
   Learning to drive with fewer high-risk left turns builds confidence. Single-route and later multi-stop “errand runs” could be positioned as a training or practice tool.

6. **Truck / larger vehicle drivers**  
   Left turns in big rigs are harder and riskier. Right-turn preference is a direct fit; multi-stop for local delivery or LTL fits the roadmap.

7. **Municipal / waste collection**  
   Fixed routes with many stops; right-turn preference could reduce intersection incidents and speed up routes; multi-stop and fixed order are the main need.

---

## Ways for drivers to enter destinations

Drivers need to add addresses with minimal distraction and in different contexts (desk, truck, walking to the van). Support these input methods and prioritize by driver type.

| Method | Description | Priority / notes |
|--------|-------------|------------------|
| **Typing** | Standard address field with autocomplete (geocoding). | **Must-have.** Already in app; keep as primary. Add autocomplete/suggestions from Nominatim (or similar) as they type. |
| **Paste / import** | Paste a list of addresses (one per line or comma-separated); or import from CSV/file. | **High** for multi-stop. Dispatchers email a list; driver pastes into “Add multiple stops.” Parse lines → geocode each → add to list. |
| **Dictation / voice** | “Add stop: 123 Main Street, Dallas.” Voice-to-text (browser or OS) into the address field; then geocode. | **High** for hands-free. Use browser/OS speech recognition (Web Speech API `SpeechRecognition`) or a “mic” button that fills the field; user confirms then adds. |
| **OCR / camera scan** | Point camera at a printed list, receipt, or order form; extract addresses and add as stops. | **Medium.** Requires OCR (e.g. Tesseract.js or cloud vision). Best for printed manifests or sticky notes; more complex to ship. |
| **Saved places** | “Home,” “Warehouse,” “Office” saved once; one-tap to add to route. | **High** for regulars. Simple key-value store (e.g. localStorage); “Add from saved” when building multi-stop. |
| **Recent / history** | Recently used addresses as quick-add options. | **Medium.** Reduces re-typing for repeat stops. |
| **Share / deep link** | Open a link (e.g. from dispatch app or email) that pre-fills destination or list. | **Later.** RightMap URL with `?to=...` or `?stops=addr1,addr2`; opens app with fields filled. |
| **Map tap** | Tap on the map to set a destination (reverse geocode). | **Later.** Useful for “take me here”; less precise than addresses. |

**Suggested order for build:** (1) Typing + autocomplete, (2) Paste/import for multi-stop, (3) Dictation (mic → field → add), (4) Saved places, (5) OCR if demand is there.

---

## Turn-by-turn narration (voice guidance)

**Yes, it’s possible** to speak the directions during the route using the **Web Speech API** (Speech Synthesis). The browser’s built-in text-to-speech can read the current/next step aloud (e.g. “In 500 feet, turn right onto Main Street”) so drivers get voice guidance without looking at the screen.

**What we’d need:**

- **When to speak:** Trigger when the driver is on the route and approaching a maneuver (e.g. within X meters of the next step, or when `setActiveStep` advances). Optionally announce distance: “In 0.3 miles, turn right onto Commerce Street.”
- **What to say:** Use the same step text we show in the list (e.g. “Turn right onto Main Street — 0.3 mi”). Short, clear phrases; avoid reading the whole list.
- **API:** `speechSynthesis.speak(new SpeechSynthesisUtterance(text))`. No backend required; works in supported browsers (Chrome, Safari, Edge; Firefox varies). Check `speechSynthesis.getVoices()` for language/voice.
- **UX:** A “Voice guidance” or “Speak directions” toggle (on when following location, or always). Respect “muted” or “voice off” so drivers can disable.
- **Timing:** Speak the *next* step in advance (e.g. at 500 m or 0.3 mi before the turn), then optionally repeat or speak “Turn now” when very close. Reuse snapped position and step index (same as list highlight).
- **Limitations:** Quality depends on device/browser voices; no guarantee of offline TTS on all devices. For “in 0.3 miles” we already have distance from the current step.

**Roadmap:** Add as a checkbox in Phase 1 or 2: “Optional voice guidance (TTS) for current/next step when following location.”

---

## How to use this roadmap

- **Prioritize**: Phase 1 (multi-stop, fixed order) unblocks delivery and service techs; Phases 2–3 add optimization and time awareness.
- **Pitch**: Lead with “safer routes with fewer left turns” + “your whole day in one route” for delivery/fleet; add “suggest best order” when that’s live.
- **Markets**: When talking to users or partners, lean on delivery drivers, service techs, school/shuttle, nervous drivers, and fleet/safety—all align with the benefit package and roadmap above.

---

*Last updated to reflect multi-destination plan, phased roadmap, and target markets. Adjust dates and checkboxes as you ship.*
