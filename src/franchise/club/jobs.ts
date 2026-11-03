// Life after a firing: what the record is worth, who calls, and starting over.
import { clamp } from "@/engine/rng";
import type { Team } from "@/engine/types";
import { defaultPlan } from "../coaching/plan";
import { clearUndo } from "../core/moves";
import { addNews, hiredNews } from "../history/news";
import { START_SECURITY } from "../pro/gmState";
import { teamSlot } from "../pro/tradeValue";
import type { Franchise, JobStint } from "../types";
import { worldTeams } from "../world";
import { seasonGoals } from "./owner";

const TITLE_REPUTATION = 0.06;
const WORST_RECORD = 0.3;
const BEST_RECORD = 0.7;
const MOST_OFFERS = 6;

/** 0 for a losing record, 1 for a great one. Titles count for a lot. */
export function reputation(f: Franchise): number {
  const all = f.job.stints.reduce((t, s) => ({ w: t.w + s.w, l: t.l + s.l, titles: t.titles + s.titles }), { w: 0, l: 0, titles: 0 });
  const share = all.w + all.l ? all.w / (all.w + all.l) : 0.5;
  return clamp((share - WORST_RECORD) / (BEST_RECORD - WORST_RECORD) + all.titles * TITLE_REPUTATION, 0, 1);
}

/** Better records reach better teams. The worst team in the league always calls. */
export function jobOffers(f: Franchise, all: Team[]): string[] {
  if (!f.job.fired) return [];
  const teams = worldTeams(all, f.world);
  const open = teams.map((t) => t.id).filter((id) => id !== f.job.fired!.teamId);
  const order = open.sort((a, b) => teamSlot(f, a) - teamSlot(f, b));
  const reach = Math.round(reputation(f) * (order.length - 1));
  const near = order.slice(Math.max(1, reach - MOST_OFFERS + 2), reach + 1);
  return [order[0], ...near];
}

export function takeJob(f: Franchise, teamId: string, all: Team[]): Franchise {
  if (!jobOffers(f, all).includes(teamId)) return f;
  const teams = worldTeams(all, f.world);
  const year = f.season.year;
  const ended = f.job.stints.map((s, i, all): JobStint => (i === all.length - 1 ? { ...s, to: year } : s));
  const moved: Franchise = { ...clearUndo(f), teamId, plan: defaultPlan(), tradeBlock: [], tradeOffers: [], talks: {}, draft: { ...f.draft, assigned: [] } };
  delete moved.live;
  if (moved.freeAgency) moved.freeAgency = { ...moved.freeAgency, bids: [], notices: [] };
  const job = { ...f.job, security: START_SECURITY, seasons: 0, stints: [...ended, { teamId, league: f.league, from: year + 1, w: 0, l: 0, titles: 0 }] };
  delete job.fired;
  const hired: Franchise = { ...moved, job: { ...job, goals: seasonGoals(moved, teams) } };
  return addNews(hired, [hiredNews(hired, teams)]);
}
