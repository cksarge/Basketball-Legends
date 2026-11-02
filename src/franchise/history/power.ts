// Power rankings: rosters set the order at first, then results take over, with recent form counting extra.
import { playerOvr } from "@/engine/player";
import type { Franchise } from "../types";

const RESULTS_TAKE_OVER = 25;
const RECENT = 10;
const WIN_POINTS = 60;
const DIFF_POINTS = 1.2;
const FORM_POINTS = 20;
const ROSTER_POINTS = 3;
const ROSTER_FLOOR = 70;

const strength = (f: Franchise, id: string) => {
  const top = f.rosters[id]
    .map((p) => playerOvr(f.players[p]))
    .sort((a, b) => b - a)
    .slice(0, 8);
  return (top.reduce((a, b) => a + b, 0) / Math.max(1, top.length) - ROSTER_FLOOR) * ROSTER_POINTS;
};

export function powerRankings(f: Franchise) {
  const played = f.season.games.filter((g) => g.result && g.kind === "region").sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const results: Record<string, { won: boolean; diff: number }[]> = {};
  for (const g of played) {
    const margin = g.result!.home - g.result!.away;
    (results[g.homeId] ??= []).push({ won: margin > 0, diff: margin });
    (results[g.awayId] ??= []).push({ won: margin < 0, diff: -margin });
  }
  const score = (id: string) => {
    const rows = results[id] ?? [];
    const roster = strength(f, id);
    if (!rows.length) return roster;
    const wins = rows.filter((r) => r.won).length / rows.length;
    const diff = rows.reduce((sum, r) => sum + r.diff, 0) / rows.length;
    const last = rows.slice(-RECENT);
    const form = last.filter((r) => r.won).length / last.length;
    const share = Math.min(1, rows.length / RESULTS_TAKE_OVER);
    return share * (wins * WIN_POINTS + diff * DIFF_POINTS + form * FORM_POINTS) + (1 - share) * roster;
  };
  const rows = Object.keys(f.rosters).map((teamId) => ({ teamId, score: score(teamId) }));
  rows.sort((a, b) => b.score - a.score || a.teamId.localeCompare(b.teamId));
  return rows.map((r, i) => ({ ...r, rank: i + 1, last: f.powerLast[r.teamId] ?? i + 1 }));
}

export const powerSnapshot = (f: Franchise) => Object.fromEntries(powerRankings(f).map((r) => [r.teamId, r.rank]));
