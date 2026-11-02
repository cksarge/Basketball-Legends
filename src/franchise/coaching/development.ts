// Weekly practice for the user's team. League-wide growth comes with the offseason.
import { addDays } from "@/career/calendar";
import { TRAINING } from "@/career/pro/season";
import { playerOvr } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { Player, RatingKey } from "@/engine/types";
import { budgetEffect } from "../club/finance";
import type { Franchise, PlayerPlan, PracticeFocus } from "../types";
import { staffRating } from "./staff";

const WEEK = 7;
const POSITION_WEEKS = 12;
/** Chance per week that a focused rating goes up, before age, effort and coaching. */
const BASE_GAIN = 0.05;
const BALANCED_SHARE = 0.35;
const MAX_RATING = 99;

const keysOf = (id: string): RatingKey[] => TRAINING.find((t) => t.id === id)?.keys ?? [];
const CONDITIONING: RatingKey[] = ["stamina", "speed", "accel"];
const ALL_FOCUSES = TRAINING.flatMap((t) => t.keys);

function teamKeys(practice: PracticeFocus): { keys: RatingKey[]; share: number } {
  if (practice === "balanced") return { keys: ALL_FOCUSES, share: BALANCED_SHARE };
  return { keys: practice === "conditioning" ? CONDITIONING : keysOf(practice), share: 1 };
}

const youth = (age: number) => (age <= 22 ? 1 : age <= 25 ? 0.7 : age <= 28 ? 0.4 : age <= 31 ? 0.15 : 0.05);

function practiced(p: Player, chance: number, keys: RatingKey[], rng: Rng): Player {
  const ratings = { ...p.ratings };
  let next = p;
  for (const k of keys) {
    if (!rng.chance(chance) || ratings[k] >= MAX_RATING) continue;
    ratings[k]++;
    const grown = { ...p, ratings: { ...ratings } };
    // nobody grows past what they have in them
    if (playerOvr(grown) > p.potential) {
      ratings[k]--;
      continue;
    }
    next = grown;
  }
  return next;
}

function learnPosition(p: Player, plan: PlayerPlan): { player: Player; plan: PlayerPlan } {
  if (!plan.newPos) return { player: p, plan };
  const posWeeks = (plan.posWeeks ?? 0) + 1;
  if (posWeeks < POSITION_WEEKS) return { player: p, plan: { ...plan, posWeeks } };
  return { player: { ...p, secondaryPos: plan.newPos }, plan: { focus: plan.focus } };
}

export function weeklyDevelopment(f: Franchise): { franchise: Franchise; changedPlayers: string[] } {
  const date = addDays(f.devDate, WEEK);
  if (f.date < date) return { franchise: f, changedPlayers: [] };
  const coach = (staffRating(f, "development") / 70) * budgetEffect(f, "coaching");
  const team = teamKeys(f.plan.practice);
  const players = { ...f.players };
  const playerPlans = { ...f.plan.playerPlans };
  const changed: string[] = [];
  for (const id of f.rosters[f.teamId]) {
    const start = players[id];
    const rng = new Rng(`${f.seed}:dev:${date}:${id}`);
    const chance = BASE_GAIN * youth(start.age) * (0.6 + start.traits.workEthic * 0.8) * coach;
    let p = practiced(start, chance * team.share, team.keys, rng);
    const own = playerPlans[id];
    if (own) {
      p = practiced(p, chance * 2, keysOf(own.focus), rng);
      const learned = learnPosition(p, own);
      p = learned.player;
      playerPlans[id] = learned.plan;
    }
    if (p !== start) {
      players[id] = p;
      changed.push(id);
    }
  }
  return { franchise: { ...f, devDate: date, players, plan: { ...f.plan, playerPlans } }, changedPlayers: changed };
}
