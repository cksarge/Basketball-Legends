"use client";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_SLIDERS, type Difficulty, type GameplaySliders } from "@/game/sim/state";

export type GraphicsPreset = "low" | "medium" | "high" | "ultra";
export type CameraMode = "broadcast" | "2k" | "low" | "baseline" | "player" | "skycam";
export type PromptStyle = "auto" | "keyboard" | "xbox" | "playstation";
export type ColorblindMode = "off" | "protanopia" | "deuteranopia" | "tritanopia";

export type ActionName =
  | "up"
  | "down"
  | "left"
  | "right"
  | "sprint"
  | "shoot"
  | "pass"
  | "lob"
  | "bounce"
  | "iconPass"
  | "dribbleLeft"
  | "dribbleRight"
  | "dribbleBack"
  | "dribbleSpin"
  | "pumpFake"
  | "post"
  | "callScreen"
  | "steal"
  | "block"
  | "switchPlayer"
  | "intenseD"
  | "takeCharge"
  | "timeout"
  | "pause"
  | "camera"
  | "replay"
  | "callForBall";

export const ACTION_LABELS: Record<ActionName, string> = {
  up: "Move up",
  down: "Move down",
  left: "Move left",
  right: "Move right",
  sprint: "Sprint",
  shoot: "Shoot (hold, release)",
  pass: "Pass",
  lob: "Lob / alley-oop",
  bounce: "Bounce pass",
  iconPass: "Icon pass (hold + number)",
  dribbleLeft: "Crossover left",
  dribbleRight: "Crossover right",
  dribbleBack: "Stepback / hesitation",
  dribbleSpin: "Spin move",
  pumpFake: "Pump fake",
  post: "Post up",
  callScreen: "Call pick and roll",
  steal: "Steal",
  block: "Block / rebound",
  switchPlayer: "Switch player",
  intenseD: "Intense defense",
  takeCharge: "Take charge",
  timeout: "Call timeout",
  pause: "Pause",
  camera: "Change camera",
  replay: "Instant replay",
  callForBall: "Call for the ball",
};

export const DEFAULT_KEYS: Record<ActionName, string[]> = {
  up: ["KeyW"],
  down: ["KeyS"],
  left: ["KeyA"],
  right: ["KeyD"],
  sprint: ["ShiftLeft", "ShiftRight"],
  shoot: ["Space", "KeyJ"],
  pass: ["KeyK"],
  lob: ["KeyL"],
  bounce: ["KeyO"],
  iconPass: ["Tab"],
  dribbleLeft: ["ArrowLeft"],
  dribbleRight: ["ArrowRight"],
  dribbleBack: ["ArrowDown"],
  dribbleSpin: ["ArrowUp"],
  pumpFake: ["KeyU"],
  post: ["KeyC"],
  callScreen: ["KeyV"],
  steal: ["KeyK"],
  block: ["Space", "KeyJ"],
  switchPlayer: ["KeyQ"],
  intenseD: ["KeyC"],
  takeCharge: ["KeyF"],
  timeout: ["KeyT"],
  pause: ["Escape", "KeyP"],
  camera: ["KeyY"],
  replay: ["KeyR"],
  callForBall: ["KeyK"],
};

/** Standard-mapping gamepad button indices. */
export const DEFAULT_PAD: Record<ActionName, number[]> = {
  up: [12],
  down: [13],
  left: [14],
  right: [15],
  sprint: [7],
  shoot: [2],
  pass: [0],
  lob: [3],
  bounce: [1],
  iconPass: [4],
  dribbleLeft: [],
  dribbleRight: [],
  dribbleBack: [],
  dribbleSpin: [],
  pumpFake: [11],
  post: [6],
  callScreen: [5],
  steal: [2],
  block: [3],
  switchPlayer: [0],
  intenseD: [6],
  takeCharge: [1],
  timeout: [8],
  pause: [9],
  camera: [8],
  replay: [10],
  callForBall: [0],
};

