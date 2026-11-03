// Eligibility in college: four seasons of play in five years, one redshirt, early draft declarations, graduation,
// and walk-ons who fill out a roster.
import { fullName, generatePlayer, playerOvr } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { ClassYear, Player, Team } from "@/engine/types";
import { budgetEffect } from "../club/finance";
import { staffRating } from "../coaching/staff";
import { progressPlayer } from "../core/progress";
import { addNews } from "../history/news";
import { PROGRESSION_SPEED } from "../settings";
import type { Franchise, ProgressReport } from "../types";
import { nilAsk } from "./nil";
import { COLLEGE_ROSTER_MAX, ELIGIBLE_SEASONS, SCHOLARSHIPS, recruitPlayer, returning } from "./recruiting";

export type Projection = "lottery" | "first round" | "second round";
/** Potential and overall a pro scout needs to see, best first. */
const PROJECTIONS: [Projection, number, number][] = [
  ["lottery", 84, 72],
  ["first round", 78, 66],
  ["second round", 74, 62],
];
const DECLARE_BASE: Record<Projection, number> = { lottery: 0.7, "first round": 0.4, "second round": 0.12 };
const DECLARE_PER_YEAR = 0.1;
const DECLARE_MOST = 0.95;
const PITCH_BASE = 0.2;
const PITCH_STARTER = 0.3;
const PITCH_NIL = 0.25;
const STARTERS = 5;
export const MOST_REDSHIRT_GAMES = 4;
/** AI programs redshirt half their freshmen outside the top 11 who have this much room to grow. */
const AI_REDSHIRT_DEPTH = 11;
const AI_REDSHIRT_ROOM = 8;
const AI_REDSHIRT_CHANCE = 0.5;
const CAMP_MIN = 13;
const WALK_ON_GAP = 10;
const CLASSES: ClassYear[] = ["FR", "SO", "JR", "SR"];

const eligibility = (p: Player) => p.file?.eligibility ?? { used: 0, redshirted: false };
/** Is he sitting out this season as a redshirt? */
export const redshirting = (p: Player, year: number) => !!p.file?.eligibility?.redshirted && p.file.eligibility.year === year;

/** His class next season: a fifth-year player who redshirted earlier is a graduate student. */
export function classFor(p: Player, seasonYear: number): ClassYear {
  const e = eligibility(p);
  if (e.used >= 3 && e.redshirted && (e.year ?? seasonYear) < seasonYear) return "GR";
  return CLASSES[Math.min(3, e.used)];
}

export function projection(p: Player): Projection | null {
  const ovr = playerOvr(p);
  return PROJECTIONS.find(([, pot, now]) => p.potential >= pot && ovr >= now)?.[0] ?? null;
}

/** Out of eligibility after this season? */
const graduating = (p: Player, year: number) => eligibility(p).used + (redshirting(p, year) ? 0 : 1) >= ELIGIBLE_SEASONS;

export function declareChance(p: Player, f: Franchise): number {
  const proj = projection(p);
  if (!proj || graduating(p, f.season.year)) return 0;
  return clamp(DECLARE_BASE[proj] + eligibility(p).used * DECLARE_PER_YEAR, 0, DECLARE_MOST);
}

/** Every player in the division decides whether to leave early. */
export function decideDeclarations(f: Franchise, teams: Team[]): Franchise {
  const rng = new Rng(`${f.seed}:declare:${f.season.year}`);
  const declared: { id: string; projection: string }[] = [];
  for (const t of [...teams].sort((a, b) => a.id.localeCompare(b.id)))
    for (const id of [...f.rosters[t.id]].sort()) {
      const p = f.players[id];
      if (rng.chance(declareChance(p, f))) declared.push({ id, projection: projection(p)! });
    }
  return { ...f, college: { ...f.college!, declared, pitched: [] } };
}

