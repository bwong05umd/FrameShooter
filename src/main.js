/* ============================================================================
 * main.js — game engine + scene/UI wiring.
 *
 * The simulation is intentionally kept as one cohesive 60fps engine rather than
 * shattered across modules (its frame state is tightly shared). Cleanly
 * separable pieces live in their own modules: constants (config.js), audio &
 * geometry (systems/), the fighter factory + phase helpers (entities/), and the
 * landing-page background effect (systems/etheral-shadow.js).
 * ==========================================================================*/
import {
  GAME_W, GAME_H, STEP, METER_MAX, HP_MAX, MOVES, total,
  FW, FH, WALK, BULLET_V, BW, BH, DASH_V, BEAM_HW,
  HITSTUN, HITSTUN_DECAY, HITSTUN_MIN, PUSH,
  DMG_SHOT, DMG_BEAM_TICK, BEAM_TICK, METER_HIT, METER_PARRY,
  DASH_TAP_WIN, CHARGE_FRAMES_MAX, DMG_CHARGE_MAX,
  BLAST_W_MAX, BLAST_H_MAX, BLAST_V_MAX, CHARGE_THRESHOLD, CHARGE_RING_R, FIRE_COOLDOWN,
  CANCEL_WINDOW, CANCELS, PARRY_PERFECT_RECOVERY,
  PU_R, PU_ENTRY_VX, PU_BOUNCE_VX, PU_BOUNCE_VY, PU_BAND_TOP, PU_BAND_BOT,
  PU_SPAWN_MIN, PU_SPAWN_MAX, TRIPLE_OFFSET, SNIPER_V, SNIPER_W, SNIPER_H, DMG_SNIPER,
  PU_COLORS, DIFF, INTRO_MS,
} from "./config.js";
import { beep, isSoundOn, getVolume, setSound, setVolume, loadSoundSettings } from "./systems/audio.js";
import { rand, overlap, clampX } from "./systems/util.js";
import { mkFighter, phaseOf, isInvuln, isParrying, adrenalineMult } from "./entities/fighter.js";
import { createEtherealShadow } from "./systems/etheral-shadow.js";

/* ───────────────────────────── canvas ───────────────────────────── */
const cv = document.getElementById("game");
const ctx = cv.getContext("2d");
cv.width = GAME_W; cv.height = GAME_H;
const W = GAME_W, H = GAME_H;

function fit(){
  const maxH = Math.min(window.innerHeight - 150, 760);
  const scale = Math.max(0.55, Math.min(1, maxH / H));
  cv.style.width  = (W*scale) + "px";
  cv.style.height = (H*scale) + "px";
}
window.addEventListener("resize", fit); fit();

/* ───────────────────────────── state ─────────────────────────────── */
let activeScreen = "menu";   // "menu" | "settings" | "game"
let mode = "versus";
let showHB = false;
let paused = false;
let stepOnce = false;
let frameCount = 0;
let winner = null;
let hitFlash = 0, shake = 0;
let introMs = 0;             // pre-fight countdown milliseconds remaining
let fightFlash = 0;          // "FIGHT!" flash frames after the countdown

let reactionDelay = DIFF.normal.reactionDelay;
let cpuAggro      = DIFF.normal.aggro;
let cpuDodgeAbil  = DIFF.normal.dodge;
let cpuParryAbil  = DIFF.normal.parry;
let cpuChargeAbil = DIFF.normal.charge;
let cpuSmart      = DIFF.normal.smart;
let cpuTier       = DIFF.normal.tier;
let cpuStyle = "balanced";
let dummyMode = "cpu";

let player, opp, bullets, powerups, powerupTimer;

function reset(){
  player = mkFighter("bottom");
  opp = mkFighter("top");
  player.isCPU = false;
  opp.isCPU = true;   // opponent is CPU-driven in BOTH versus and training
  bullets = [];
  powerups = [];
  powerupTimer = 240;
  frameCount = 0; winner = null; hitFlash = 0; shake = 0;
  inputQueue.length = 0;
  paused = false; stepOnce = false;
  syncButtons();
}

/* ───────────────────────────── input ─────────────────────────────── */
const keys = new Set();
const inputQueue = [];
const lastTap = { left:-999, right:-999 };

const DEFAULT_BINDINGS = {
  left:"a", right:"d", fire:"j", charge:"space", dash:"l", parry:"shift", beam:"i", power:"k",
};
const RESERVED = new Set(["r","h","p",".","escape"]); // fixed system keys
let bindings = loadBindings();

function loadBindings(){
  try{
    const saved = JSON.parse(localStorage.getItem("vff_bindings"));
    if (saved && typeof saved === "object") return Object.assign({}, DEFAULT_BINDINGS, saved);
  }catch(_){}
  return Object.assign({}, DEFAULT_BINDINGS);
}
function saveBindings(){ try{ localStorage.setItem("vff_bindings", JSON.stringify(bindings)); }catch(_){} }

function eventKey(e){
  if (e.code === "Space" || e.key === " ") return "space";
  if (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.key === "Shift") return "shift";
  return e.key.toLowerCase();
}
function bindingFor(tok){
  for (const a in bindings){ if (bindings[a] === tok) return a; }
  if (tok === "arrowleft")  return "left";
  if (tok === "arrowright") return "right";
  return null;
}
function isDown(name){
  if (keys.has(bindings[name])) return true;
  if (name === "left"  && keys.has("arrowleft"))  return true;
  if (name === "right" && keys.has("arrowright")) return true;
  return false;
}

let captureBinding = null;

addEventListener("keydown", e => {
  const tok = eventKey(e);

  // Settings: capturing a new key for a rebind
  if (captureBinding){
    e.preventDefault();
    if (tok === "escape"){ endRebind(); return; }
    if (!RESERVED.has(tok)) assignBinding(captureBinding, tok);
    endRebind();
    return;
  }

  if (activeScreen !== "game") return;     // only the arena reads gameplay input

  if (["arrowleft","arrowright","arrowup","arrowdown","space"].includes(tok)) e.preventDefault();
  if (e.repeat) return;
  keys.add(tok);

  const act = bindingFor(tok);

  if (act === "left" || act === "right"){
    const tapDir = act;
    const dirSign = tapDir === "left" ? -1 : 1;
    if (player && player.action && player.action.move === "dash" && phaseOf(player) === "startup"){
      inputQueue.push({ act:"dash", dir: dirSign });
    }
    if (player && player.chargeStart !== null){
      const frames = frameCount - player.chargeStart;
      player.pendingChargeShot = Math.min(frames, CHARGE_FRAMES_MAX) / CHARGE_FRAMES_MAX;
      player.pendingChargeArmed = false;
      player.chargeStart = null;
    }
    if (frameCount - lastTap[tapDir] <= DASH_TAP_WIN){
      inputQueue.push({ act:"dash", dir: dirSign });
      lastTap[tapDir] = -999;
    } else {
      lastTap[tapDir] = frameCount;
    }
  }

  // fixed system keys
  if (tok === "r"){ reset(); return; }
  if (tok === "h"){ toggleHB(); return; }
  if (tok === "p"){ togglePause(); return; }
  if (tok === "." ){ if (paused) stepOnce = true; return; }

  if (act === "parry"){ inputQueue.push("parry"); return; }

  if (act === "charge"){
    if (player){
      if (player.pendingChargeShot !== null && !player.pendingChargeArmed){
        player.pendingChargeArmed = true;
      } else if (player.chargeStart === null && player.pendingChargeShot === null){
        player.chargeStart = frameCount;
      }
    }
    return;
  }

  if (act === "fire")  { inputQueue.push("fire");  return; }
  if (act === "dash")  { inputQueue.push("dash");  return; }
  if (act === "beam")  { inputQueue.push("beam");  return; }
  if (act === "power") { inputQueue.push("power"); return; }
});

