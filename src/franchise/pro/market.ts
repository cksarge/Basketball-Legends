// What players are worth, what they want from a team, and how they answer an offer.
import { playerOvr } from "@/engine/player";
import { clamp } from "@/engine/rng";
import type { Player } from "@/engine/types";
import { reb } from "@/game/sim/stats";
import type { Franchise } from "../types";
import { payroll } from "./cap";
import { START_CAP, capRules, roundMoney } from "./rules";

export interface Offer {
  teamId: string;
  salary: number;
  years: number;
  playerOption?: boolean;
  teamOption?: boolean;
}
export interface Mood {
  score: number;
  parts: { money: number; role: number; winning: number; loyalty: number };
}
export type NegotiationReply = { kind: "accept" } | { kind: "counter"; salary: number; years: number; note: string } | { kind: "walk"; note: string };

const PRODUCTION_SHARE = 0.15;
/** Keeps new deals in step with a cap that rises while old deals stay flat. */
const MARKET_SCALE = 1.14;
const MIN_GAMES = 20;
/** How far a great or bad fit moves his price. */
const MOOD_SWING = 0.5;
const PLAYER_OPTION_VALUE = 1.05;
const TEAM_OPTION_COST = 0.94;
const YEAR_MISMATCH = 0.06;
export const TALK_TRIES = 3;
const FACILITY_MOOD = 400;
/** Teams with fewer games than this are judged as average. */
const WINNING_GAMES = 10;

const ageDiscount = (age: number) => (age >= 36 ? 0.45 : age >= 33 ? 0.7 : age >= 30 ? 0.9 : 1);
const valueAt = (ovr: number) => 1.1e6 + (Math.max(0, ovr - 60) / 35) ** 2.4 * 52e6 * MARKET_SCALE;

/** The overall a season's numbers look like. */
function producedOvr(f: Franchise, p: Player) {
  const l = f.season.stats[p.id];
  if (!l || l.gp < MIN_GAMES) return null;
  return 52 + ((l.pts + reb(l) * 0.7 + l.ast * 0.9 + (l.stl + l.blk) * 1.2) / l.gp) * 1.1;
}

/** A player's value as the league can see it: a rookie no one has seen play is judged on the middle of his range. */
export function shownValue(f: Franchise, p: Player): number {
  return p.file?.range ? marketValue(f, p, (p.file.range.ovr[0] + p.file.range.ovr[1]) / 2) : marketValue(f, p);
}

export function marketValue(f: Franchise, p: Player, seenOvr?: number): number {
  const rules = capRules(f.cap);
  const ovr = seenOvr ?? playerOvr(p);
  const produced = producedOvr(f, p);
  const base = produced === null ? valueAt(ovr) : valueAt(ovr) * (1 - PRODUCTION_SHARE) + valueAt(produced) * PRODUCTION_SHARE;
  return roundMoney(clamp((base * ageDiscount(p.age) * rules.salaryCap) / START_CAP, rules.minSalary, rules.maxSalary(p.file?.service ?? 0)));
}

const winTables = new WeakMap<object, Map<string, { w: number; l: number }>>();

/** Share of games won this season, or the season just finished. */
export function winShare(f: Franchise, teamId: string): number {
  let table = winTables.get(f.season.games);
  if (!table) {
    table = new Map();
    const row = (id: string) => table!.get(id) ?? table!.set(id, { w: 0, l: 0 }).get(id)!;
    for (const g of f.season.games) {
      if (!g.result || g.kind !== "region") continue;
      const homeWon = g.result.home > g.result.away;
      row(g.homeId)[homeWon ? "w" : "l"]++;
      row(g.awayId)[homeWon ? "l" : "w"]++;
    }
    winTables.set(f.season.games, table);
  }
  const r = table.get(teamId);
  return r && r.w + r.l >= WINNING_GAMES ? r.w / (r.w + r.l) : 0.5;
}

