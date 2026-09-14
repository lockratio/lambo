/* ═══════════════════════════════════════════════════════════════
   SFX — tiny interface ticks. A brush detent, a preset click, a
   slot landing. Synthesised, so nothing to download; quiet enough
   to feel rather than hear. Off switch persists in localStorage.
   ═══════════════════════════════════════════════════════════════ */
const KEY = 'lambo.sfx';

export function createSfx(){
  let ctx = null, enabled = true;
  try { enabled = localStorage.getItem(KEY) !== '0'; } catch {}

  function ensure(){
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    ctx = new AC();
    return ctx;
  }
  /* a short sine blip with a fast exponential tail */
  function blip(freq, dur, gain, type = 'sine'){
    if (!enabled) return;
    const c = ensure(); if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.6), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  const haptic = (ms) => { try { navigator.vibrate?.(ms); } catch {} };

  return {
    /** dial detent: brush step, zoom step */
    tick(){ blip(2400, 0.028, 0.045, 'triangle'); haptic(4); },
    /** a control changed state: mode, preset, toggle */
    click(){ blip(900, 0.05, 0.05); haptic(6); },
    /** slots added to the selection */
    pop(){ blip(560, 0.09, 0.05); },
    /** something undone / removed */
    drop(){ blip(320, 0.08, 0.04); },
    toggle(){ enabled = !enabled; try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch {} if (enabled) this.click(); return enabled; },
    get enabled(){ return enabled; },
  };
}