addEventListener("keyup", e => {
  const tok = eventKey(e);
  keys.delete(tok);
  if (bindingFor(tok) === "charge" && player && player.chargeStart !== null){
    const frames = frameCount - player.chargeStart;
    const ratio = Math.min(frames, CHARGE_FRAMES_MAX) / CHARGE_FRAMES_MAX;
    player.pendingChargeShot = ratio;
    player.pendingChargeArmed = true;
    player.chargeStart = null;
  }
});

cv.addEventListener("mousedown", () => cv.focus && cv.focus());
cv.tabIndex = 0;

/* ───────────────────────────── combat helpers ────────────────────── */
function pendingMove(f, i){
  if (i.beam && f.meter >= MOVES.beam.cost) return "beam";
  if (i.parry) return "parry";
  if (i.dash)  return "dash";
  if (i.fire)  return "fire";
  return null;
}

function tryStart(f, i, fromCancel){
  let move = null;
  let fireRegular = false;
  if (i.beam && f.meter >= MOVES.beam.cost) move = "beam";
  else if (i.parry) move = "parry";
  else if (i.dash) move = "dash";
  else if (i.fire){
    const cl = i.chargeLevel || 0;
    const isCharge = cl * CHARGE_FRAMES_MAX >= CHARGE_THRESHOLD;
    const hasPowerup = f.charges && f.charges.count > 0;
    fireRegular = !isCharge && !hasPowerup;
    if (!f.isCPU && fireRegular && f.fireCd > 0 && !fromCancel) return false;
    move = "fire";
  }
  if (!move) return false;

  let dir = 0;
  if (move === "dash"){
    if (f.isCPU){ dir = i.dashDir || 0; }
    else if (i.dashDir != null){ dir = i.dashDir; }
    else { dir = (isDown("left")?-1:0) + (isDown("right")?1:0); }
  }
  let data = MOVES[move];
  if (move === "fire"){
    const m = adrenalineMult(f);
    if (m > 1.001){
      data = {
        startup:  Math.max(1, Math.round(data.startup  / m)),
        active:   Math.max(1, Math.round(data.active   / m)),
        recovery: Math.max(1, Math.round(data.recovery / m)),
      };
    }
  }
  const chargeLevel = (move === "fire") ? (i.chargeLevel || 0) : 0;
  f.action = { move, data, frame:0, spawned:false, dir, chargeLevel };
  if (move === "beam") f.meter -= MOVES.beam.cost;
  if (move === "fire" && fireRegular && !f.isCPU){
    f.fireCd = Math.max(1, Math.round(FIRE_COOLDOWN / adrenalineMult(f)));
  }
  if (move === "fire")  beep(chargeLevel > CHARGE_THRESHOLD/CHARGE_FRAMES_MAX ? 280 : 620, .05, "square", .04);
  if (move === "dash")  beep(180, .07, "sawtooth", .05);
  if (move === "parry") beep(900, .04, "triangle", .04);
  if (move === "beam")  beep(110, .25, "sawtooth", .06);
  return true;
}

function clearBankedCharge(f, i){
  if (!f.isCPU && i.fire && i.fromCharge){
    f.pendingChargeShot = null;
    f.pendingChargeArmed = false;
  }
}

function cancelAllowed(f, want){
  if (!f.action || !want) return false;
  const cur = f.action.move, ph = phaseOf(f);
  if (cur === "dash" && ph === "startup" && want === "dash") return true;
  if (ph === "recovery"){
    const remaining = total(f.action.data) - f.action.frame;
    if (remaining <= CANCEL_WINDOW && (CANCELS[cur] || []).includes(want)) return true;
  }
  return false;
}

function applyIntents(f, i){
  if (f.hitstun > 0) return;

  if (f.action){
    const want = pendingMove(f, i);
    if (!cancelAllowed(f, want)) return;
    f.action = null;
    if (want === "fire") f.fireCd = 0;
    if (tryStart(f, i, true)) clearBankedCharge(f, i);
    return;
  }

  if (tryStart(f, i)){
    clearBankedCharge(f, i);
    return;
  }
  if (!f.isCPU && f.chargeStart !== null) return;   // locked while charging
  let dir = 0;
  if (f.isCPU){ dir = (i.left?-1:0) + (i.right?1:0); }
  else { dir = (isDown("left")?-1:0) + (isDown("right")?1:0); }
  if (dir) f.x = clampX(f.x + dir*WALK*adrenalineMult(f));
}

function spawnBullet(f, chargeLevel){
  chargeLevel = chargeLevel || 0;
  const up = f.side === "bottom";
  const mod = f.charges;

  if (mod && mod.count > 0 && mod.kind === "triple"){
    const baseY = up ? f.y - FH/2 - BH/2 : f.y + FH/2 + BH/2;
    const vy = up ? -BULLET_V : BULLET_V;
    for (const dx of [-TRIPLE_OFFSET, 0, TRIPLE_OFFSET]){
      bullets.push({ type:"shot", owner:f.side, x:clampX(f.x+dx), y:baseY, vy,
        w:BW, h:BH, born:frameCount, dead:false, dmg:DMG_SHOT, variant:"triple" });
    }
    beep(700,.05,"square",.045);
    mod.count--;
    if (mod.count <= 0) f.charges = null;
    return;
  }
  if (mod && mod.count > 0 && mod.kind === "sniper"){
    const sy = up ? f.y - FH/2 - SNIPER_H/2 : f.y + FH/2 + SNIPER_H/2;
    const svy = up ? -SNIPER_V : SNIPER_V;
    bullets.push({ type:"shot", owner:f.side, x:f.x, y:sy, vy:svy,
      w:SNIPER_W, h:SNIPER_H, born:frameCount, dead:false, dmg:DMG_SNIPER, variant:"sniper" });
    beep(420,.09,"sawtooth",.05);
    mod.count--;
    if (mod.count <= 0) f.charges = null;
    return;
  }

  if (chargeLevel * CHARGE_FRAMES_MAX >= CHARGE_THRESHOLD){
    const t = chargeLevel;
    const bw = BW + (BLAST_W_MAX - BW) * t;
    const bh = BH + (BLAST_H_MAX - BH) * t;
    const spd = BULLET_V + (BLAST_V_MAX - BULLET_V) * t;
    const vy = up ? -spd : spd;
    const dmg = Math.round(DMG_SHOT + (DMG_CHARGE_MAX - DMG_SHOT) * t);
    const baseY = up ? f.y - FH/2 - bh/2 : f.y + FH/2 + bh/2;
    bullets.push({ type:"shot", owner:f.side, x:f.x, y:baseY, vy,
      w:bw, h:bh, born:frameCount, dead:false, dmg:dmg, variant:"charge", chargeLevel:t });
    beep(200 + t*220, 0.08 + t*0.12, "sawtooth", 0.06 + t*0.02);
    return;
  }

  const baseY = up ? f.y - FH/2 - BH/2 : f.y + FH/2 + BH/2;
  const vy = up ? -BULLET_V : BULLET_V;
  bullets.push({ type:"shot", owner:f.side, x:f.x, y:baseY, vy,
    w:BW, h:BH, born:frameCount, dead:false, dmg:DMG_SHOT, variant:"normal" });
}

