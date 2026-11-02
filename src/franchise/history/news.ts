// The league's news feed. Stories are written with the names of the moment, so they stay true after trades.
import type { ProSeries, ScheduledGame } from "@/career/types";
import { fullName, playerOvr } from "@/engine/player";
import { hashString } from "@/engine/rng";
import type { Team } from "@/engine/types";
import type { BoxResult } from "../boxsim";
import { winShare } from "../pro/market";
import type { TradeAsset } from "../pro/trades";
import type { Franchise, NewsItem } from "../types";

export const NEWS_LIMIT = 300;
type Item = Omit<NewsItem, "id">;

const LONG_INJURY = 10;
const NOTABLE_OVR = 78;
const BIG_GAME = 50;
const UPSET_GAP = 0.2;
const CAREER_MARKS = [10_000, 20_000, 30_000];
const RETIREE_OVR = 85;
const RETIREES = 5;
const SIGNINGS = 5;

const teamName = (teams: Team[], id: string | null | undefined) => teams.find((t) => t.id === id)?.name ?? "";

export function addNews(f: Franchise, items: Item[]): Franchise {
  if (!items.length) return f;
  const have = new Set(f.news.map((n) => n.id));
  const fresh: NewsItem[] = [];
  for (const item of items) {
    const id = `n-${hashString(`${item.date}:${item.kind}:${item.text}`).toString(36)}`;
    if (have.has(id)) continue;
    have.add(id);
    fresh.push({ ...item, id });
  }
  return fresh.length ? { ...f, news: [...f.news, ...fresh].slice(-NEWS_LIMIT) } : f;
}

/** What a finished game gave the feed. Season stats in the franchise already include this game. */
export function gameNews(f: Franchise, g: ScheduledGame, r: BoxResult, teams: Team[]): Item[] {
  const out: Item[] = [];
  const date = g.date;
  for (const x of r.injuries) {
    const p = f.players[x.playerId];
    const onYourTeam = g.homeId === f.teamId || g.awayId === f.teamId ? f.rosters[f.teamId].includes(x.playerId) : false;
    if (!onYourTeam && (x.gamesOut < LONG_INJURY || playerOvr(p) < NOTABLE_OVR)) continue;
    out.push({
      date,
      kind: "injury",
      text: `${fullName(p)} of ${teamName(teams, p.teamId)} is out about ${x.gamesOut} games: ${x.name.toLowerCase()}.`,
      teamIds: [p.teamId!],
    });
  }
  const homeWon = r.home > r.away;
  const [winner, loser] = homeWon ? [g.homeId, g.awayId] : [g.awayId, g.homeId];
  if (winShare(f, loser) - winShare(f, winner) >= UPSET_GAP) {
    const score = `${Math.max(r.home, r.away)}-${Math.min(r.home, r.away)}`;
    out.push({ date, kind: "upset", text: `${teamName(teams, winner)} stunned ${teamName(teams, loser)}, ${score}.`, teamIds: [winner, loser] });
  }
  for (const [id, line] of Object.entries(r.box)) {
    const p = f.players[id];
    if (line.pts >= BIG_GAME)
      out.push({
        date,
        kind: "milestone",
        text: `${fullName(p)} scored ${line.pts} points for ${teamName(teams, p.teamId)}.`,
        teamIds: p.teamId ? [p.teamId] : [],
      });
    const after = (p.file?.career?.pts ?? 0) + (f.season.stats[id]?.pts ?? 0);
    const mark = CAREER_MARKS.find((m) => after >= m && after - line.pts < m);
    if (mark)
      out.push({ date, kind: "milestone", text: `${fullName(p)} passed ${mark.toLocaleString("en-US")} career points.`, teamIds: p.teamId ? [p.teamId] : [] });
  }
  return out;
}

export function tradeNews(f: Franchise, entry: { date: string; teams: string[]; assets: TradeAsset[] }, teams: Team[]): Item[] {
  const moved = entry.assets.flatMap((a) => (a.kind === "player" ? [`${fullName(f.players[a.id])} to ${teamName(teams, a.to)}`] : []));
  const names = entry.teams.map((id) => teamName(teams, id)).join(" and ");
  return [{ date: entry.date, kind: "trade", text: `${names} made a trade${moved.length ? `: ${moved.join(", ")}` : ""}.`, teamIds: entry.teams }];
}

export function seriesNews(f: Franchise, x: ProSeries, teams: Team[]): Item {
  const loser = x.winner === x.high ? x.low : x.high;
  const kind = x.winner === x.low ? "upset" : "milestone";
  return { date: f.date, kind, text: `${teamName(teams, x.winner)} beat ${teamName(teams, loser)} in the ${x.label}.`, teamIds: [x.winner!, loser] };
}

export function seasonNews(f: Franchise, teams: Team[]): Item[] {
  const out: Item[] = [];
  const champ = f.season.championId;
  if (champ) out.push({ date: f.date, kind: "award", text: `${teamName(teams, champ)} won the championship.`, teamIds: [champ] });
  const mvp = f.season.awards.find((a) => a.id === "mvp");
  if (mvp)
    out.push({
      date: f.date,
      kind: "award",
      text: `${fullName(f.players[mvp.playerId])} of ${teamName(teams, mvp.teamId)} was named Most Valuable Player.`,
      teamIds: [mvp.teamId],
    });
  return out;
}

export function retirementNews(f: Franchise, teams: Team[]): Item[] {
  const report = f.offseason?.report;
  if (!report) return [];
  const gone = report.retired.map((id) => f.players[id]).sort((a, b) => (b.file?.peak ?? 0) - (a.file?.peak ?? 0));
  const notable = gone.filter((p) => (p.file?.peak ?? 0) >= RETIREE_OVR).slice(0, RETIREES);
  return (notable.length ? notable : gone.slice(0, 1)).map((p) => {
    const last = report.lastTeams[p.id];
    return {
      date: f.date,
      kind: "retirement",
      text: `${fullName(p)} retired at ${p.age}${last ? `, last with ${teamName(teams, last)}` : ""}.`,
      teamIds: last ? [last] : [],
    };
  });
}

export function draftNews(f: Franchise, teams: Team[]): Item[] {
  const first = f.draft.results[0];
  if (!first) return [];
  return [
    {
      date: f.date,
      kind: "draft",
      text: `${teamName(teams, first.teamId)} took ${fullName(f.players[first.playerId])} with the first pick.`,
      teamIds: [first.teamId],
    },
  ];
}

export function signingNews(f: Franchise, teams: Team[]): Item[] {
  const top = [...(f.freeAgency?.signed ?? [])].sort((a, b) => b.salary - a.salary).slice(0, SIGNINGS);
  return top.map((s) => ({
    date: f.date,
    kind: "signing",
    text: `${fullName(f.players[s.playerId])} signed with ${teamName(teams, s.teamId)}: $${(s.salary / 1e6).toFixed(1)}M for ${s.years} year${s.years === 1 ? "" : "s"}.`,
    teamIds: [s.teamId],
  }));
}

export const firedNews = (f: Franchise, teams: Team[]): Item => ({
  date: f.date,
  kind: "job",
  text: `${teamName(teams, f.teamId)} fired their head coach.`,
  teamIds: [f.teamId],
});
export const hiredNews = (f: Franchise, teams: Team[]): Item => ({
  date: f.date,
  kind: "job",
  text: `${teamName(teams, f.teamId)} hired you as head coach.`,
  teamIds: [f.teamId],
});
