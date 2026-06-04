/* ============================================================================
 * entities/fighter.js — the fighter factory and its (pure) state-reading
 * helpers. These take a fighter object and report on its action phase, so the
 * engine, AI and renderer all agree on what frame the fighter is in.
 * ==========================================================================*/
import {
  GAME_W, GAME_H, HP_MAX, total,
  ADR_HP_HI, ADR_HP_LO, ADR_MAX,
} from "../config.js";

/** create a fresh fighter on the given side ("bottom" = player, "top" = CPU) */
export function mkFighter(side) {
  return {
    side,
    x: GAME_W / 2,
    y: side === "bottom" ? GAME_H - 58 : 58,
    hp: HP_MAX,
    meter: 0,
    action: null,
    hitstun: 0,
    combo: 0,
    aiCd: 0,
    flash: 0,
    stored: null,
    charges: null,
    puCd: 0,
    chargeStart: null,         // frame charge button pressed (human only)
    pendingChargeShot: null,   // banked charge ratio 0-1
    pendingChargeArmed: false, // fire the banked charge as soon as free
    fireCd: 0,                 // regular-shot re-fire cooldown (human only)
    chargeCd: 0,               // CPU: cooldown between charge decisions
    moving: false,             // CPU: committed-walk flag (hysteresis)
    trail: [],                 // dash afterimages: {x,y,dir,life,max}
  };
}

/** which phase of its current action a fighter is in */
export function phaseOf(f) {
  if (!f.action) return "idle";
  const d = f.action.data, fr = f.action.frame;
  if (fr < d.startup) return "startup";
  if (fr < d.startup + d.active) return "active";
  if (fr < total(d)) return "recovery";
  return "done";
}

export const isInvuln  = f => f.action && f.action.move === "dash"  && phaseOf(f) === "active";
export const isParrying = f => f.action && f.action.move === "parry" && phaseOf(f) === "active";

/** speed/fire-rate multiplier that ramps up as HP drops below the threshold */
export function adrenalineMult(f) {
  if (f.hp >= ADR_HP_HI) return 1;
  const hp = Math.max(ADR_HP_LO, f.hp);
  const t = (ADR_HP_HI - hp) / (ADR_HP_HI - ADR_HP_LO);
  return 1 + (ADR_MAX - 1) * t;
}