/** The user's one try to talk a declared player into coming back. Starters and players with NIL waiting listen more. */
export function pitch(f: Franchise, id: string): Franchise {
  const c = f.college!;
  if (c.pitched.includes(id) || !c.declared.some((d) => d.id === id) || !f.rosters[f.teamId].includes(id)) return f;
  const p = f.players[id];
  const starters = [...f.rosters[f.teamId]].sort((a, b) => playerOvr(f.players[b]) - playerOvr(f.players[a])).slice(0, STARTERS);
  const promised = c.nil[f.teamId]?.next.deals[id] ?? 0;
  const stay = PITCH_BASE + (starters.includes(id) ? PITCH_STARTER : 0) + PITCH_NIL * Math.min(1, promised / Math.max(1, nilAsk(p, c.division)));
  const stays = new Rng(`${f.seed}:pitch:${id}:${f.season.year}`).chance(stay);
  return { ...f, college: { ...c, pitched: [...c.pitched, id], declared: stays ? c.declared.filter((d) => d.id !== id) : c.declared } };
}

export function canRedshirt(f: Franchise, id: string): boolean {
  const p = f.players[id];
  if (!p || !f.rosters[f.teamId].includes(id) || f.phase === "offseason") return false;
  const e = eligibility(p);
  // one redshirt a career
  if (e.redshirted && e.year !== f.season.year) return false;
  return (f.season.stats[id]?.gp ?? 0) <= MOST_REDSHIRT_GAMES;
}

/** Sits a player for the season, or brings him back, keeping his year of eligibility. */
export function setRedshirt(f: Franchise, id: string, on: boolean): Franchise {
  if (!canRedshirt(f, id)) return f;
  const p = f.players[id];
  const e = eligibility(p);
  const next = on ? { used: e.used, redshirted: true, year: f.season.year } : { used: e.used, redshirted: false };
  return { ...f, players: { ...f.players, [id]: { ...p, file: { ...p.file!, eligibility: next } } } };
}

/** AI programs sit some freshmen who need a year, for the season starting `year`. */
export function aiRedshirts(f: Franchise, teams: Team[], year: number): Franchise {
  const players = { ...f.players };
  for (const t of teams) {
    if (t.id === f.teamId) continue;
    const ranked = [...f.rosters[t.id]].sort((a, b) => playerOvr(f.players[b]) - playerOvr(f.players[a]) || a.localeCompare(b));
    for (const id of ranked.slice(AI_REDSHIRT_DEPTH)) {
      const p = f.players[id];
      const e = eligibility(p);
      if (e.used !== 0 || e.redshirted || p.potential - playerOvr(p) < AI_REDSHIRT_ROOM) continue;
      if (new Rng(`${f.seed}:redshirt:${id}:${year}`).chance(AI_REDSHIRT_CHANCE))
        players[id] = { ...p, file: { ...p.file!, eligibility: { used: 0, redshirted: true, year } } };
    }
  }
  return { ...f, players };
}

/** A walk-on: well below the roster, with a full four years ahead. */
function walkOn(f: Franchise, teamId: string, n: number, rng: Rng): Player {
  const ids = f.rosters[teamId];
  const average = ids.length ? ids.reduce((s, id) => s + playerOvr(f.players[id]), 0) / ids.length : 50;
  const p = generatePlayer(rng, {
    targetOvr: Math.round(clamp(average - WALK_ON_GAP + rng.normal(0, 3), 30, 80)),
    age: 18,
    league: "college",
    teamId,
    classYear: "FR",
    hometownPool: "us",
  });
  const division = f.college!.division;
  return {
    ...p,
    id: `w${f.season.year}-${teamId}-${n}`,
    file: { service: 0, teamSeasons: 0, eligibility: { used: 0, redshirted: false }, ...(division === "D3" ? {} : { walkOn: true }) },
  };
}

/** Tops a roster up to 13 with walk-ons. */
export function fillWalkOns(f: Franchise, teamId: string, rng: Rng, min = CAMP_MIN): Franchise {
  let next = f;
  for (let n = 0; next.rosters[teamId].length < min; n++) {
    const p = walkOn(next, teamId, n, rng);
    if (next.players[p.id]) continue;
    next = { ...next, players: { ...next.players, [p.id]: p }, rosters: { ...next.rosters, [teamId]: [...next.rosters[teamId], p.id] } };
  }
  return next;
}

