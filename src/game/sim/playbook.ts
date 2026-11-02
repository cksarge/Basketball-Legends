// Offensive systems and plays, as data. plays.ts and the AI read them; the box-score simulator reads the same systems.
import type { PlayId, SystemId } from "@/engine/types";
import type { V2 } from "../vec";

export type { PlayId, SystemId };
export type PlanKind = "drive" | "iso" | "pnr" | "post" | "hold";

export interface SystemDef {
  id: SystemId;
  label: string;
  hint: string;
  /** Multiplies how often a ball handler picks each plan. */
  plans: Partial<Record<PlanKind, number>>;
  threeBias: number;
  /** Multiplies how often off-ball players cut. */
  cutRate: number;
  /** How readily the handler gives up the ball for a better look. Negative means keep it. */
  passFirst: number;
  plays: PlayId[];
}

export interface PlayDef {
  id: PlayId;
  label: string;
  hint: string;
  focus: "star" | "shooter" | "big" | "handler";
  plan: "drive" | "iso" | "pnr" | "post";
  /** Where the focus player runs to: distance back from the rim, and across the floor. */
  route: { back: number; z: number } | null;
  seconds: number;
}

export const SYSTEMS: Record<SystemId, SystemDef> = {
  motion: {
    id: "motion",
    label: "Motion",
    hint: "Cuts, screens and the extra pass. Rewards smart passers.",
    plans: { iso: 0.5, hold: 1.2 },
    threeBias: 1,
    cutRate: 1.8,
    passFirst: 0.18,
    plays: ["backdoor", "floppy", "elbow", "horns"],
  },
  pickRoll: {
    id: "pickRoll",
    label: "Pick-and-roll",
    hint: "Your ball handler and a big, again and again.",
    plans: { pnr: 2.2, iso: 0.7 },
    threeBias: 1,
    cutRate: 1,
    passFirst: 0,
    plays: ["horns", "drag", "spainPnr"],
  },
  postUp: {
    id: "postUp",
    label: "Post-up",
    hint: "Play through your bigs on the block.",
    plans: { post: 2.5 },
    threeBias: 0.92,
    cutRate: 1.2,
    passFirst: 0.04,
    plays: ["postEntry", "elbow", "horns"],
  },
  paceSpace: {
    id: "paceSpace",
    label: "Pace and space",
    hint: "Early threes and driving lanes. Needs shooters.",
    plans: { drive: 0.7, hold: 1.1 },
    threeBias: 1.12,
    cutRate: 1,
    passFirst: -0.05,
    plays: ["floppy", "drag"],
  },
  isoStar: {
    id: "isoStar",
    label: "Iso-star",
    hint: "Clear out and let your best player work.",
    plans: { iso: 2.2, pnr: 0.5, drive: 0.8 },
    threeBias: 1,
    cutRate: 0.6,
    passFirst: -0.08,
    plays: ["clearout"],
  },
};

export const PLAYS: Record<PlayId, PlayDef> = {
  horns: { id: "horns", label: "Horns", hint: "Two bigs at the elbows screen for the guard.", focus: "handler", plan: "pnr", route: null, seconds: 9 },
  floppy: {
    id: "floppy",
    label: "Floppy",
    hint: "Your best shooter runs off screens to the wing.",
    focus: "shooter",
    plan: "iso",
    route: { back: 7, z: 5.5 },
    seconds: 8,
  },
  clearout: {
    id: "clearout",
    label: "Clear out",
    hint: "Everyone gets out of the way of your star.",
    focus: "star",
    plan: "iso",
    route: { back: 7.4, z: 0 },
    seconds: 16,
  },
  postEntry: {
    id: "postEntry",
    label: "Post entry",
    hint: "Feed your best big on the block.",
    focus: "big",
    plan: "post",
    route: { back: 2.4, z: 1.2 },
    seconds: 10,
  },
  backdoor: {
    id: "backdoor",
    label: "Backdoor",
    hint: "A wing fakes up and cuts to the rim.",
    focus: "shooter",
    plan: "drive",
    route: { back: 0.9, z: 0.8 },
    seconds: 6,
  },
  drag: { id: "drag", label: "Drag screen", hint: "An early screen in transition.", focus: "handler", plan: "pnr", route: null, seconds: 6 },
  spainPnr: {
    id: "spainPnr",
    label: "Spain pick-and-roll",
    hint: "A back screen on the roller's defender.",
    focus: "big",
    plan: "pnr",
    route: { back: 1.3, z: -0.6 },
    seconds: 9,
  },
  elbow: {
    id: "elbow",
    label: "Elbow set",
    hint: "Run the offense through a big at the elbow.",
    focus: "big",
    plan: "drive",
    route: { back: 4.8, z: 2 },
    seconds: 9,
  },
};

/** Where a play sends its focus player, at the end this team attacks. */
export function routeSpot(play: PlayDef, side: 1 | -1, rimX: number): V2 | null {
  return play.route ? { x: rimX - side * play.route.back, z: play.route.z } : null;
}