function triggerPowerup(f){
  if (winner || !f.stored || f.charges) return;
  if (f.stored === "triple") f.charges = { kind:"triple", count:2 };
  else if (f.stored === "sniper") f.charges = { kind:"sniper", count:1 };
  f.stored = null;
  beep(980,.08,"triangle",.05);
}

function spawnPowerup(){
  const fromLeft = Math.random() < 0.5;
  const kind = Math.random() < 0.5 ? "triple" : "sniper";
  powerups.push({
    kind,
    x: fromLeft ? -PU_R : W+PU_R,
    y: H/2,
    vx: fromLeft ? PU_ENTRY_VX : -PU_ENTRY_VX,
    vy: 0,
    state: "entering",
    spin: 0,
    dead: false,
  });
}

function updatePowerups(){
  if (winner) return;
  if (powerups.length === 0){
    if (--powerupTimer <= 0){ spawnPowerup(); powerupTimer = Math.round(rand(PU_SPAWN_MIN, PU_SPAWN_MAX)); }
  }
  for (const p of powerups){
    p.x += p.vx; p.y += p.vy; p.spin += 0.06;
    if (p.state === "entering"){
      if ((p.vx > 0 && p.x >= W/2) || (p.vx < 0 && p.x <= W/2)){
        p.state = "bouncing";
        p.vx = Math.sign(p.vx) * PU_BOUNCE_VX;
        p.vy = (Math.random() < 0.5 ? -1 : 1) * PU_BOUNCE_VY;
      }
    } else {
      if (p.x < PU_R){ p.x = PU_R; p.vx = Math.abs(p.vx); }
      if (p.x > W-PU_R){ p.x = W-PU_R; p.vx = -Math.abs(p.vx); }
      if (p.y < PU_BAND_TOP){ p.y = PU_BAND_TOP; p.vy = Math.abs(p.vy); }
      if (p.y > PU_BAND_BOT){ p.y = PU_BAND_BOT; p.vy = -Math.abs(p.vy); }
    }
  }
  powerups = powerups.filter(p => !p.dead);
}

function spawnBeam(f){
  const up = f.side === "bottom";
  const muzzle = up ? f.y - FH/2 : f.y + FH/2;
  const far = up ? 0 : H;
  bullets.push({
    type:"beam", owner:f.side,
    x:f.x, y:(muzzle+far)/2, w:BEAM_HW*2, h:Math.abs(far-muzzle),
    vy:0, life:MOVES.beam.active, tick:0, dead:false, born:frameCount,
  });
  shake = 8;
}

function advanceFighter(f){
  if (f.trail.length){
    for (const g of f.trail) g.life--;
    f.trail = f.trail.filter(g => g.life > 0);
  }
  if (f.hitstun > 0){
    f.hitstun--;
    if (f.hitstun === 0) f.combo = 0;
    return;
  }
  if (!f.action) return;
  const ph = phaseOf(f), fr = f.action.frame;
  if (f.action.move === "fire" && fr === f.action.data.startup && !f.action.spawned){
    spawnBullet(f, f.action.chargeLevel || 0); f.action.spawned = true;
  }
  if (f.action.move === "beam" && fr === f.action.data.startup && !f.action.spawned){
    spawnBeam(f); f.action.spawned = true;
  }
  if (f.action.move === "dash" && ph === "active"){
    if (f.action.dir) f.x = clampX(f.x + f.action.dir * DASH_V);
    f.trail.push({ x:f.x, y:f.y, dir:f.action.dir || (f.side==="bottom"?1:-1), life:11, max:11 });
  }
  f.action.frame++;
  if (f.action.frame >= total(f.action.data)) f.action = null;
}

function damage(target, attacker, amount, kind){
  if (winner) return;
  if (target.hitstun > 0) attacker.combo++;
  else attacker.combo = 1;
  target.hp = Math.max(0, target.hp - amount);
  target.hitstun = Math.max(HITSTUN_MIN, HITSTUN - (attacker.combo - 1) * HITSTUN_DECAY);
  let pd = Math.sign(target.x - attacker.x); if (pd === 0) pd = (attacker.combo % 2 ? 1 : -1);
  target.x = clampX(target.x + pd * PUSH);
  target.action = null;
  target.flash = 6;
  attacker.meter = Math.min(METER_MAX, attacker.meter + (kind==="parry"?METER_PARRY:METER_HIT));
  hitFlash = 5; shake = Math.min(12, shake + (kind==="beam"?2:5));
  beep(kind==="parry"?1200:240, .06, "square", .06);
  if (target.hp <= 0){ winner = attacker.side; beep(160,.5,"sawtooth",.07); }
}

function updateBullets(){
  for (const b of bullets){
    const target = (b.owner === "bottom") ? opp : player;

    if (b.type === "beam"){
      b.life--; b.tick--;
      if (b.life <= 0){ b.dead = true; continue; }
      if (overlap(b.x,b.y,b.w,b.h, target.x,target.y,FW,FH) && !isInvuln(target)){
        if (b.tick <= 0){ damage(target, b.owner==="bottom"?player:opp, DMG_BEAM_TICK, "beam"); b.tick = BEAM_TICK; }
      }
      continue;
    }

    b.y += b.vy;
    if (b.y < -20 || b.y > H+20){ b.dead = true; continue; }

    const owner = (b.owner === "bottom") ? player : opp;
    let collected = false;
    for (const p of powerups){
      if (p.dead) continue;
      if (!overlap(b.x,b.y,b.w,b.h, p.x,p.y, PU_R*2, PU_R*2)) continue;
      if (!owner.stored && !owner.charges){
        owner.stored = p.kind; p.dead = true; b.dead = true;
        owner.flash = 6; hitFlash = 4;
        beep(1300,.06,"square",.05);
        collected = true;
      }
      break;
    }
    if (collected) continue;

    if (!overlap(b.x,b.y,b.w,b.h, target.x,target.y,FW,FH)) continue;

    if (isInvuln(target)) continue;
    if (isParrying(target)){
      const perfect = target.action.frame === target.action.data.startup;
      b.owner = target.side;
      b.vy = -b.vy * (perfect ? 1.8 : 1.4);
      b.born = frameCount;
      b.parried = true;
      b.perfect = perfect;
      b.dmg = Math.round((b.dmg || DMG_SHOT) * (perfect ? 2.0 : 1.5));
      target.meter = Math.min(METER_MAX, target.meter + METER_PARRY * (perfect ? 2 : 1));
      if (perfect){
        target.action.frame = Math.max(target.action.frame, total(target.action.data) - PARRY_PERFECT_RECOVERY);
      }
      target.flash = 6; hitFlash = perfect ? 9 : 6; shake = perfect ? 10 : 7;
      beep(perfect ? 1900 : 1500, .05, "triangle", .06);
      continue;
    }
    const attacker = (b.owner === "bottom") ? player : opp;
    damage(target, attacker, b.dmg || DMG_SHOT, "shot");
    b.dead = true;
  }
  bullets = bullets.filter(b => !b.dead);
}

