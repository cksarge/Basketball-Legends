// Crowd voices, synthesized (no recordings): every sound is a few dozen "people" made of a
// buzzing vocal source shaped by vowel formants, rendered once into buffers with an
// OfflineAudioContext when audio unlocks. Applause is built sample by sample from claps.

export interface CrowdBank {
  /** Seamless loops: a murmuring arena, and the same crowd on its feet. */
  bedCalm: AudioBuffer;
  bedLoud: AudioBuffer;
  roar: AudioBuffer[];
  applause: AudioBuffer[];
  ooh: AudioBuffer;
  aww: AudioBuffer;
  boo: AudioBuffer;
  /** One "DE-FENSE" + stomp-clap cycle; the engine repeats it. */
  chant: AudioBuffer;
}

const SR = 24000;

type Vowel = "a" | "e" | "i" | "o" | "u" | "aw" | "uh";
const FORMANTS: Record<Vowel, [number, number, number]> = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [300, 2200, 2950],
  o: [570, 840, 2410],
  u: [320, 870, 2240],
  aw: [640, 950, 2400],
  uh: [520, 1190, 2390],
};
const FORMANT_GAIN = [1, 0.55, 0.22];

/** Small deterministic RNG so every game hears the same crowd character. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Syllable {
  t: number;
  dur: number;
  vowel: Vowel;
  /** Pitch at the start and end of the syllable (Hz). */
  f0: number;
  f1: number;
  gain: number;
  attack?: number;
  release?: number;
}

interface VoiceSpec {
  pan: number;
  /** Formant scale: ~1 for men, ~1.17 for women, ~1.3 for kids. */
  tract: number;
  syllables: Syllable[];
}

function offline(len: number) {
  const Ctx =
    (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext ??
    (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctx) return null;
  return new Ctx(2, Math.ceil(len * SR), SR);
}

/** One person: a sawtooth "glottis" through three parallel formant filters. */
function addVoice(ctx: OfflineAudioContext, dest: AudioNode, v: VoiceSpec) {
  if (!v.syllables.length) return;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  const amp = ctx.createGain();
  amp.gain.value = 0;
  const pan = ctx.createStereoPanner();
  pan.pan.value = v.pan;
  const filters = FORMANT_GAIN.map((g) => {
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 6;
    const fg = ctx.createGain();
    fg.gain.value = g;
    osc.connect(f).connect(fg).connect(amp);
    return f;
  });
  amp.connect(pan).connect(dest);
  const first = v.syllables[0];
  osc.frequency.setValueAtTime(first.f0, Math.max(0, first.t));
  for (const s of v.syllables) {
    const a = s.attack ?? 0.025,
      r = s.release ?? 0.05;
    const t0 = Math.max(0, s.t);
    osc.frequency.setValueAtTime(s.f0, t0);
    osc.frequency.linearRampToValueAtTime(s.f1, t0 + s.dur);
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(s.gain, t0 + a);
    amp.gain.setValueAtTime(s.gain, t0 + Math.max(a, s.dur - r));
    amp.gain.linearRampToValueAtTime(0, t0 + s.dur);
    FORMANTS[s.vowel].forEach((hz, i) => filters[i].frequency.setValueAtTime(hz * v.tract, t0));
  }
  const last = v.syllables[v.syllables.length - 1];
  osc.start(Math.max(0, first.t));
  osc.stop(last.t + last.dur + 0.05);
}

function person(r: () => number) {
  const k = r();
  // a mixed crowd: mostly adults, some kids
  return k < 0.55 ? { f0: 95 + r() * 55, tract: 1 } : k < 0.9 ? { f0: 175 + r() * 70, tract: 1.17 } : { f0: 250 + r() * 70, tract: 1.3 };
}

const VOWELS: Vowel[] = ["a", "e", "i", "o", "u", "aw", "uh"];

/** Conversation: phrases of short syllables with pauses, the way a seated crowd murmurs. */
function chatter(r: () => number, len: number, excited: boolean): VoiceSpec {
  const p = person(r);
  const syl: Syllable[] = [];
  let t = r() * 1.5 - 0.5;
  while (t < len) {
    const n = 3 + Math.floor(r() * (excited ? 6 : 10));
    const base = p.f0 * (excited ? 1.15 + r() * 0.25 : 0.95 + r() * 0.15);
    for (let i = 0; i < n && t < len; i++) {
      const dur = excited ? 0.14 + r() * 0.3 : 0.09 + r() * 0.18;
      const f0 = base * (0.92 + r() * 0.18);
      // the occasional shout ("hey!", "let's go!") when the place is up
      const shout = excited && r() < 0.12;
      syl.push({
        t,
        dur: shout ? dur * 2.2 : dur,
        vowel: shout ? (r() < 0.5 ? "e" : "o") : VOWELS[Math.floor(r() * VOWELS.length)],
        f0: shout ? f0 * 1.25 : f0,
        f1: shout ? f0 * 1.05 : f0 * (0.9 + r() * 0.15),
        gain: (excited ? 0.5 : 0.35) * (0.6 + r() * 0.4) * (shout ? 1.5 : 1),
      });
      t += (shout ? dur * 2.2 : dur) + r() * 0.05;
    }
    t += excited ? 0.15 + r() * 0.6 : 0.35 + r() * 1.8;
  }
  return { pan: r() * 1.8 - 0.9, tract: p.tract, syllables: syl };
}

/** A sustained crowd vowel: everyone reacting together (roar, ooh, aww, boo). */
function swell(
  r: () => number,
  o: { at: number; spread: number; dur: number; vowels: Vowel[]; rise: number; fall: number; pitch: number; gain: number; attack: number },
): VoiceSpec {
  const p = person(r);
  const t = o.at + r() * o.spread;
  const dur = o.dur * (0.75 + r() * 0.5);
  const f = p.f0 * o.pitch * (0.92 + r() * 0.16);
  const vowel = o.vowels[Math.floor(r() * o.vowels.length)];
  const syl: Syllable[] = [
    { t, dur: dur * 0.35, vowel, f0: f, f1: f * o.rise, gain: o.gain * (0.6 + r() * 0.4), attack: o.attack, release: 0.001 },
    { t: t + dur * 0.35, dur: dur * 0.65, vowel, f0: f * o.rise, f1: f * o.fall, gain: o.gain * (0.6 + r() * 0.4), attack: 0.001, release: dur * 0.5 },
  ];
  return { pan: r() * 1.8 - 0.9, tract: p.tract, syllables: syl };
}

async function render(len: number, build: (ctx: OfflineAudioContext, out: AudioNode) => void) {
  const ctx = offline(len);
  if (!ctx) return null;
  // the crowd is across the arena: soften the top end
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 3600;
  const master = ctx.createGain();
  master.gain.value = 0.18;
  master.connect(lp).connect(ctx.destination);
  build(ctx, master);
  return ctx.startRendering();
}

/** Crossfade the tail onto the head so the buffer loops without a seam. */
function makeLoop(buf: AudioBuffer, fade: number) {
  const n = Math.floor(fade * buf.sampleRate);
  const len = buf.length - n;
  const ctx = offline(len / buf.sampleRate);
  const out = ctx ? ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate) : buf;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c),
      dst = out.getChannelData(c);
    for (let i = 0; i < len; i++) dst[i] = src[i];
    for (let i = 0; i < n; i++) {
      const k = i / n;
      dst[i] = src[i] * Math.sqrt(k) + src[len + i] * Math.sqrt(1 - k);
    }
  }
  return out;
}

