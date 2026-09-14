/* ═══════════════════════════════════════════════════════════════
   CONFIG — every tunable in one place.
   Imported by the main thread AND the slot worker, so keep this
   file free of DOM / three.js imports.
   ═══════════════════════════════════════════════════════════════ */

export const CONFIG = {
  MODEL_URL:      './assets/models/car.glb',
  CAMPAIGNS_URL:  './data/campaigns.json',

  TARGET_AUD:     1_100_000,   // the whole car, GST inclusive
  GST:            0.10,
  CELL_SIZE:      0.120,       // metres — nominal slot edge; drives the slot count
  MIN_PRICE:      60,          // AUD floor per slot
  ROUND_TO:       10,

  SLOT_ALGO:      9,           // bump to invalidate the IndexedDB slot cache
  SEED:           20260914,

  DRIVER_SIDE:    +1,          // +Z is the car's right-hand side → right-hand drive (AU)

  HOLD_MINUTES:   15,
};

/* Price ramp on a white car: pale sky blue for the cheapest slots,
   through the Lock Ratio blue to purple for the most visible. Sold
   slots go a light neutral grey under their sticker; your own
   selection is the brand yellow so it reads against both. */
export const PALETTE = {
  heat:     ['#e3eaff','#c3d3ff','#9db8ff','#6f95ff','#3d70ff','#1955FF','#4d49ff','#7E37FF'],
  sold:     '#d6d8de',
  selected: '#D1CC00',
  hover:    '#ffffff',
  paint:    '#ebebeb',
};

/* ─────────────────────────────────────────────────────────────
   ZONES
   Visibility is what an advertiser pays for. `mult` scales the
   area-based price; `rail` puts the zone in the jump-to list.
   Left/right pairs share a `family` for grouping in the cart.
   ───────────────────────────────────────────────────────────── */
export const ZONES = {
  nose:         { label:'Nose',            mult:4.6, rail:true,  family:'Nose',          blurb:'First thing seen in every mirror and every head-on photo.' },
  bonnet:       { label:'Bonnet',          mult:4.0, rail:true,  family:'Bonnet',        blurb:'The hero panel. Faces the camera in three-quarter shots.' },
  wing:         { label:'Rear wing',       mult:3.6, rail:true,  family:'Rear wing',     blurb:'Sits above the roofline — visible over traffic.' },
  tail:         { label:'Tail',            mult:3.4, rail:true,  family:'Tail',          blurb:'What everyone behind you stares at.' },
  door_r:       { label:'Driver door',     mult:3.1, rail:true,  family:'Doors',         blurb:'Eye height on the kerb side. Scissor doors open upward and lift it into the sky.' },
  door_l:       { label:'Passenger door',  mult:2.9, rail:true,  family:'Doors',         blurb:'Eye height on the traffic side.' },
  roof:         { label:'Roof',            mult:2.3, rail:true,  family:'Roof',          blurb:'Drone shots and overpasses. Two removable panels.' },
  fq_r:         { label:'Front quarter R', mult:2.2, rail:false, family:'Front quarters',blurb:'Over the front wheel, driver side.' },
  fq_l:         { label:'Front quarter L', mult:2.2, rail:false, family:'Front quarters',blurb:'Over the front wheel, passenger side.' },
  rh_r:         { label:'Rear haunch R',   mult:2.0, rail:true,  family:'Rear haunches', blurb:'The widest, most sculpted panel on the car.' },
  rh_l:         { label:'Rear haunch L',   mult:2.0, rail:false, family:'Rear haunches', blurb:'The widest, most sculpted panel on the car.' },
  engine_cover: { label:'Engine cover',    mult:1.9, rail:true,  family:'Engine cover',  blurb:'Between the roof and the wing.' },
  rear_deck:    { label:'Rear deck',       mult:1.5, rail:false, family:'Rear deck',     blurb:'Around the engine cover.' },
  pillars:      { label:'Pillars & rails', mult:1.4, rail:false, family:'Pillars',       blurb:'Windscreen frame and roof rails.' },
  body:         { label:'Body',            mult:1.0, rail:false, family:'Body',          blurb:'Everything else that takes vinyl.' },
  sills:        { label:'Sill',            mult:0.5, rail:false, family:'Sills',         blurb:'Low and close to the road.' },
};

export const RAIL_ORDER = ['bonnet','nose','door_r','door_l','rh_r','wing','tail','roof','engine_cover'];

/* Geometric thresholds used to split the welded body shell into
   zones. All in car space: nose +X, up +Y, right-hand side +Z,
   4.80 m long, front axle x≈+1.25, rear axle x≈−1.43. */
export const GEO = {
  BONNET_X_MIN:   0.42,   // cowl / windscreen base
  NOSE_X:         1.78,   // forward of this + facing forward = nose
  TAIL_X:        -1.95,
  DOOR_X_MIN:    -0.52,   // door trailing edge (side intake starts)
  DOOR_X_MAX:     0.78,   // door leading edge (behind the front arch)
  DOOR_Y_MIN:     0.30,
  ROOF_X_MAX:    -0.26,   // shell top surface aft of this is rear deck
  TAIL_TOP_X:    -1.92,   // top surface aft of this is the tail
  DECK_HALF_W:    0.50,   // |z| beyond this on the rear top surface = haunch shoulder
  SIDE_N:         0.45,   // |n.z| above this = side-facing
  TOP_N:          0.55,
  FRONT_N:        0.45,
  UNDER_Y:        0.30,   // underside filter
  UNDER_N:       -0.55,
  AXIS_Y:         0.48,   // longitudinal axis height for the outward test
};