/** Commitments past next season's scholarships or roster spots. */
export function overCommitted(f: Franchise, teamId: string): number {
  const c = f.college!;
  const back = f.rosters[teamId].filter((id) => returning(f, id));
  const commits = c.recruits.filter((r) => r.committed === teamId).length;
  const spots = back.length + commits - COLLEGE_ROSTER_MAX;
  const funded = c.division === "D3" ? 0 : back.filter((id) => !f.players[id].file?.walkOn).length + commits - SCHOLARSHIPS[c.division];
  return Math.max(0, spots, funded);
}

/** Pulls the lowest unsigned commitments until the class fits. */
export function trimCommitments(f: Franchise, teamId: string): Franchise {
  let next = f;
  const unsigned = next.college!.recruits.filter((r) => r.committed === teamId && !r.signed).sort((a, b) => b.rank - a.rank);
  for (const r of unsigned) {
    if (overCommitted(next, teamId) <= 0) break;
    const offers = { ...r.offers };
    delete offers[teamId];
    next = {
      ...next,
      college: { ...next.college!, recruits: next.college!.recruits.map((x) => (x.id === r.id ? { ...x, committed: undefined, offers } : x)) },
    };
  }
  return next;
}

/** The summer: players out of eligibility and declared players leave, everyone else grows a year, and the new class enrolls. */
export function collegeProgress(f: Franchise): { franchise: Franchise; report: ProgressReport } {
  const c = f.college!;
  const year = f.season.year;
  const bonus = ((staffRating(f, "development") - 50) / 45) * budgetEffect(f, "coaching");
  const speed = PROGRESSION_SPEED[f.settings.league.progression];
  const declared = new Set(c.declared.map((d) => d.id));
  const mine = new Set(f.rosters[f.teamId]);
  const players = { ...f.players };
  const rosters: Record<string, string[]> = {};
  const report: ProgressReport = { retired: [], lastTeams: {}, changes: [] };
  for (const [teamId, ids] of Object.entries(f.rosters)) {
    rosters[teamId] = [];
    for (const id of [...ids].sort()) {
      const p = f.players[id];
      const e = eligibility(p);
      const played = !redshirting(p, year);
      const used = e.used + (played ? 1 : 0);
      if (used >= ELIGIBLE_SEASONS || declared.has(id)) {
        players[id] = { ...p, teamId: null, file: { ...p.file!, eligibility: { ...e, used }, lastTeamId: teamId } };
        report.retired.push(id);
        report.lastTeams[id] = teamId;
        continue;
      }
      const grown = progressPlayer(p, new Rng(`${f.seed}:progress:${year}:${id}`), mine.has(id) ? bonus : 0, speed, "college");
      const file = {
        ...grown.file!,
        eligibility: { ...e, used },
        service: (p.file?.service ?? 0) + (played ? 1 : 0),
        peak: Math.max(grown.file?.peak ?? 0, playerOvr(p), playerOvr(grown)),
      };
      const next = { ...grown, file };
      players[id] = { ...next, classYear: classFor(next, year + 1) };
      rosters[teamId].push(id);
      if (mine.has(id)) report.changes.push({ id, before: playerOvr(p), after: playerOvr(grown) });
    }
  }
  for (const r of c.recruits) {
    if (r.kind !== "hs" || !r.signed || !r.committed || !rosters[r.committed]) continue;
    const p = recruitPlayer(f, r);
    players[r.id] = {
      ...p,
      age: p.age + 1,
      teamId: r.committed,
      classYear: "FR",
      file: { ...p.file!, service: 0, teamSeasons: 0, eligibility: { used: 0, redshirted: false } },
    };
    rosters[r.committed].push(r.id);
  }
  const news = c.declared
    .map((d) => ({ d, p: f.players[d.id] }))
    .filter(({ p }) => p)
    .sort((a, b) => playerOvr(b.p) - playerOvr(a.p))
    .slice(0, 5)
    .map(({ d, p }) => ({
      date: f.date,
      kind: "draft" as const,
      text: `${fullName(p)} declared for the pro draft, projected in the ${d.projection}.`,
      teamIds: p.teamId ? [p.teamId] : [],
    }));
  const done: Franchise = { ...f, players, rosters, college: { ...c, recruits: c.recruits.filter((r) => r.kind !== "hs") } };
  return { franchise: addNews(done, news), report };
}