/** Applause: a hundred-odd people clapping at their own pace, each clap a tiny resonant burst. */
function applause(seed: number, dur: number, people: number, ctxFor: () => OfflineAudioContext | null) {
  const ctx = ctxFor();
  if (!ctx) return null;
  const r = rng(seed);
  const buf = ctx.createBuffer(2, Math.ceil(dur * SR), SR);
  const L = buf.getChannelData(0),
    R = buf.getChannelData(1);
  for (let p = 0; p < people; p++) {
    const rate = 3.2 + r() * 2.6;
    const start = r() * 0.25;
    const stop = dur * (0.45 + r() * 0.5);
    const pan = r();
    const hz = 900 + r() * 1700;
    const loud = 0.25 + r() * 0.75;
    // two-pole resonator coefficients
    const w = (2 * Math.PI * hz) / SR,
      rad = 0.93;
    const a1 = 2 * rad * Math.cos(w),
      a2 = -rad * rad;
    for (let t = start; t < stop; t += (1 / rate) * (0.85 + r() * 0.3)) {
      // claps fade out as the applause dies
      const g = loud * Math.min(1, (stop - t) / 0.6) * 0.09;
      const i0 = Math.floor(t * SR);
      let y1 = 0,
        y2 = 0;
      for (let i = 0; i < 420 && i0 + i < L.length; i++) {
        const x = i < 90 ? (r() * 2 - 1) * (1 - i / 90) : 0;
        const y = x + a1 * y1 + a2 * y2;
        y2 = y1;
        y1 = y;
        L[i0 + i] += y * g * (1 - pan) * 0.5;
        R[i0 + i] += y * g * pan * 0.5;
      }
    }
  }
  return buf;
}

