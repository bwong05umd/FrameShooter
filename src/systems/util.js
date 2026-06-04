/* ============================================================================
 * systems/util.js — small math / geometry helpers (physics-ish primitives).
 * ==========================================================================*/
import { FW, GAME_W } from "../config.js";

/** random float in [a, b) */
export const rand = (a, b) => a + Math.random() * (b - a);

/** AABB overlap test on center-positioned boxes */
export const overlap = (ax, ay, aw, ah, bx, by, bw, bh) =>
  Math.abs(ax - bx) < (aw + bw) / 2 && Math.abs(ay - by) < (ah + bh) / 2;

/** clamp a fighter's x so its box stays inside the arena */
export const clampX = x => Math.max(FW / 2, Math.min(GAME_W - FW / 2, x));
