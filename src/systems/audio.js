/* ============================================================================
 * systems/audio.js — tiny WebAudio blip synth + sound settings.
 * State (on/off, volume) lives here and persists to localStorage.
 * ==========================================================================*/

let actx = null;
let sound = true;
let soundVolume = 1;

/** play a short oscillator blip; respects the on/off + volume settings */
export function beep(freq, dur, type = "square", vol = 0.05) {
  if (!sound || soundVolume <= 0) return;
  vol *= soundVolume;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g).connect(actx.destination);
    const t = actx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}

export const isSoundOn = () => sound;
export const getVolume = () => soundVolume;

export function setSound(on) { sound = !!on; saveSoundSettings(); }
export function setVolume(v) { soundVolume = Math.max(0, Math.min(1, v)); saveSoundSettings(); }

export function loadSoundSettings() {
  try {
    const s = JSON.parse(localStorage.getItem("vff_sound"));
    if (s) {
      if (typeof s.on === "boolean") sound = s.on;
      if (typeof s.vol === "number") soundVolume = Math.max(0, Math.min(1, s.vol));
    }
  } catch (_) {}
}

export function saveSoundSettings() {
  try { localStorage.setItem("vff_sound", JSON.stringify({ on: sound, vol: soundVolume })); } catch (_) {}
}
