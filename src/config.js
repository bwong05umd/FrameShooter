/* ============================================================================
 * config.js — game dimensions, renderer settings, frame data and tuning.
 * Pure constants only (no DOM, no state). Imported across the engine.
 * ==========================================================================*/

/* canvas / renderer */
export const GAME_W = 440;
export const GAME_H = 680;
export const STEP = 1000 / 60;          // ms per logic tick (60 fps fixed step)

/* core combat numbers */
export const METER_MAX = 100;
export const HP_MAX = 150;

export const MOVES = {
  fire : { startup:3,  active:3,  recovery:8  },
  dash : { startup:2,  active:8,  recovery:10 },
  parry: { startup:1,  active:2,  recovery:22 },
  beam : { startup:30, active:40, recovery:25, cost:METER_MAX },
};
export const total = m => m.startup + m.active + m.recovery;

export const FW = 34, FH = 26;          // fighter box
export const WALK = 4.0;
export const BULLET_V = 8;
export const BW = 9, BH = 16;           // standard shot box
export const DASH_V = 7;
export const BEAM_HW = 22;
export const HITSTUN = 26;
export const HITSTUN_DECAY = 6;
export const HITSTUN_MIN = 8;
export const PUSH = 10;
export const DMG_SHOT = 9;
export const DMG_PARRY = 14;
export const DMG_BEAM_TICK = 3;
export const BEAM_TICK = 6;
export const METER_HIT = 12, METER_PARRY = 5;
export const DASH_TAP_WIN = 14;
export const ADR_HP_HI = 45;
export const ADR_HP_LO = 1;
export const ADR_MAX = 1.5;

/* charge shot */
export const CHARGE_FRAMES_MAX = 120;   // 2 seconds at 60fps
export const DMG_CHARGE_MAX = 72;
export const BLAST_W_MAX = 26;
export const BLAST_H_MAX = 40;
export const BLAST_V_MAX = 15;
export const CHARGE_THRESHOLD = 5;      // frames held before it counts as a charge
export const CHARGE_RING_R = 24;
export const FIRE_COOLDOWN = 28;        // regular-shot re-fire lockout (human only)

/* advanced tech — frame-tight cancels */
export const CANCEL_WINDOW = 4;
export const CANCELS = {
  fire:  ["dash","parry","fire"],
  dash:  ["dash","parry"],
  parry: ["fire","dash"],
  beam:  [],
};
export const PARRY_PERFECT_RECOVERY = 6;

/* power-ups */
export const PU_R = 13;
export const PU_ENTRY_VX = 7;
export const PU_BOUNCE_VX = 4;
export const PU_BOUNCE_VY = 2.6;
export const PU_BAND_TOP = 150, PU_BAND_BOT = GAME_H - 150;
export const PU_SPAWN_MIN = 360, PU_SPAWN_MAX = 540;
export const TRIPLE_OFFSET = 19;
export const SNIPER_V = 22;
export const SNIPER_W = 5;
export const SNIPER_H = 36;
export const DMG_SNIPER = 26;
export const PU_COLORS = { triple:"#ff9f1c", sniper:"#cfe3ff" };

/* CPU difficulty tiers. NORMAL plays at old "expert" level; easy ramps below it. */
export const DIFF = {
  // dodge = chance to evade ANY given shot (decided once per bullet, not per frame)
  easy:   { tier:0, reactionDelay:30, dodge:0.12, parry:0.08, charge:0.15, aggro:0.35, smart:false },
  normal: { tier:1, reactionDelay:14, dodge:0.33, parry:0.30, charge:0.40, aggro:0.60, smart:true  },
  hard:   { tier:2, reactionDelay:7,  dodge:0.68, parry:0.62, charge:0.75, aggro:0.88, smart:true  },
  expert: { tier:3, reactionDelay:3,  dodge:0.92, parry:0.92, charge:1.00, aggro:1.00, smart:true  },
};

/* pre-fight countdown length (ms) for the menu → match transition.
   Time-based (not frame-based) so it's a real 3 seconds at any frame rate. */
export const INTRO_MS = 3000;
