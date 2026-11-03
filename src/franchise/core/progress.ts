// The whole league's summer: everyone turns a year older, the young grow, the old fade, and some retire.
import { overall, playerOvr } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { LeagueId, Player, RatingKey, Ratings } from "@/engine/types";
import { budgetEffect } from "../club/finance";
import { staffRating } from "../coaching/staff";
import { PROGRESSION_SPEED } from "../settings";
import type { Franchise, ProgressReport } from "../types";

const LEGS: RatingKey[] = ["speed", "accel", "vertical", "stamina"];
const LEGS_LOSS = 1.6;
const MIN_RATING = 25;
const MAX_RATING = 99;
const PEAK_AGE = 28;
/** Past this, a player has shown what he is. */
const LAST_GROWING_AGE = 27;
const LAST_AGE = 41;
const UNSIGNED_RETIRE = 2.5;
/** Room to potential at which a player grows at the full rate for his age. */
const FULL_ROOM = 6;

/** Average overall change for a player reaching this age. Teenagers in high school and college grow fastest. */
function ageChange(age: number, league: LeagueId) {
  if (league === "hs") return age <= 16 ? 4.5 : 3.8;
  if (league === "college" && age <= 23) return age <= 20 ? 3 : 2.4;
  if (age <= 21) return 1.9;
  if (age <= 24) return 1;
  if (age <= 27) return 0.3;
  if (age <= 29) return 0;
  if (age <= 31) return -0.7;
  if (age <= 33) return -1.5;
  return -2.5;
}

function shifted(r: Ratings, shift: number): Ratings {
  const next = { ...r };
  for (const k of Object.keys(r) as RatingKey[])
    next[k] = Math.round(clamp(r[k] + (shift < 0 && LEGS.includes(k) ? shift * LEGS_LOSS : shift), MIN_RATING, MAX_RATING));
  return next;
}

/** The ratings whose overall lands on the target, keeping the player's shape. */
function toOverall(p: Player, target: number): Ratings {
  let lo = -40,
    hi = 40,
    best = p.ratings;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const r = shifted(p.ratings, mid);
    if (Math.abs(overall(r, p.pos) - target) < Math.abs(overall(best, p.pos) - target)) best = r;
    if (overall(r, p.pos) < target) lo = mid;
    else hi = mid;
  }
  return best;
}

export function progressPlayer(p: Player, rng: Rng, bonus = 0, speed = 1, league: LeagueId = "pro"): Player {
  const age = p.age + 1;
  const start = playerOvr(p);
  const base = ageChange(age, league);
  const mean = base > 0 ? base * Math.min(2.6, Math.max(0, p.potential - start) / FULL_ROOM) : base;
  const effort = (p.traits.workEthic - 0.5) * 1.2 + (age <= LAST_GROWING_AGE ? bonus : bonus * 0.3);
  const change = (mean + effort + rng.normal(0, 2.2 - p.traits.consistency)) * speed;
  const ceiling = age <= PEAK_AGE ? Math.max(start, p.potential) : MAX_RATING;
  const target = Math.round(clamp(start + change, MIN_RATING, ceiling));
  const ratings = target === start ? p.ratings : toOverall(p, target);
  const ovr = overall(ratings, p.pos);
  const drift = p.potential + rng.normal(0, 0.8);
  return { ...p, age, ratings, potential: age >= PEAK_AGE ? ovr : Math.round(clamp(drift, ovr, MAX_RATING)) };
}

/** Good players last longer, and a player with a deal waiting is likelier to come back. */
export function retires(p: Player, rng: Rng, signed: boolean): boolean {
  if (p.age >= LAST_AGE) return true;
  if (p.age < 32) return false;
  const skill = clamp((88 - playerOvr(p)) / 14, 0.15, 1.5);
  return rng.chance((p.age - 31) * 0.04 * skill * (signed ? 1 : UNSIGNED_RETIRE));
}

/** Everyone in the league ages. Retired players stay readable until the new season, since this season's stats point at them. */
export function leagueProgress(f: Franchise): { franchise: Franchise; report: ProgressReport } {
  const year = f.season.year;
  const bonus = ((staffRating(f, "development") - 50) / 45) * budgetEffect(f, "coaching");
  const mine = new Set(f.rosters[f.teamId]);
  const players = { ...f.players };
  const gone = new Set<string>();
  const lastTeams: ProgressReport["lastTeams"] = {};
  const changes: ProgressReport["changes"] = [];
  for (const id of Object.keys(f.players).sort()) {
    const p = f.players[id];
    const rng = new Rng(`${f.seed}:progress:${year}:${id}`);
    const grown = progressPlayer(p, rng, mine.has(id) ? bonus : 0, PROGRESSION_SPEED[f.settings.league.progression]);
    const next = { ...grown, file: { ...grown.file!, peak: Math.max(grown.file?.peak ?? 0, playerOvr(p), playerOvr(grown)) } };
    // a deal that's in its last year ends this summer
    if (retires(next, rng, (p.contract?.years ?? 0) > 1)) {
      const out = { ...next, teamId: null, file: { ...next.file!, ...(p.teamId ? { lastTeamId: p.teamId } : {}) } };
      delete out.contract;
      players[id] = out;
      gone.add(id);
      lastTeams[id] = p.teamId;
      continue;
    }
    players[id] = next;
    if (mine.has(id)) changes.push({ id, before: playerOvr(p), after: playerOvr(next) });
  }
  const without = (ids: string[]) => ids.filter((id) => !gone.has(id));
  const table = (t: Record<string, string[]>) => Object.fromEntries(Object.entries(t).map(([k, ids]) => [k, without(ids)]));
  return {
    franchise: {
      ...f,
      players,
      rosters: table(f.rosters),
      devRosters: table(f.devRosters),
      freeAgents: without(f.freeAgents),
      waivers: f.waivers.filter((w) => !gone.has(w.playerId)),
    },
    report: { retired: [...gone], lastTeams, changes },
  };
}