/* ───────────────────────────── AI ────────────────────────────────── */
function cpuChargeLevel(){
  return opp.chargeStart === null ? 0
    : Math.min(frameCount - opp.chargeStart, CHARGE_FRAMES_MAX) / CHARGE_FRAMES_MAX;
}
function releaseCpuCharge(i){
  i.fire = true;
  i.chargeLevel = cpuChargeLevel();
  opp.chargeStart = null;
}
function cpuIncomingThreat(){
  let threat = null, bestT = Infinity;
  for (const b of bullets){
    if (b.owner === opp.side || b.type !== "shot" || b.vy === 0) continue;
    if ((b.y - opp.y) * b.vy >= 0) continue;
    if (frameCount - b.born < reactionDelay) continue;
    if (Math.abs(b.x - opp.x) > (FW/2 + b.w/2 + 5)) continue;
    const t = (opp.y - b.y) / b.vy;
    if (t >= 0 && t < bestT){ bestT = t; threat = b; }
  }
  return threat ? { b: threat, t: bestT } : null;
}
function cpuFleeDir(b){
  let d = Math.sign(opp.x - b.x) || (opp.x < W/2 ? 1 : -1);
  if (opp.x + d*45 > W - FW/2) d = -1;
  if (opp.x + d*45 < FW/2)     d =  1;
  return d;
}
function cpuMoveToward(i, targetX, dead, wake){
  dead = dead || 6; wake = wake || 16;
  const dx = targetX - opp.x, a = Math.abs(dx);
  if (opp.moving){
    if (a <= dead){ opp.moving = false; return; }
  } else if (a < wake){
    return;
  } else {
    opp.moving = true;
  }
  if (dx < 0) i.left = true; else i.right = true;
}

function cpuThink(){
  const i = {left:false,right:false,fire:false,dash:false,parry:false,beam:false,power:false,dashDir:0,chargeLevel:0};
  if (winner){ opp.chargeStart = null; return i; }
  if (opp.hitstun > 0 || opp.action) return i;
  if (opp.chargeCd > 0) opp.chargeCd--;

  if (opp.stored && !opp.charges){ opp.chargeStart = null; i.power = true; return i; }

  const charging = opp.chargeStart !== null;
  const cLvl = cpuChargeLevel();

  const beam = bullets.find(b => b.owner==="bottom" && b.type==="beam"
            && Math.abs(b.x-opp.x) < (BEAM_HW+FW/2));
  if (beam){ i.dash = true; i.dashDir = (opp.x > W/2) ? -1 : 1; return i; }

  if (cpuSmart && !charging && opp.aiCd <= 0 && player.chargeStart !== null){
    const cT = Math.min(frameCount - player.chargeStart, CHARGE_FRAMES_MAX) / CHARGE_FRAMES_MAX;
    if (cT > 0.6 && Math.random() < 0.15){
      i.dash = true; i.dashDir = (player.x <= opp.x) ? 1 : -1;
      opp.aiCd = Math.round(rand(22, 36)); return i;
    }
  }

  const threatInfo = cpuIncomingThreat();
  const dashThresh = (cpuTier >= 3) ? 15 : 12;
  if (threatInfo && threatInfo.t <= dashThresh + 2){
    const { b, t } = threatInfo;
    if (b.cpuPlan === undefined){
      const willDodge = Math.random() < cpuDodgeAbil;
      const asParry   = willDodge && Math.random() < cpuParryAbil;
      b.cpuPlan = !willDodge ? "none" : (asParry ? "parry" : "dash");
    }
    if (b.cpuPlan === "parry" && t >= 1.5 && t <= 4.5){ i.parry = true; return i; }
    if (b.cpuPlan === "dash"  && t <= dashThresh){
      i.dash = true; i.dashDir = cpuFleeDir(b); return i;
    }
    if (b.cpuPlan !== "none") return i;
  }

  if (opp.aiCd > 0) opp.aiCd--;
  if (opp.puCd > 0) opp.puCd--;

  const dx = player.x - opp.x;
  const lined = Math.abs(dx) < 16;
  const pInv = isInvuln(player);

  if (charging){
    const ready = cLvl >= (cpuTier >= 3 ? 0.7 : 0.5);
    const maxed = cLvl >= 0.999;
    if (!pInv && lined && (ready || maxed)){ releaseCpuCharge(i); return i; }
    if (maxed && Math.abs(dx) < 30 && !pInv){ releaseCpuCharge(i); return i; }
    if (!lined) cpuMoveToward(i, player.x);
    return i;
  }

  if (!opp.stored && !opp.charges && powerups.length){
    const p = powerups[0];
    if (Math.abs(p.x - opp.x) > 12){ cpuMoveToward(i, p.x, 8, 12); return i; }
    if (opp.puCd <= 0){ i.fire = true; opp.puCd = Math.round(rand(10,20)); }
    return i;
  }

  if (opp.meter >= METER_MAX){
    const pRec = player.action && phaseOf(player) === "recovery";
    if (lined && (pRec || Math.random() < 0.012)){ i.beam = true; return i; }
  }

  if (!opp.charges && opp.chargeCd <= 0 && !pInv){
    const wantCharge = Math.random() < (lined ? 0.02 : 0.03) * cpuChargeAbil;
    if (wantCharge){
      opp.chargeStart = frameCount;
      opp.chargeCd = Math.round(rand(90, 170));
      return i;
    }
  }

  if (lined){
    if (opp.aiCd <= 0 && !pInv && Math.random() < cpuAggro){
      i.fire = true; opp.aiCd = Math.round(rand(cpuSmart ? 8 : 16, cpuSmart ? 22 : 34)); return i;
    }
    return i;
  }

  if (cpuSmart && Math.abs(dx) > 110 && opp.aiCd <= 0 && Math.random() < 0.03){
    i.dash = true; i.dashDir = Math.sign(dx);
    opp.aiCd = Math.round(rand(24, 40)); return i;
  }
  cpuMoveToward(i, player.x);
  return i;
}

