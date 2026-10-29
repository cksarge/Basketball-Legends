// Procedural game audio (Web Audio synthesis — no third-party sound assets).
import { type CrowdBank, impulse, renderCrowdBank } from "./crowd";

export type CrowdReaction = "roar" | "cheer" | "applause" | "ooh" | "aww" | "boo";

export interface Mix {
  master: number;
  music: number;
  sfx: number;
  crowd: number;
  commentary: number;
}

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private crowdBus!: GainNode;
  private crowdNoise: AudioBufferSourceNode | null = null;
  private crowdFilter!: BiquadFilterNode;
  private crowdGain!: GainNode;
  private noiseBuf: AudioBuffer | null = null;
  private mix: Mix = { master: 0.8, music: 0.5, sfx: 0.9, crowd: 0.7, commentary: 0.9 };
  private lastSqueak = 0;
  private lastStep = 0;
  private reverb!: ConvolverNode;
  private reverbIn!: GainNode;
  private bank: CrowdBank | null = null;
  private bankLoading = false;
  private bed: { calm: AudioBufferSourceNode; loud: AudioBufferSourceNode; calmGain: GainNode; loudGain: GainNode } | null = null;
  private chantOn = false;
  private chantNext = 0;
  private chantTimer: ReturnType<typeof setInterval> | null = null;
  private chantVoices: { s: AudioBufferSourceNode; g: GainNode }[] = [];
  private lastReact = new Map<CrowdReaction, number>();

  /** Must be called from a user gesture (browsers block autoplay). */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      // a gentle limiter so a roar on top of a dunk never clips
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 8;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.25;
      this.master.connect(limiter).connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.crowdBus = this.ctx.createGain();
      this.crowdBus.connect(this.master);
      // one shared arena reverb: the crowd sits deep in it, court sounds get a touch
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = impulse(this.ctx, 2.4);
      this.reverbIn = this.ctx.createGain();
      this.reverbIn.connect(this.reverb).connect(this.master);
      const crowdWet = this.ctx.createGain();
      crowdWet.gain.value = 0.55;
      this.crowdBus.connect(crowdWet).connect(this.reverbIn);
      const sfxWet = this.ctx.createGain();
      sfxWet.gain.value = 0.16;
      this.sfx.connect(sfxWet).connect(this.reverbIn);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyMix();
      void this.loadCrowd();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** Renders the crowd voices in the background; until then the crowd is a soft hush. */
  private async loadCrowd() {
    if (this.bankLoading) return;
    this.bankLoading = true;
    try {
      this.bank = await renderCrowdBank();
    } catch {
      this.bank = null;
    }
    if (this.bank && this.crowdNoise) this.startBed();
  }

  /** Room size: gyms are tight and boomy, arenas ring longer. */
  /** Outdoors: no officials or buzzers, and a handful of onlookers instead of a crowd. */
  private outdoor = false;

  setVenue(kind: "gym" | "college" | "pro" | "park") {
    this.outdoor = kind === "park";
    if (!this.ctx) return;
    // outdoors there's almost no room sound
    this.reverb.buffer = impulse(this.ctx, kind === "park" ? 0.35 : kind === "gym" ? 1.5 : kind === "college" ? 2.1 : 2.7);
  }

  setMix(m: Partial<Mix>) {
    this.mix = { ...this.mix, ...m };
    this.applyMix();
  }

  private applyMix() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.mix.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.mix.sfx, t, 0.05);
    this.crowdBus.gain.setTargetAtTime(this.mix.crowd, t, 0.05);
  }

  suspend() {
    void this.ctx?.suspend();
  }
  resume() {
    void this.ctx?.resume();
  }

  private env(g: GainNode, attack: number, decay: number, peak: number) {
    const t = this.ctx!.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private noise(filterType: BiquadFilterType, freq: number, q: number, attack: number, decay: number, peak: number, pan = 0) {
    if (!this.ctx || !this.noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.sfx);
    this.env(g, attack, decay, peak);
    src.start(this.ctx.currentTime, Math.random());
    src.stop(this.ctx.currentTime + attack + decay + 0.05);
  }

  private tone(type: OscillatorType, freq: number, attack: number, decay: number, peak: number, glideTo?: number, pan = 0) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, this.ctx.currentTime + attack + decay);
    const g = this.ctx.createGain();
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.sfx);
    this.env(g, attack, decay, peak);
    o.start();
    o.stop(this.ctx.currentTime + attack + decay + 0.05);
  }

  dribble(pan = 0, loud = 1) {
    this.tone("sine", 120 + Math.random() * 20, 0.002, 0.09, 0.5 * loud, 70, pan);
    this.noise("lowpass", 900, 0.7, 0.001, 0.05, 0.25 * loud, pan);
  }
  /** Sneaker squeak on a hard plant or cut; `hard` 0..1. */
  squeak(pan = 0, hard = 0.6) {
    if (!this.ctx || this.ctx.currentTime - this.lastSqueak < 0.12) return;
    this.lastSqueak = this.ctx.currentTime;
    const f = 1500 + Math.random() * 1500;
    const len = 0.06 + Math.random() * 0.09;
    const g = 0.035 + hard * 0.05;
    this.tone("sine", f, 0.006, len, g, f * (1.15 + Math.random() * 0.35), pan);
    this.tone("triangle", f * 2.01, 0.006, len * 0.8, g * 0.35, f * 2.3, pan);
  }
  /** A footfall on hardwood; `speed` in m/s. Very soft unless running. */
  footstep(pan = 0, speed = 3) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // ten players: thin out overlapping steps instead of stacking them
    if (now - this.lastStep < 0.035) return;
    this.lastStep = now;
    const k = Math.min(1, speed / 8);
    this.noise("lowpass", 240 + k * 260, 0.9, 0.002, 0.05 + k * 0.03, 0.05 + k * 0.1, pan);
    this.noise("bandpass", 2400, 1.4, 0.001, 0.02, 0.012 + k * 0.02, pan);
  }
  swish() {
    this.noise("bandpass", 3200, 0.6, 0.02, 0.35, 0.35);
  }
  netRustle() {
    this.noise("bandpass", 2400, 0.9, 0.01, 0.22, 0.2);
  }
  rim(speed: number, pan = 0) {
    const s = Math.min(1, speed / 6);
    for (const [f, a] of [
      [780, 0.22],
      [1270, 0.14],
      [1930, 0.1],
      [2650, 0.06],
    ] as const)
      this.tone("triangle", f * (0.97 + Math.random() * 0.06), 0.001, 0.35 + s * 0.4, a * (0.4 + s), undefined, pan);
    this.noise("highpass", 2000, 0.5, 0.001, 0.05, 0.2 * s, pan);
  }
  board(speed: number, pan = 0) {
    const s = Math.min(1, speed / 6);
    this.tone("sine", 170, 0.002, 0.18, 0.35 * (0.4 + s), 110, pan);
    this.noise("bandpass", 600, 1.2, 0.001, 0.12, 0.25 * s, pan);
  }
  catchBall(pan = 0) {
    this.noise("lowpass", 1400, 0.8, 0.001, 0.06, 0.18, pan);
  }
  whistle() {
    if (this.outdoor) return;
    this.tone("sine", 2900, 0.02, 0.45, 0.2, 3000);
    this.tone("sine", 3150, 0.02, 0.45, 0.12, 3200);
  }
  buzzer() {
    if (this.outdoor) return;
    this.tone("square", 196, 0.01, 1.3, 0.18);
    this.tone("sawtooth", 98, 0.01, 1.3, 0.08);
  }
  shotClockBeep() {
    this.tone("square", 880, 0.005, 0.12, 0.08);
  }
  uiMove() {
    this.tone("sine", 660, 0.002, 0.05, 0.05);
  }
  uiSelect() {
    this.tone("sine", 880, 0.002, 0.08, 0.08, 1320);
  }
  uiBack() {
    this.tone("sine", 520, 0.002, 0.08, 0.06, 360);
  }
  meterGreen() {
    this.tone("sine", 1320, 0.005, 0.18, 0.12, 1760);
  }

  // ---- crowd
  startCrowd() {
    if (!this.ctx || !this.noiseBuf || this.crowdNoise || this.outdoor) return;
    // a low room tone under the voices (air handling, distant feet)
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.crowdFilter = this.ctx.createBiquadFilter();
    this.crowdFilter.type = "lowpass";
    this.crowdFilter.frequency.value = 380;
    this.crowdGain = this.ctx.createGain();
    this.crowdGain.gain.value = 0.02;
    src.connect(this.crowdFilter).connect(this.crowdGain).connect(this.crowdBus);
    src.start();
    this.crowdNoise = src;
    if (this.bank) this.startBed();
  }

  private startBed() {
    if (!this.ctx || !this.bank || this.bed) return;
    const loop = (buf: AudioBuffer, gain: number) => {
      const s = this.ctx!.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      const g = this.ctx!.createGain();
      g.gain.value = gain;
      s.connect(g).connect(this.crowdBus);
      s.start(0, Math.random() * buf.duration);
      return { s, g };
    };
    const calm = loop(this.bank.bedCalm, 1.3),
      loud = loop(this.bank.bedLoud, 0);
    this.bed = { calm: calm.s, loud: loud.s, calmGain: calm.g, loudGain: loud.g };
  }

  stopCrowd() {
    this.crowdNoise?.stop();
    this.crowdNoise = null;
    if (this.bed) {
      this.bed.calm.stop();
      this.bed.loud.stop();
      this.bed = null;
    }
    this.chant(false);
  }

  /** 0 quiet .. 1 roaring: the murmur swells into a standing crowd. */
  crowdLevel(level: number) {
    if (!this.ctx || !this.crowdNoise) return;
    const t = this.ctx.currentTime;
    const l = Math.max(0, Math.min(1, level));
    this.crowdGain.gain.setTargetAtTime(0.012 + l * 0.03, t, 0.5);
    if (this.bed) {
      this.bed.calmGain.gain.setTargetAtTime(1.1 + l * 0.8, t, 0.5);
      this.bed.loudGain.gain.setTargetAtTime(Math.pow(Math.max(0, l - 0.3) / 0.7, 1.4) * 2.0, t, 0.5);
    } else this.crowdGain.gain.setTargetAtTime(0.02 + l * 0.08, t, 0.5);
  }

  /** The crowd reacts: `amount` 0..1 scales how many people join in. */
  react(kind: CrowdReaction, amount = 0.7) {
    if (!this.ctx) return;
    // the few people watching at the park only react to the big moments
    if (this.outdoor) {
      if (amount < 0.7 || kind === "boo" || kind === "applause") return;
      amount *= 0.3;
    }
    const now = this.ctx.currentTime;
    // the same reaction twice in a row just swells the first one
    if (now - (this.lastReact.get(kind) ?? -9) < 0.35) return;
    this.lastReact.set(kind, now);
    const b = this.bank;
    if (!b) {
      // before the voices are ready: the old noise swells
      if (kind === "aww" || kind === "boo") this.noise("lowpass", 500, 0.5, 0.1, 1.0, 0.12 * amount);
      else this.noise("bandpass", 1100, 0.3, 0.15, 1.2 + amount, 0.15 + amount * 0.3);
      return;
    }
    const pick = (a: AudioBuffer[]) => a[Math.floor(Math.random() * a.length)];
    const play = (buf: AudioBuffer, gain: number, delay = 0) => {
      const s = this.ctx!.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = 0.94 + Math.random() * 0.12;
      const g = this.ctx!.createGain();
      g.gain.value = gain;
      s.connect(g).connect(this.crowdBus);
      s.start(now + delay);
    };
    const a = Math.max(0.05, Math.min(1, amount));
    switch (kind) {
      case "roar":
        play(pick(b.roar), 0.9 + a * 1.4);
        play(b.applause[0], 0.5 + a * 0.8, 0.25);
        break;
      case "cheer":
        play(pick(b.roar), 0.45 + a * 0.8);
        play(pick(b.applause), 0.5 + a * 0.6, 0.15);
        break;
      case "applause":
        play(pick(b.applause), 0.4 + a * 0.9);
        break;
      case "ooh":
        play(b.ooh, 0.7 + a * 1.3);
        break;
      case "aww":
        play(b.aww, 0.6 + a * 1.2);
        break;
      case "boo":
        play(b.boo, 0.6 + a * 1.1);
        break;
    }
  }

  /** "DE-FENSE!": repeats every cycle while on. */
  chant(on: boolean) {
    if (on === this.chantOn) return;
    this.chantOn = on;
    if (this.chantTimer) clearInterval(this.chantTimer);
    this.chantTimer = null;
    if (!on && this.ctx) {
      // cycles already queued fade out instead of chanting on after the stop
      const t = this.ctx.currentTime;
      for (const v of this.chantVoices) {
        v.g.gain.setTargetAtTime(0, t, 0.15);
        try {
          v.s.stop(t + 0.8);
        } catch {
          // already stopped
        }
      }
      this.chantVoices = [];
    }
    if (!on || !this.ctx) return;
    this.chantNext = this.ctx.currentTime + 0.4;
    const tick = () => {
      const b = this.bank;
      if (!this.ctx || !b || !this.chantOn) return;
      // keep two cycles scheduled ahead
      while (this.chantNext < this.ctx.currentTime + 2.5) {
        const s = this.ctx.createBufferSource();
        s.buffer = b.chant;
        const g = this.ctx.createGain();
        g.gain.value = 1.5;
        s.connect(g).connect(this.crowdBus);
        s.start(this.chantNext);
        this.chantVoices.push({ s, g });
        if (this.chantVoices.length > 4) this.chantVoices.shift();
        this.chantNext += b.chant.duration - 0.02;
      }
    };
    tick();
    this.chantTimer = setInterval(tick, 500);
  }

  /** Back-compat helpers used by menus and older callers. */
  cheer(level: number) {
    this.react(level > 0.8 ? "roar" : "cheer", level);
  }
  groan() {
    this.react("aww", 0.5);
  }
}

export const audio = new AudioEngine();