function rolePart(f: Franchise, p: Player, teamId: string) {
  const ovr = playerOvr(p);
  const ahead = f.rosters[teamId].filter((id) => id !== p.id && playerOvr(f.players[id]) > ovr).length;
  return ahead < 5 ? 1 : ahead < 8 ? 0.6 : 0.2;
}

const isHome = (p: Player, teamId: string) => (p.teamId ?? p.file?.rightsTeamId) === teamId;

/** How a player feels about a team, before any offer. */
export function mood(f: Franchise, p: Player, teamId: string): Mood {
  const { ego, loyalty } = p.traits;
  const parts = {
    money: clamp((capRules(f.cap).salaryCap * 1.3 - payroll(f, teamId)) / capRules(f.cap).salaryCap, 0, 1),
    role: rolePart(f, p, teamId),
    winning: winShare(f, teamId),
    loyalty: isHome(p, teamId) ? loyalty : 0,
  };
  const weights = { money: 0.1, role: 0.2 + ego * 0.3, winning: 0.5 - ego * 0.15, loyalty: 0.3 };
  const total = weights.money + weights.role + weights.winning + (isHome(p, teamId) ? weights.loyalty : 0);
  const sum = parts.money * weights.money + parts.role * weights.role + parts.winning * weights.winning + parts.loyalty * weights.loyalty;
  // better buildings help a little everywhere
  return { score: sum / total + (f.finance[teamId].facilities - 50) / FACILITY_MOOD, parts };
}

function wantedYears(p: Player) {
  if (p.age >= 34) return 1;
  if (p.age >= 32) return 2;
  if (p.age >= 30) return 3;
  return p.age <= 27 ? 4 : 3;
}

/** What he wants from this team. A team he likes gets a better price. */
export function askingPrice(f: Franchise, p: Player, teamId: string): { salary: number; years: number } {
  const rules = capRules(f.cap);
  const scaled = marketValue(f, p) * (1 + (0.5 - mood(f, p, teamId).score) * MOOD_SWING);
  return { salary: roundMoney(clamp(scaled, rules.minSalary, rules.maxSalary(p.file?.service ?? 0))), years: wantedYears(p) };
}

/** What an offer's worth to him in salary terms. */
function offerWorth(p: Player, o: Offer) {
  // an option covers a last year after the first, so a one-year deal can't have one
  const options = o.years < 2 ? 1 : (o.playerOption ? PLAYER_OPTION_VALUE : 1) * (o.teamOption ? TEAM_OPTION_COST : 1);
  return o.salary * options * Math.max(0.5, 1 - Math.abs(o.years - wantedYears(p)) * YEAR_MISMATCH);
}

/** An offer against his price for that team: 1 means it's exactly what he wants. */
export const offerScore = (f: Franchise, p: Player, o: Offer) => offerWorth(p, o) / askingPrice(f, p, o.teamId).salary;

export const recordTalk = (f: Franchise, id: string): Franchise => ({ ...f, talks: { ...f.talks, [id]: (f.talks[id] ?? 0) + 1 } });

export function negotiate(f: Franchise, p: Player, o: Offer): NegotiationReply {
  const tries = f.talks[p.id] ?? 0;
  if (tries >= TALK_TRIES) return { kind: "walk", note: "He's done talking until next year." };
  const ask = askingPrice(f, p, o.teamId);
  const score = offerScore(f, p, o);
  if (score >= 1) return { kind: "accept" };
  if (tries === TALK_TRIES - 1) return { kind: "walk", note: "He's heard enough, and won't talk again until next year." };
  const salary = roundMoney(Math.min(ask.salary, o.salary + (ask.salary - o.salary) * 0.75));
  const note = o.years !== ask.years ? `He'd rather sign for ${ask.years} year${ask.years === 1 ? "" : "s"}.` : "He wants more money.";
  return { kind: "counter", salary, years: ask.years, note };
}
