/* ═══════════════════════════════════════════════════════════════
   ZONE ASSIGNMENT
   The glTF carries a `part` per paint mesh (baked by
   tools/build_model.py). Parts that are whole panels map straight
   to a zone; the welded body shell and the rear-quarter section are
   split geometrically. Runs inside the worker — no DOM, no three.
   ═══════════════════════════════════════════════════════════════ */
import { GEO, CONFIG } from './config.js';

const side = z => (Math.sign(z) === Math.sign(CONFIG.DRIVER_SIDE) ? 'r' : 'l');

/** @param {string} part  @param {number[]} c centroid  @param {number[]} n unit normal */
export function zoneOf(part, c, n){
  const [x, y, z] = c;
  const nx = n[0], ny = n[1], nz = n[2], anz = Math.abs(nz);

  switch(part){
    case 'wing':         return 'wing';
    case 'sills':        return 'sills';
    case 'roof':         return 'roof';
    case 'engine_cover': return 'engine_cover';
    case 'front_bumper': return 'nose';
    case 'deck':         return ny > GEO.TOP_N && x < GEO.ROOF_X_MAX ? 'rear_deck' : 'pillars';
    case 'rear_quarter':
      if (x < GEO.TAIL_X && nx < -GEO.FRONT_N) return 'tail';
      if (anz > GEO.SIDE_N && y > 0.22)         return 'rh_' + side(z);
      if (x < GEO.TAIL_X)                       return 'tail';
      return 'body';
  }

  /* ── the welded shell ── */
  if (x > GEO.NOSE_X && nx > GEO.FRONT_N)                    return 'nose';
  if (x < GEO.TAIL_X && nx < -GEO.FRONT_N)                   return 'tail';
  if (ny > GEO.TOP_N){
    if (x > GEO.BONNET_X_MIN)                                return 'bonnet';
    if (x < GEO.TAIL_TOP_X)                                  return 'tail';
    if (x < GEO.ROOF_X_MAX)                                  return Math.abs(z) > GEO.DECK_HALF_W ? 'rh_' + side(z) : 'rear_deck';
    return 'pillars';
  }
  if (anz > GEO.SIDE_N){
    if (x > GEO.DOOR_X_MAX)                                  return 'fq_' + side(z);
    if (x > GEO.DOOR_X_MIN && y > GEO.DOOR_Y_MIN)            return 'door_' + side(z);
    if (x > GEO.DOOR_X_MIN)                                  return 'sills';
    return 'rh_' + side(z);
  }
  if (x > GEO.BONNET_X_MIN && ny > 0.2)                      return 'bonnet';
  if (x > GEO.NOSE_X)                                        return 'nose';
  return 'body';
}