export async function renderCrowdBank(): Promise<CrowdBank | null> {
  const BED = 12;
  const bed = async (seed: number, excited: boolean) => {
    const r = rng(seed);
    const b = await render(BED + 1, (ctx, out) => {
      for (let i = 0; i < (excited ? 64 : 44); i++) addVoice(ctx, out, chatter(r, BED + 1, excited));
    });
    return b && makeLoop(b, 1);
  };
  const reaction = (seed: number, len: number, voices: number, o: Parameters<typeof swell>[1]) => {
    const r = rng(seed);
    return render(len, (ctx, out) => {
      for (let i = 0; i < voices; i++) addVoice(ctx, out, swell(r, o));
    });
  };
  const roar = (seed: number) => {
    const r = rng(seed);
    return render(4, (ctx, out) => {
      for (let i = 0; i < 70; i++)
        addVoice(
          ctx,
          out,
          swell(r, { at: 0, spread: 0.35, dur: 2.2, vowels: ["a", "e", "o", "aw"], rise: 1.3, fall: 1.05, pitch: 1.2, gain: 0.55, attack: 0.08 }),
        );
      // "woo!"s
      for (let i = 0; i < 8; i++)
        addVoice(ctx, out, swell(r, { at: 0.2, spread: 1.0, dur: 0.9, vowels: ["u"], rise: 1.6, fall: 0.9, pitch: 1.5, gain: 0.6, attack: 0.05 }));
      // whistles
      for (let i = 0; i < 5; i++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const t = 0.15 + r() * 1.2,
          f = 2200 + r() * 1100;
        o.frequency.setValueAtTime(f, t);
        o.frequency.linearRampToValueAtTime(f * (1.05 + r() * 0.15), t + 0.25);
        o.frequency.linearRampToValueAtTime(f * 0.95, t + 0.7);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05, t + 0.04);
        g.gain.linearRampToValueAtTime(0, t + 0.7);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.75);
      }
    });
  };
  const chant = () => {
    const r = rng(77);
    return render(1.7, (ctx, out) => {
      for (let i = 0; i < 36; i++) {
        const p = person(r);
        const f = 118 + r() * 30 + (p.tract > 1 ? 80 : 0);
        const on = r() * 0.04;
        addVoice(ctx, out, {
          pan: r() * 1.6 - 0.8,
          tract: p.tract,
          syllables: [
            { t: on, dur: 0.26, vowel: "e", f0: f * 1.12, f1: f * 1.1, gain: 0.55, attack: 0.012 },
            { t: 0.42 + on, dur: 0.42, vowel: "e", f0: f, f1: f * 0.97, gain: 0.55, attack: 0.012, release: 0.12 },
          ],
        });
      }
      // the "s" of fence, then stomp-stomp-clap
      const noise = ctx.createBuffer(1, SR, SR);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
      const burst = (t: number, dur: number, type: BiquadFilterType, hz: number, gain: number) => {
        const s = ctx.createBufferSource();
        s.buffer = noise;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = hz;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        s.connect(f).connect(g).connect(out);
        s.start(t, r() * 0.5);
        s.stop(t + dur + 0.02);
      };
      burst(0.78, 0.16, "highpass", 4500, 0.35);
      burst(1.05, 0.18, "lowpass", 160, 3.2);
      burst(1.25, 0.18, "lowpass", 160, 3.2);
      burst(1.45, 0.09, "bandpass", 1500, 1.6);
    });
  };
  const [bedCalm, bedLoud, roar1, roar2, ooh, aww, boo, chantBuf] = await Promise.all([
    bed(11, false),
    bed(12, true),
    roar(21),
    roar(22),
    reaction(31, 2.2, 56, { at: 0, spread: 0.2, dur: 1.3, vowels: ["u", "o"], rise: 1.35, fall: 0.85, pitch: 1.1, gain: 0.5, attack: 0.12 }),
    reaction(41, 2.4, 56, { at: 0, spread: 0.25, dur: 1.5, vowels: ["a", "aw"], rise: 1.05, fall: 0.72, pitch: 1.05, gain: 0.45, attack: 0.1 }),
    reaction(51, 2.8, 52, { at: 0, spread: 0.3, dur: 2.2, vowels: ["u"], rise: 1.0, fall: 0.94, pitch: 0.85, gain: 0.45, attack: 0.15 }),
    chant(),
  ]);
  const clapCtx = () => offline(0.1);
  const ap1 = applause(61, 3.6, 130, clapCtx),
    ap2 = applause(62, 2.4, 70, clapCtx);
  if (!bedCalm || !bedLoud || !roar1 || !roar2 || !ooh || !aww || !boo || !chantBuf || !ap1 || !ap2) return null;
  return { bedCalm, bedLoud, roar: [roar1, roar2], applause: [ap1, ap2], ooh, aww, boo, chant: chantBuf };
}

/** Arena reverb: decaying stereo noise; bigger buildings ring longer. */
export function impulse(ctx: BaseAudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const r = rng(99);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return buf;
}
