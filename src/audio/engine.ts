// Procedural game audio (Web Audio synthesis — no third-party sound assets).
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

  /** Must be called from a user gesture (browsers block autoplay). */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.crowdBus = this.ctx.createGain();
      this.crowdBus.connect(this.master);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyMix();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
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
  squeak(pan = 0) {
    if (!this.ctx || this.ctx.currentTime - this.lastSqueak < 0.25) return;
    this.lastSqueak = this.ctx.currentTime;
    const f = 1800 + Math.random() * 1600;
    this.tone("sine", f, 0.01, 0.09 + Math.random() * 0.08, 0.06, f * (1.2 + Math.random() * 0.3), pan);
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
    this.tone("sine", 2900, 0.02, 0.45, 0.2, 3000);
    this.tone("sine", 3150, 0.02, 0.45, 0.12, 3200);
  }
  buzzer() {
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

  // ---- crowd bed
  startCrowd() {
    if (!this.ctx || !this.noiseBuf || this.crowdNoise) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.crowdFilter = this.ctx.createBiquadFilter();
    this.crowdFilter.type = "bandpass";
    this.crowdFilter.frequency.value = 700;
    this.crowdFilter.Q.value = 0.4;
    this.crowdGain = this.ctx.createGain();
    this.crowdGain.gain.value = 0.05;
    src.connect(this.crowdFilter).connect(this.crowdGain).connect(this.crowdBus);
    src.start();
    this.crowdNoise = src;
  }
  stopCrowd() {
    this.crowdNoise?.stop();
    this.crowdNoise = null;
  }
  /** 0 quiet .. 1 roaring. */
  crowdLevel(level: number) {
    if (!this.ctx || !this.crowdNoise) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(0.03 + level * 0.22, t, 0.4);
    this.crowdFilter.frequency.setTargetAtTime(600 + level * 900, t, 0.4);
  }
  cheer(level: number) {
    if (!this.ctx) return;
    this.noise("bandpass", 1100, 0.3, 0.15, 1.6 + level, 0.25 + level * 0.35);
  }
  groan() {
    this.noise("lowpass", 500, 0.5, 0.1, 1.0, 0.18);
  }
}

export const audio = new AudioEngine();