function dummyThink(){
  if (dummyMode === "cpu") return cpuThink();
  const i = {left:false,right:false,fire:false,dash:false,parry:false,beam:false,power:false,dashDir:0,chargeLevel:0};
  if (opp.hitstun > 0 || opp.action || winner) return i;
  if (dummyMode === "track" || dummyMode === "fire"){
    if (dummyMode === "track"){
      const dx = player.x - opp.x;
      if (Math.abs(dx) > 4){ if (dx<0) i.left=true; else i.right=true; }
    }
    if (frameCount % 66 === 0) i.fire = true;
  }
  return i;
}

/* ───────────────────────────── logic step ─────────────────────────── */
function gatherPlayer(){
  const i = {left:isDown("left"), right:isDown("right"),
             fire:false, dash:false, parry:false, beam:false, power:false,
             dashDir:null, chargeLevel:0, fromCharge:false};

  if (player.pendingChargeShot !== null && player.pendingChargeArmed){
    i.fire = true;
    i.chargeLevel = player.pendingChargeShot;
    i.fromCharge = true;
  }

  while (inputQueue.length){
    const a = inputQueue.shift();
    if (typeof a === "string") i[a] = true;
    else if (a && a.act === "dash"){ i.dash = true; i.dashDir = a.dir; }
  }
  return i;
}

function logicStep(){
  if (winner){ inputQueue.length = 0; return; }
  frameCount++;
  if (player.flash>0) player.flash--;
  if (opp.flash>0) opp.flash--;
  if (player.fireCd>0) player.fireCd--;
  if (opp.fireCd>0) opp.fireCd--;
  if (shake>0) shake *= 0.85;

  const pI = gatherPlayer();
  const oI = (mode === "versus") ? cpuThink() : dummyThink();

  if (pI.power) triggerPowerup(player);
  if (oI.power) triggerPowerup(opp);

  applyIntents(player, pI);
  applyIntents(opp, oI);
  advanceFighter(player);
  advanceFighter(opp);
  updatePowerups();
  updateBullets();
}

/* ───────────────────────────── render ────────────────────────────── */
const cssCache = {};
function getCss(v){ return cssCache[v] || (cssCache[v] = getComputedStyle(document.documentElement).getPropertyValue(v).trim()); }

function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