export interface Settings {
  graphics: {
    preset: GraphicsPreset;
    autoDetected: boolean;
    resolutionScale: number; // 0.5..1.5
    shadows: boolean;
    bloom: boolean;
    ambientOcclusion: boolean;
    antialias: boolean;
    crowdDensity: number; // 0..1
    fpsCap: 30 | 60 | 120 | 0;
    showFps: boolean;
  };
  audio: { master: number; music: number; sfx: number; crowd: number; commentary: number; voiceCommentary: boolean; muteOnBlur: boolean };
  gameplay: {
    difficulty: Difficulty;
    quarterMinutes: number;
    shotMeter: boolean;
    fatigue: boolean;
    injuries: boolean;
    fouls: boolean;
    autoSubs: boolean;
    boundaryAssist: boolean;
    showPlayerNames: boolean;
    showShotFeedback: boolean;
    vibration: boolean;
    lockToPlayer: boolean;
    /** Gameplay sliders (1 = default). */
    sliders: GameplaySliders;
  };
  camera: { mode: CameraMode; zoom: number; height: number; shake: boolean };
  controls: { keys: Record<ActionName, string[]>; pad: Record<ActionName, number[]>; prompts: PromptStyle; stickDeadzone: number; invertCamera: boolean };
  accessibility: { colorblind: ColorblindMode; subtitles: boolean; reducedMotion: boolean; uiScale: number; highContrastHud: boolean; holdToTap: boolean };
  presentation: {
    commentary: boolean;
    replays: boolean;
    playBanners: boolean;
    statOverlays: boolean;
    breakScreens: boolean;
    skipIntros: boolean;
    showTips: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  graphics: {
    preset: "high",
    autoDetected: false,
    resolutionScale: 1,
    shadows: true,
    bloom: true,
    ambientOcclusion: true,
    antialias: true,
    crowdDensity: 0.8,
    fpsCap: 60,
    showFps: false,
  },
  audio: { master: 0.8, music: 0.5, sfx: 0.9, crowd: 0.7, commentary: 0.9, voiceCommentary: false, muteOnBlur: true },
  gameplay: {
    difficulty: "allstar",
    quarterMinutes: 6,
    shotMeter: true,
    fatigue: true,
    injuries: false,
    fouls: true,
    autoSubs: true,
    boundaryAssist: true,
    showPlayerNames: true,
    showShotFeedback: true,
    vibration: true,
    lockToPlayer: false,
    sliders: DEFAULT_SLIDERS,
  },
  camera: { mode: "broadcast", zoom: 1, height: 1, shake: true },
  controls: { keys: DEFAULT_KEYS, pad: DEFAULT_PAD, prompts: "auto", stickDeadzone: 0.18, invertCamera: false },
  accessibility: { colorblind: "off", subtitles: true, reducedMotion: false, uiScale: 1, highContrastHud: false, holdToTap: false },
  presentation: { commentary: true, replays: true, playBanners: true, statOverlays: true, breakScreens: true, skipIntros: false, showTips: true },
};

export const PRESETS: Record<GraphicsPreset, Partial<Settings["graphics"]>> = {
  low: { resolutionScale: 0.7, shadows: false, bloom: false, ambientOcclusion: false, antialias: false, crowdDensity: 0.3 },
  medium: { resolutionScale: 0.85, shadows: true, bloom: false, ambientOcclusion: false, antialias: true, crowdDensity: 0.55 },
  high: { resolutionScale: 1, shadows: true, bloom: true, ambientOcclusion: true, antialias: true, crowdDensity: 0.8 },
  ultra: { resolutionScale: 1.25, shadows: true, bloom: true, ambientOcclusion: true, antialias: true, crowdDensity: 1 },
};

type Section = keyof Settings;

interface SettingsStore extends Settings {
  set: <S extends Section>(section: S, patch: Partial<Settings[S]>) => void;
  applyPreset: (p: GraphicsPreset) => void;
  resetSection: (section: Section) => void;
  resetAll: () => void;
}

const safeStorage = createJSONStorage(() => ({
  getItem: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  },
  removeItem: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* storage blocked */
    }
  },
}));

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (section, patch) => set((st) => ({ [section]: { ...st[section], ...patch } }) as Partial<SettingsStore>),
      applyPreset: (p) => set((st) => ({ graphics: { ...st.graphics, ...PRESETS[p], preset: p } })),
      resetSection: (section) => set(() => ({ [section]: DEFAULT_SETTINGS[section] }) as Partial<SettingsStore>),
      resetAll: () => set(() => ({ ...DEFAULT_SETTINGS })),
    }),
    {
      name: "bl-settings",
      version: 1,
      storage: safeStorage,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Settings>;
        const out = { ...current };
        for (const k of Object.keys(DEFAULT_SETTINGS) as Section[]) {
          (out as Record<string, unknown>)[k] = { ...DEFAULT_SETTINGS[k], ...(p[k] ?? {}) };
        }
        out.gameplay = { ...out.gameplay, sliders: { ...DEFAULT_SLIDERS, ...(p.gameplay?.sliders ?? {}) } };
        // nested maps must keep any new default actions
        out.controls = { ...out.controls, keys: { ...DEFAULT_KEYS, ...(p.controls?.keys ?? {}) }, pad: { ...DEFAULT_PAD, ...(p.controls?.pad ?? {}) } };
        return out;
      },
    },
  ),
);

/** Pick a preset from the device's capability (called once on first launch). */
export function detectPreset(): GraphicsPreset {
  if (typeof window === "undefined") return "high";
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  let gpu = "";
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).toLowerCase();
  } catch {
    /* ignore */
  }
  if (/rtx|radeon rx|apple m[2-9]|apple gpu/.test(gpu) && cores >= 8) return "ultra";
  if (/intel|uhd|iris|mali|adreno|swiftshader|llvmpipe/.test(gpu) || cores <= 4 || mem <= 4) return "medium";
  return "high";
}
