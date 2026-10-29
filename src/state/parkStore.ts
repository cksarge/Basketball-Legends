"use client";
// Play in the Park: the setup you last used (local storage) and a next-game-up line in progress (this tab only).
import { create } from "zustand";
import type { Player } from "@/engine/types";
import type { LineState } from "@/game/park/line";
import type { ParkSession } from "./matchStore";

export type ParkMode = ParkSession["mode"];

export interface ParkSetup {
  parkId: string;
  mode: ParkMode;
  teamSize: number;
  halfCourt: boolean;
  scoring: "ones" | "twos";
  target: number;
  winBy2: boolean;
  makeItTakeIt: boolean;
  /** Next game up: crews waiting besides yours. */
  crews: number;
  /** 21: players including you. */
  players21: number;
  horseOpponents: number;
  word: "HORSE" | "PIG";
  rivals: number;
  /** Your player (a regular or any league player); null picks the park's best available regular. */
  you: Player | null;
}

export const DEFAULT_SETUP: ParkSetup = {
  parkId: "copper-flats",
  mode: "pickup",
  teamSize: 3,
  halfCourt: true,
  scoring: "ones",
  target: 15,
  winBy2: true,
  makeItTakeIt: false,
  crews: 3,
  players21: 4,
  horseOpponents: 2,
  word: "HORSE",
  rivals: 3,
  you: null,
};

/** A line in progress: the crews' players and the state of the court. */
export interface LineSession {
  parkId: string;
  rules: NonNullable<ParkSession["rules"]>;
  line: LineState;
  players: Record<string, Player>;
  /** Result of the game you just played has been recorded. */
  recorded: number;
}

const SETUP_KEY = "bl-park-setup";
const LINE_KEY = "bl-park-line";

function read<T>(storage: () => Storage, key: string): T | null {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(storage: () => Storage, key: string, v: unknown) {
  try {
    if (v === null) storage().removeItem(key);
    else storage().setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable: the setup just isn't remembered */
  }
}

interface ParkStore {
  setup: ParkSetup;
  line: LineSession | null;
  loaded: boolean;
  load: () => void;
  set: (p: Partial<ParkSetup>) => void;
  setLine: (l: LineSession | null) => void;
}

export const useParkStore = create<ParkStore>((set, get) => ({
  setup: DEFAULT_SETUP,
  line: null,
  loaded: false,
  load: () => {
    if (get().loaded) return;
    set({
      setup: { ...DEFAULT_SETUP, ...(read<Partial<ParkSetup>>(() => localStorage, SETUP_KEY) ?? {}) },
      line: read<LineSession>(() => sessionStorage, LINE_KEY),
      loaded: true,
    });
  },
  set: (p) => {
    const setup = { ...get().setup, ...p };
    write(() => localStorage, SETUP_KEY, setup);
    set({ setup });
  },
  setLine: (line) => {
    write(() => sessionStorage, LINE_KEY, line);
    set({ line });
  },
}));
