// Every pro cap number, as a share of the salary cap, so the whole system scales as the cap rises.
import { Rng } from "@/engine/rng";
import type { CapState } from "../types";

export const START_CAP = 140_000_000;

export const ROSTER_MAX = 15;
export const ROSTER_MIN = 13;
/** Teams carry extras through the summer, and must be down to the limit by the opener. */
export const OFFSEASON_ROSTER_MAX = 20;
export const TWO_WAY_MAX = 3;
export const TWO_WAY_GAMES = 50;
export const DEV_MAX = 3;

const SHARE = {
  taxLine: 170 / 140,
  firstApron: 178 / 140,
  secondApron: 189 / 140,
  minSalary: 1.2 / 140,
  midLevel: 0.092,
  taxMidLevel: 0.037,
  roomMidLevel: 0.056,
  biannual: 0.034,
  twoWaySalary: 0.0043,
  devSalary: 0.0003,
  tradeCushion: 0.0018,
};
/** Share of the cap a player can earn, by years of service. */
const MAX_SHARE: { service: number; share: number }[] = [
  { service: 10, share: 0.35 },
  { service: 7, share: 0.3 },
  { service: 0, share: 0.25 },
];
const CAP_RISE = [0.03, 0.06] as const;

export type CapRules = { salaryCap: number; maxSalary: (service: number) => number } & Record<keyof typeof SHARE, number>;

export const roundMoney = (n: number) => Math.round(n / 10_000) * 10_000;

export function capRules(cap: CapState): CapRules {
  const scaled = Object.fromEntries(Object.entries(SHARE).map(([k, share]) => [k, roundMoney(cap.salaryCap * share)])) as Record<keyof typeof SHARE, number>;
  return {
    ...scaled,
    salaryCap: cap.salaryCap,
    maxSalary: (service) => roundMoney(cap.salaryCap * MAX_SHARE.find((m) => service >= m.service)!.share),
  };
}

/** Next year's cap. M8 ties this to league revenue. */
export function nextCap(cap: CapState, seed: string): CapState {
  const rise = new Rng(`${seed}:cap:${cap.year + 1}`).range(...CAP_RISE);
  return { year: cap.year + 1, salaryCap: roundMoney(cap.salaryCap * (1 + rise)) };
}
