// What players are worth on the open market.
import { playerOvr } from "@/engine/player";
import { clamp } from "@/engine/rng";
import type { Player } from "@/engine/types";
import type { Franchise } from "../types";
import { START_CAP, capRules, roundMoney } from "./rules";

const ageDiscount = (age: number) => (age >= 36 ? 0.45 : age >= 33 ? 0.7 : age >= 30 ? 0.9 : 1);

export function marketValue(f: Franchise, p: Player): number {
  const rules = capRules(f.cap);
  const base = 1.1e6 + (Math.max(0, playerOvr(p) - 60) / 35) ** 2.4 * 52e6;
  const value = (base * ageDiscount(p.age) * rules.salaryCap) / START_CAP;
  return roundMoney(clamp(value, rules.minSalary, rules.maxSalary(p.file?.service ?? 0)));
}
