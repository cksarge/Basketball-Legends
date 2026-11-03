// The transfer portal: after the season, players who want more minutes, more money or a fresh start leave their
// programs. Everyone recruits them over three rounds, with the same actions as high school recruits.
import { playerOvr } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { Player, Team } from "@/engine/types";
import type { Franchise, Recruit, RecruitNeed } from "../types";
import { nilAsk, nilRoom, promiseNil, releaseNil } from "./nil";
import { aiRecruiting, openScholarships, refillPoints, resolveWeek, returning } from "./recruiting";

export const PORTAL_ROUNDS = 3;
const BASE_CHANCE = 0.04;
const UNDERUSED = 0.25;
const EGO = 0.1;
const LOYALTY = 0.1;
const UNMET_ASK = 0.08;
const MET_ASK = 0.03;
const NEW_COACH = 0.2;
/** How often an AI program changes coaches in a summer. */
const AI_COACH_CHANGE = 0.08;
const MOST = 0.9;
/** Minutes per game a player expects by where he ranks on his team. */
const EXPECTED_MINUTES = [28, 28, 28, 28, 28, 18, 18, 18, 8, 8, 8];
const NEEDS: RecruitNeed[] = ["playingTime", "nil", "prestige", "winning", "distance", "coach"];

const stableChance = (key: string) => new Rng(key).next();

/** Did this program's coach change this summer? */
export function coachChanged(f: Franchise, teamId: string): boolean {
  if (teamId === f.teamId) return (f.job.stints.at(-1)?.from ?? 0) > f.season.year;
  return stableChance(`${f.seed}:coach:${teamId}:${f.season.year}`) < AI_COACH_CHANGE;
}

/** The chance a player enters the portal this summer. */
export function portalChance(f: Franchise, p: Player): number {
  const teamId = p.teamId;
  if (!teamId || !f.college || !returning(f, p.id)) return 0;
  const roster = f.rosters[teamId].map((id) => f.players[id]);
  // talent is whichever is better: what he is now, or what he could be
  const rank = Math.min([...roster].sort((a, b) => playerOvr(b) - playerOvr(a)).indexOf(p), [...roster].sort((a, b) => b.potential - a.potential).indexOf(p));
  const line = f.season.stats[p.id];
  const perGame = line?.gp ? line.min / 60 / line.gp : 0;
  const short = (EXPECTED_MINUTES[rank] ?? 0) - perGame;
  let chance = BASE_CHANCE + (short > 0 ? UNDERUSED * Math.min(1, short / 20) : 0);
  chance += p.traits.ego * EGO - p.traits.loyalty * LOYALTY;
  const ask = nilAsk(p, f.college.division);
  const promised = f.college.nil[teamId]?.next.deals[p.id] ?? 0;
  chance += promised >= ask ? -MET_ASK : UNMET_ASK * (1 - promised / Math.max(1, ask));
  if (coachChanged(f, teamId)) chance += NEW_COACH;
  return clamp(chance, 0, MOST);
}

/** AI programs promise their best returning players what they ask, while the money lasts. */
function aiRetention(f: Franchise, teams: Team[]): Franchise {
  let next = f;
  for (const t of teams) {
    if (t.id === f.teamId) continue;
    const keep = f.rosters[t.id].filter((id) => returning(f, id)).sort((a, b) => playerOvr(f.players[b]) - playerOvr(f.players[a]) || a.localeCompare(b));
    for (const id of keep) {
      const ask = nilAsk(f.players[id], f.college!.division);
      if (ask > nilRoom(next, t.id)) break;
      const done = promiseNil(next, t.id, id, ask);
      if (!("error" in done)) next = done;
    }
  }
  return next;
}

/** Opens the portal: players decide, leave their teams and become recruits. */
export function openPortal(start: Franchise, teams: Team[], rng: Rng): Franchise {
  const f = aiRetention(start, teams);
  const entered: { p: Player; from: string }[] = [];
  for (const t of [...teams].sort((a, b) => a.id.localeCompare(b.id)))
    for (const id of [...f.rosters[t.id]].sort()) {
      const p = f.players[id];
      if (rng.chance(portalChance(f, p))) entered.push({ p, from: t.id });
    }
  const ranked = [...entered].sort((a, b) => playerOvr(b.p) - playerOvr(a.p) || a.p.id.localeCompare(b.p.id));
  const leaving = new Set(entered.map((e) => e.p.id));
  const players = { ...f.players };
  for (const { p, from } of entered) players[p.id] = { ...p, teamId: null, file: { ...p.file!, lastTeamId: from } };
  const rosters = Object.fromEntries(Object.entries(f.rosters).map(([id, ids]) => [id, ids.filter((x) => !leaving.has(x))]));
  const recruits: Recruit[] = ranked.map(({ p, from }, i) => {
    const ask = nilAsk(p, f.college!.division);
    const stars = ([5, 4, 3] as const).find((s) => nilAsk(p, f.college!.division, s) <= ask) ?? 2;
    const pick = new Rng(`${f.seed}:portal:${p.id}:${f.season.year}`);
    const wants = pick.shuffle([...NEEDS]).slice(0, 3);
    return {
      id: p.id,
      kind: "transfer",
      from,
      stars,
      rank: i + 1,
      wants,
      nilAsk: ask,
      interest: {},
      offers: {},
      homeVisits: [],
      officialVisits: [],
      scouted: 0,
    };
  });
  const released = entered.reduce((x, { p, from }) => releaseNil(x, from, p.id), { ...f, players, rosters } as Franchise);
  const c = released.college!;
  return refillPoints(
    { ...released, college: { ...c, recruits: [...c.recruits, ...recruits], portal: { round: 1, entered: ranked.map((e) => e.p.id) } } },
    teams,
  );
}

/** One round: programs recruit, transfers commit, and points refill. */
export function portalRound(f: Franchise, teams: Team[], rng: Rng): Franchise {
  const portal = f.college?.portal;
  if (!portal || portal.round > PORTAL_ROUNDS) return f;
  const worked = resolveWeek(aiRecruiting(f, teams, f.settings.auto.recruiting), rng);
  const next = refillPoints(worked, teams);
  return { ...next, college: { ...next.college!, portal: { ...portal, round: portal.round + 1 } } };
}

/** Transfers join their new teams. The rest take their best offer with room, or leave the league. */
export function closePortal(f: Franchise, teams: Team[]): Franchise {
  const c = f.college;
  if (!c?.portal) return f;
  let next: Franchise = f;
  const known = new Set(teams.map((t) => t.id));
  const transfers = c.recruits.filter((r) => r.kind === "transfer").sort((a, b) => a.rank - b.rank);
  for (const r of transfers) {
    const room = (id: string) => known.has(id) && openScholarships(next, id) > 0;
    const choice =
      r.committed ??
      Object.keys(r.offers)
        .filter(room)
        .sort((a, b) => (r.interest[b] ?? 0) - (r.interest[a] ?? 0) || a.localeCompare(b))[0];
    const others = Object.keys(r.offers).filter((id) => id !== choice);
    next = others.reduce((x, id) => releaseNil(x, id, r.id), next);
    const players = { ...next.players };
    const rosters = { ...next.rosters };
    if (choice) {
      const p = players[r.id];
      players[r.id] = { ...p, teamId: choice, file: { ...p.file!, teamSeasons: 0 } };
      rosters[choice] = [...rosters[choice], r.id];
    } else delete players[r.id];
    const recruits = next.college!.recruits.filter((x) => x.id !== r.id);
    next = { ...next, players, rosters, college: { ...next.college!, recruits } };
  }
  return { ...next, college: { ...next.college!, portal: null } };
}