function drawFighter(f){
  const base = f.side === "bottom" ? getCss("--p1") : getCss("--p2");
  const ph = phaseOf(f);

  // dash afterimages (motion trail + i-frame green)
  if (f.trail.length){
    const green = getCss("--invuln");
    ctx.save();
    for (const g of f.trail){
      const a = g.life / g.max;
      const sx = g.x - g.dir * (1 - a) * 10;
      ctx.globalAlpha = 0.34 * a;
      ctx.shadowColor = green; ctx.shadowBlur = 10 * a;
      ctx.fillStyle = green;
      roundRect(sx - FW/2, g.y - FH/2, FW, FH, 5); ctx.fill();
    }
    ctx.restore();
  }
  let col = base;
  if (f.hitstun>0) col = (frameCount%4<2)?"#fff":"#ff7a7a";
  else if (f.action){
    if (f.action.move==="dash" && ph==="active") col = getCss("--invuln");
    else if (f.action.move==="parry" && ph==="active") col = "#fff";
    else if (ph==="startup") col = getCss("--startup");
    else if (ph==="active")  col = getCss("--active");
    else if (ph==="recovery")col = getCss("--recovery");
  }
  const x = f.x - FW/2, y = f.y - FH/2;

  ctx.save();
  if (f.action && (ph==="active") || isInvuln(f) || isParrying(f)){
    ctx.shadowColor = col; ctx.shadowBlur = 18;
  } else { ctx.shadowColor = base; ctx.shadowBlur = 8; }
  ctx.fillStyle = col;
  roundRect(x,y,FW,FH,5); ctx.fill();
  ctx.restore();

  ctx.fillStyle = "rgba(0,0,0,.45)";
  roundRect(x+4,y+4,FW-8,FH-8,3); ctx.fill();

  const mw = 12, mh = 5;
  ctx.fillStyle = col;
  if (f.side==="bottom") roundRect(f.x-mw/2, y-mh, mw, mh, 2);
  else roundRect(f.x-mw/2, y+FH, mw, mh, 2);
  ctx.fill();

  if (isInvuln(f)){
    ctx.strokeStyle = "rgba(61,242,122,.9)"; ctx.lineWidth = 2;
    const pad = 3 + (frameCount%6);
    roundRect(x-pad,y-pad,FW+pad*2,FH+pad*2,7); ctx.stroke();
  }
  if (isParrying(f)){
    ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 2.5;
    roundRect(x-5,y-5,FW+10,FH+10,8); ctx.stroke();
  }
  const adr = adrenalineMult(f);
  if (adr > 1.001){
    const a = 0.22 + 0.18*Math.sin(frameCount*0.4) + (adr-1)*0.5;
    ctx.strokeStyle = `rgba(255,64,64,${Math.min(0.8,a)})`;
    ctx.lineWidth = 2;
    const p = 5 + (adr-1)*18;
    roundRect(x-p,y-p,FW+p*2,FH+p*2,9); ctx.stroke();
  }

  const showCharge = f.chargeStart !== null || f.pendingChargeShot !== null;
  if (showCharge){
    const t = f.chargeStart !== null
      ? Math.min(frameCount - f.chargeStart, CHARGE_FRAMES_MAX) / CHARGE_FRAMES_MAX
      : f.pendingChargeShot;
    const full = t >= 1.0;
    ctx.save();
    if (full){
      const pulse = 0.75 + 0.25 * Math.sin(frameCount * 0.55);
      ctx.strokeStyle = `rgba(255,220,55,${pulse})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = "#ffd23f";
      ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(f.x, f.y, CHARGE_RING_R, 0, Math.PI*2); ctx.stroke();
      ctx.strokeStyle = `rgba(255,200,30,${pulse * 0.35})`;
      ctx.lineWidth = 7; ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(f.x, f.y, CHARGE_RING_R + 5, 0, Math.PI*2); ctx.stroke();
    } else {
      ctx.strokeStyle = `rgba(255,160,20,${0.35 + 0.55*t})`;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      if (f.pendingChargeShot !== null) ctx.setLineDash([3,4]);
      ctx.beginPath();
      ctx.arc(f.x, f.y, CHARGE_RING_R, -Math.PI/2, -Math.PI/2 + t * Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
}

function drawHitboxes(f){
  const x = f.x - FW/2, y = f.y - FH/2;
  const safe = isInvuln(f);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = safe ? "rgba(61,242,122,.95)" : "rgba(127,180,255,.9)";
  ctx.setLineDash([4,3]);
  ctx.strokeRect(x, y, FW, FH);
  ctx.setLineDash([]);
  ctx.font = "9px monospace"; ctx.textAlign = "center";
  ctx.fillStyle = safe ? getCss("--invuln") : "#7fb4ff";
  ctx.fillText(safe ? "INVULN" : "HURT", f.x, f.side==="bottom" ? y-4 : y+FH+11);
}

function drawBullet(b){
  if (b.type === "beam"){
    const flick = (frameCount % 4 < 2) ? 1 : 0.7;
    const grd = ctx.createLinearGradient(b.x-BEAM_HW,0,b.x+BEAM_HW,0);
    const c = (b.owner==="bottom") ? "33,230,193" : "255,61,139";
    grd.addColorStop(0,`rgba(${c},0)`);
    grd.addColorStop(.5,`rgba(${c},${0.85*flick})`);
    grd.addColorStop(1,`rgba(${c},0)`);
    ctx.fillStyle = grd;
    ctx.fillRect(b.x-BEAM_HW, b.y-b.h/2, BEAM_HW*2, b.h);
    ctx.fillStyle = `rgba(255,255,255,${0.6*flick})`;
    ctx.fillRect(b.x-2, b.y-b.h/2, 4, b.h);
    if (showHB){
      ctx.strokeStyle = "rgba(255,75,62,.9)"; ctx.lineWidth=1.5; ctx.setLineDash([5,3]);
      ctx.strokeRect(b.x-b.w/2, b.y-b.h/2, b.w, b.h); ctx.setLineDash([]);
    }
    return;
  }

  if (b.variant === "charge"){
    const t = b.chargeLevel;
    const c = b.owner==="bottom" ? getCss("--p1") : getCss("--p2");
    ctx.save();
    ctx.shadowColor = c; ctx.shadowBlur = 10 + 22*t;
    ctx.fillStyle = c;
    roundRect(b.x-b.w/2, b.y-b.h/2, b.w, b.h, 3 + t*5); ctx.fill();
    const coreW = Math.max(3, b.w * 0.4);
    ctx.fillStyle = `rgba(255,255,255,${0.45 + 0.45*t})`;
    roundRect(b.x-coreW/2, b.y-b.h/2+2, coreW, b.h-4, 3); ctx.fill();
    ctx.restore();
    if (showHB){
      ctx.strokeStyle = "rgba(255,75,62,.95)"; ctx.lineWidth=1.2; ctx.setLineDash([4,2]);
      ctx.strokeRect(b.x-b.w/2, b.y-b.h/2, b.w, b.h); ctx.setLineDash([]);
    }
    return;
  }

  const c = (b.owner==="bottom") ? getCss("--p1") : getCss("--p2");
  ctx.save();
  ctx.shadowColor = b.parried ? "#fff" : c; ctx.shadowBlur = b.variant==="sniper" ? 18 : 12;
  ctx.fillStyle = b.parried ? "#fff" : c;
  roundRect(b.x-b.w/2, b.y-b.h/2, b.w, b.h, 3); ctx.fill();
  if (b.variant === "sniper"){
    ctx.fillStyle = "rgba(255,255,255,.9)";
    roundRect(b.x-1, b.y-b.h/2+2, 2, b.h-4, 1); ctx.fill();
  }
  ctx.restore();
  if (showHB){
    ctx.strokeStyle = "rgba(255,75,62,.95)"; ctx.lineWidth=1.2; ctx.setLineDash([4,2]);
    ctx.strokeRect(b.x-b.w/2, b.y-b.h/2, b.w, b.h); ctx.setLineDash([]);
  }
}

function drawPowerups(){
  for (const p of powerups){
    const col = PU_COLORS[p.kind];
    const r = PU_R;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.shadowColor = col; ctx.shadowBlur = 16;
    ctx.fillStyle = "rgba(8,11,18,.92)";
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    roundRect(-r,-r, r*2, r*2, 6); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = col;
    if (p.kind === "triple"){
      for (const dx of [-6,0,6]){ roundRect(dx-1.5,-6,3,12,1.5); ctx.fill(); }
    } else {
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0,0,5.5,0,Math.PI*2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-9,0); ctx.lineTo(9,0); ctx.moveTo(0,-9); ctx.lineTo(0,9); ctx.stroke();
    }
    ctx.restore();
    if (showHB){
      ctx.strokeStyle = "rgba(255,209,63,.9)"; ctx.lineWidth=1.2; ctx.setLineDash([4,2]);
      ctx.strokeRect(p.x-r, p.y-r, r*2, r*2); ctx.setLineDash([]);
    }
  }
}

function drawHUD(){
  function bar(x,y,w,hp,meter,color){
    ctx.fillStyle = "rgba(255,255,255,.08)";
    roundRect(x,y,w,7,3); ctx.fill();
    ctx.fillStyle = color;
    roundRect(x,y,w*(hp/HP_MAX),7,3); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.08)";
    roundRect(x,y+10,w,4,2); ctx.fill();
    const full = meter>=METER_MAX;
    ctx.fillStyle = full ? "#ffe14d" : "rgba(255,255,255,.55)";
    roundRect(x,y+10,w*(meter/METER_MAX),4,2); ctx.fill();
    if (full){
      ctx.fillStyle="#ffe14d"; ctx.font="bold 8px monospace"; ctx.textAlign="right";
      ctx.fillText("BEAM READY", x+w, y+22);
    }
  }
  bar(14, 12, W-28, opp.hp, opp.meter, getCss("--p2"));
  bar(14, H-26, W-28, player.hp, player.meter, getCss("--p1"));
  puBadge(player, W-16, H-40, "right");
  puBadge(opp, W-16, 50, "right");
}

function puBadge(f, x, y, align){
  let txt = null, col = "#5e6c85";
  if (f.charges){
    const k = f.charges.kind;
    txt = (k==="triple" ? "TRIPLE" : "SNIPER") + " ×" + f.charges.count + " ▸FIRE";
    col = PU_COLORS[k];
  } else if (f.stored){
    txt = "▣ " + (f.stored==="triple" ? "TRIPLE" : "SNIPER") + (f.isCPU ? "" : " ·press K");
    col = PU_COLORS[f.stored];
  }
  if (!txt) return;
  ctx.font = "bold 9px monospace"; ctx.textAlign = align; ctx.fillStyle = col;
  ctx.fillText(txt, x, y);
}

function stateLabel(f){
  if (f.hitstun>0) return `HITSTUN ${f.hitstun}`;
  if (!f.action) return "NEUTRAL";
  const m = f.action.data, ph = phaseOf(f).toUpperCase();
  return `${f.action.move.toUpperCase()} · ${ph} ${f.action.frame+1}/${total(m)}`;
}

function drawTelemetry(){
  ctx.textAlign = "left"; ctx.font = "10px monospace";
  ctx.fillStyle = getCss("--p2");
  ctx.fillText(`P2 ${stateLabel(opp)}`, 16, 40);
  if (adrenalineMult(opp) > 1){ ctx.fillStyle="#ff5b5b"; ctx.fillText(`⚡${(adrenalineMult(opp)).toFixed(2)}x`, 16, 53); }
  if (opp.combo>1){ ctx.fillStyle="#ffd23f"; ctx.fillText(`${opp.combo} COMBO`, W-70, 40); }
  ctx.fillStyle = getCss("--p1");
  ctx.fillText(`P1 ${stateLabel(player)}`, 16, H-32);
  if (adrenalineMult(player) > 1){ ctx.fillStyle="#ff5b5b"; ctx.fillText(`⚡ ADRENALINE ${(adrenalineMult(player)).toFixed(2)}x`, 16, H-19); }
  if (player.combo>1){ ctx.fillStyle="#ffd23f"; ctx.textAlign="right"; ctx.fillText(`${player.combo} COMBO`, W-16, H-32); ctx.textAlign="left"; }
  if (mode==="training"){
    ctx.fillStyle = "#5e6c85"; ctx.textAlign="center";
    ctx.fillText(`FRAME ${frameCount}`, W/2, 40);
  }
}

// The arena backdrop never changes, so render it once offscreen and blit it.
const bgCanvas = (() => {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#04060b"; g.fillRect(0,0,W,H);
  g.strokeStyle = "rgba(50,70,110,.16)"; g.lineWidth = 1;
  g.beginPath();
  for (let x=0;x<=W;x+=22){ g.moveTo(x,0); g.lineTo(x,H); }
  for (let y=0;y<=H;y+=22){ g.moveTo(0,y); g.lineTo(W,y); }
  g.stroke();
  g.strokeStyle = "rgba(120,140,180,.18)"; g.setLineDash([8,8]);
  g.beginPath(); g.moveTo(0,H/2); g.lineTo(W,H/2); g.stroke(); g.setLineDash([]);
  const g1 = g.createLinearGradient(0,H,0,H-150);
  g1.addColorStop(0,"rgba(33,230,193,.07)"); g1.addColorStop(1,"rgba(33,230,193,0)");
  g.fillStyle=g1; g.fillRect(0,H-150,W,150);
  const g2 = g.createLinearGradient(0,0,0,150);
  g2.addColorStop(0,"rgba(255,61,139,.07)"); g2.addColorStop(1,"rgba(255,61,139,0)");
  g.fillStyle=g2; g.fillRect(0,0,W,150);
  return c;
})();
function drawBackground(){ ctx.drawImage(bgCanvas, 0, 0); }

// pre-fight 3·2·1 countdown overlay — the "get ready" beat before play
function drawIntro(){
  const veil = Math.min(0.74, (introMs/INTRO_MS)*0.9 + 0.06);
  ctx.fillStyle = `rgba(4,6,11,${veil})`; ctx.fillRect(0,0,W,H);

  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#9fb0d0"; ctx.font = "12px monospace";
  ctx.fillText(mode==="versus" ? `VS CPU · ${selectedDiff.toUpperCase()}` : "TRAINING", W/2, H/2 - 84);

  const sec = Math.ceil(introMs/1000);      // 3 → 2 → 1
  const frac = (introMs % 1000) / 1000;     // 1 → 0 within each second
  const pop = 1 + frac*0.55;
  ctx.save();
  ctx.translate(W/2, H/2);
  ctx.scale(pop, pop);
  ctx.globalAlpha = Math.min(1, frac*2.4);
  ctx.fillStyle = "#fff"; ctx.font = "bold 96px monospace";
  ctx.shadowColor = getCss("--p1"); ctx.shadowBlur = 34;
  ctx.fillText(String(sec), 0, 0);
  ctx.restore();

  ctx.fillStyle = "#5e6c85"; ctx.font = "11px monospace";
  ctx.fillText("get ready", W/2, H/2 + 78);
  ctx.textBaseline = "alphabetic";
}

function drawFightFlash(){
  ctx.save();
  ctx.globalAlpha = Math.min(1, fightFlash/22);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = getCss("--startup"); ctx.font = "bold 60px monospace";
  ctx.shadowColor = getCss("--startup"); ctx.shadowBlur = 26;
  ctx.fillText("FIGHT!", W/2, H/2);
  ctx.restore();
  ctx.textBaseline = "alphabetic";
}

function render(){
  ctx.save();
  if (shake > 0.4){ ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake); }
  drawBackground();
  for (const b of bullets) drawBullet(b);
  drawPowerups();
  drawFighter(opp);
  drawFighter(player);
  if (showHB){ drawHitboxes(opp); drawHitboxes(player); }
  drawHUD();
  drawTelemetry();
  ctx.restore();

  if (hitFlash > 0){
    ctx.fillStyle = `rgba(255,255,255,${0.06*hitFlash})`;
    ctx.fillRect(0,0,W,H); hitFlash -= 0.6;
  }

  if (introMs > 0){ drawIntro(); return; }
  if (fightFlash > 0) drawFightFlash();

  if (paused && !winner){
    ctx.fillStyle = "rgba(4,6,11,.55)"; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = "#ffd23f"; ctx.textAlign="center"; ctx.font="bold 18px monospace";
    ctx.fillText("⏸ PAUSED", W/2, H/2-10);
    ctx.fillStyle="#c9d4e8"; ctx.font="11px monospace";
    ctx.fillText("press  .  to step one frame", W/2, H/2+14);
  }

  if (winner){
    ctx.fillStyle = "rgba(4,6,11,.7)"; ctx.fillRect(0,0,W,H);
    ctx.textAlign="center";
    const win = winner==="bottom";
    ctx.fillStyle = win ? getCss("--p1") : getCss("--p2");
    ctx.font="bold 26px monospace";
    ctx.fillText(win ? "YOU WIN" : "K.O. — CPU WINS", W/2, H/2-6);
    ctx.fillStyle="#c9d4e8"; ctx.font="12px monospace";
    ctx.fillText("press  R  to reset", W/2, H/2+22);
  }
}

/* ───────────────────────────── loop ──────────────────────────────── */
let acc = 0, last = performance.now();
function frame(now){
  requestAnimationFrame(frame);
  const dt = now - last; last = now;
  if (activeScreen !== "game"){ acc = 0; return; }

  // pre-fight countdown: freeze the sim, tick the timer by real elapsed time
  if (introMs > 0){
    const before = Math.ceil(introMs/1000);
    introMs = Math.max(0, introMs - dt);
    const after = Math.ceil(introMs/1000);
    if (introMs > 0 && after !== before) beep(480, .08, "square", .05);  // 3·2·1 ticks
    if (introMs === 0){ beep(760, .2, "square", .06); fightFlash = 34; } // FIGHT!
    acc = 0; render(); return;
  }
  if (fightFlash > 0) fightFlash--;

  if (!paused){
    acc += dt; let steps = 0;
    while (acc >= STEP && steps < 5){ logicStep(); acc -= STEP; steps++; }
    if (acc > STEP*5) acc = 0;
  } else if (stepOnce){
    logicStep(); stepOnce = false;
  }
  render();
}

/* ───────────────────────────── UI wiring ─────────────────────────── */
const $ = id => document.getElementById(id);

function syncButtons(){
  const tc = $("trainCard"); if (tc) tc.style.display = mode==="training" ? "" : "none";
  const hb = $("hitbox");    if (hb) hb.classList.toggle("active", showHB);
  const sn = $("sound");     if (sn) sn.classList.toggle("active", isSoundOn());
  const pz = $("pause");     if (pz) pz.textContent = paused ? "▶ Resume (P)" : "⏸ Pause (P)";
}
function toggleHB(){ showHB = !showHB; syncButtons(); }
function togglePause(){ if (activeScreen!=="game" || introMs>0) return; paused = !paused; syncButtons(); }

function showScreen(name){
  activeScreen = name;
  $("menu").hidden       = name !== "menu";
  $("settings").hidden   = name !== "settings";
  $("gameScreen").hidden = name !== "game";
  if (name === "game"){ fit(); setTimeout(() => cv.focus && cv.focus(), 0); }
  if (name === "settings"){ renderRebind(); syncSettings(); }
}
function startGame(m){
  mode = m;
  showHB = (m === "training");
  applyDifficulty(selectedDiff);
  cpuStyle = selectedStyle;
  reset();
  introMs = INTRO_MS; fightFlash = 0;        // run the pre-fight countdown
  $("gameSub").textContent = (m==="versus" ? "VERSUS CPU · "+selectedDiff.toUpperCase() : "TRAINING LAB") + " · 60 FPS · FRAME-PERFECT";
  renderLiveControls();
  showScreen("game");
}

/* difficulty & style */
let selectedDiff = "normal", selectedStyle = "balanced";
function applyDifficulty(v){
  const d = DIFF[v] || DIFF.normal;
  reactionDelay = d.reactionDelay;
  cpuAggro      = d.aggro;
  cpuDodgeAbil  = d.dodge;
  cpuParryAbil  = d.parry;
  cpuChargeAbil = d.charge;
  cpuSmart      = d.smart;
  cpuTier       = d.tier;
}
function selectDiff(v){
  selectedDiff = v; applyDifficulty(v);
  for (const b of $("diffPills").children) b.classList.toggle("active", b.dataset.diff===v);
}
function selectStyle(v){
  selectedStyle = v; cpuStyle = v;
  for (const b of $("stylePills").children) b.classList.toggle("active", b.dataset.style===v);
}

/* controls: labels & rebinding */
const REBIND_ORDER = [
  ["left","Move Left"],["right","Move Right"],["fire","Fire"],["charge","Charge"],
  ["dash","Dash"],["parry","Parry"],["beam","Beam"],["power","Power-up"],
];
const KEY_LABELS = { space:"Space", shift:"Shift", arrowleft:"◄", arrowright:"►", arrowup:"▲", arrowdown:"▼" };
function keyLabel(tok){
  if (!tok) return "—";
  if (KEY_LABELS[tok]) return KEY_LABELS[tok];
  if (tok.length === 1) return tok.toUpperCase();
  return tok.charAt(0).toUpperCase() + tok.slice(1);
}
let listeningCap = null;
function startRebind(act, cap){
  if (listeningCap) endRebind();
  captureBinding = act; listeningCap = cap;
  cap.classList.add("listening"); cap.textContent = "press…";
}
function endRebind(){
  captureBinding = null;
  if (listeningCap) listeningCap.classList.remove("listening");
  listeningCap = null;
  renderRebind(); renderLiveControls();
}
function assignBinding(act, tok){
  for (const a in bindings){ if (a !== act && bindings[a] === tok) bindings[a] = null; }
  bindings[act] = tok;
  saveBindings();
}
function renderRebind(){
  const grid = $("rebindGrid"); if (!grid) return;
  grid.innerHTML = "";
  for (const [act,label] of REBIND_ORDER){
    const row = document.createElement("div"); row.className = "rb-row";
    const name = document.createElement("div"); name.className = "rb-name";
    name.innerHTML = label + ((act==="left"||act==="right") ? "<small>arrow keys always work too</small>" : "");
    const keyWrap = document.createElement("div"); keyWrap.className = "rb-key";
    const cap = document.createElement("button"); cap.className = "keycap";
    cap.textContent = keyLabel(bindings[act]);
    cap.onclick = () => startRebind(act, cap);
    keyWrap.appendChild(cap);
    row.appendChild(name); row.appendChild(keyWrap);
    grid.appendChild(row);
  }
}
function renderLiveControls(){
  const el = $("liveControls"); if (!el) return;
  const k = a => `<kbd>${keyLabel(bindings[a])}</kbd>`;
  el.innerHTML =
    `<span>${k("left")}/${k("right")} · <kbd>◄</kbd><kbd>►</kbd></span><span>Shuffle left / right</span>`+
    `<span>${k("fire")}</span><span>Fire — 3 / 3 / 8</span>`+
    `<span>${k("charge")} hold</span><span>Charge blast — release to fire</span>`+
    `<span>${k("dash")}</span><span>Dash i-frames — 2 / 8 / 10 · or double-tap ◄/►</span>`+
    `<span>${k("parry")}</span><span>Parry — 1 / 2 / 22 · reflects fire</span>`+
    `<span>${k("power")}</span><span>Trigger held power-up</span>`+
    `<span>${k("beam")}</span><span>Beam (full meter) — 30 / 40 / 25</span>`;
}

/* settings */
function syncSettings(){
  if ($("setSound"))  $("setSound").checked = isSoundOn();
  if ($("setVolume")) $("setVolume").value = Math.round(getVolume()*100);
}
function refreshSoundUI(){ syncSettings(); syncButtons(); }

/* event wiring */
$("playVersus").onclick  = () => startGame("versus");
$("playTrain").onclick   = () => startGame("training");
$("openSettings").onclick= () => showScreen("settings");
$("openHowto").onclick   = () => { const w = $("howtoWrap"); w.hidden = !w.hidden; };
$("settingsBack").onclick= () => showScreen("menu");
$("toMenu").onclick      = () => showScreen("menu");

$("diffPills").querySelectorAll("button").forEach(b => b.onclick = () => selectDiff(b.dataset.diff));
$("stylePills").querySelectorAll("button").forEach(b => b.onclick = () => selectStyle(b.dataset.style));

$("reset").onclick  = () => reset();
$("pause").onclick  = () => togglePause();
$("step").onclick   = () => { if (introMs>0) return; paused = true; stepOnce = true; syncButtons(); };
$("hitbox").onclick = () => toggleHB();
$("sound").onclick  = () => { setSound(!isSoundOn()); if (isSoundOn()) beep(800,.03); refreshSoundUI(); };
$("dummy").onchange = e => { dummyMode = e.target.value; };

$("setSound").onchange = e => { setSound(e.target.checked); if (isSoundOn()) beep(800,.03); refreshSoundUI(); };
$("setVolume").oninput = e => { setVolume((+e.target.value)/100); };
$("resetBinds").onclick = () => { bindings = Object.assign({}, DEFAULT_BINDINGS); saveBindings(); renderRebind(); renderLiveControls(); };

/* ───────────────────────────── boot ──────────────────────────────── */
function mountBackground(){
  const host = $("bgfx");
  if (host) host.appendChild(createEtherealShadow({
    color: "rgba(95, 110, 180, 1)",
    scale: 80, speed: 70, noiseOpacity: 0.45, noiseScale: 1.2, sizing: "fill",
  }));
}

loadSoundSettings();
mountBackground();
selectDiff(selectedDiff);
selectStyle(selectedStyle);
renderRebind();
renderLiveControls();
syncSettings();
reset();
showScreen("menu");
requestAnimationFrame(frame);
