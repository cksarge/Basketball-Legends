// Road to Legend: the goal of every career. Legend points come from what's already saved in your seasons,
// so every career gets credit for what it has done, and the rank only ever reflects the record.
import type { Career, CareerStage, IsoDate, ScheduledGame } from "./types";
import { cumulativeGpa } from "./recruiting";

export type Pillar = "greatness" | "winning" | "moments" | "impact";
export const PILLARS: { id: Pillar; label: string; blurb: string }[] = [
  { id: "greatness", label: "Greatness", blurb: "Honors, stats and records" },
  { id: "winning", label: "Winning", blurb: "Championships and tournament runs" },
  { id: "moments", label: "Moments", blurb: "Big games you played yourself" },
  { id: "impact", label: "Impact", blurb: "Your community and the classroom" },
];

export const RANKS = ["Local Hero", "State Star", "National Name", "Pro", "All-Star", "Superstar", "Icon", "Legend"] as const;
export type LegendRank = (typeof RANKS)[number];
/** Points needed for each rank that points alone can reach. */
export const RANK_POINTS: Partial<Record<LegendRank, number>> = { "State Star": 30, "National Name": 90, "All-Star": 300, Superstar: 600, Icon: 1000 };
/** Career points an Icon must retire with to be named a Legend. Very few careers get here. */
export const LEGEND_BAR = 2000;
/** Points a top pro adds in a season, for the estimate shown to Icons. */
const ICON_SEASON_PACE = 130;
const ICON_RETIRE_AGE = 37;

export interface LegendEvent {
  date: IsoDate;
  pillar: Pillar;
  points: number;
  text: string;
}

/** Career scoring milestones and what they add. */
const SCORING_MARKS: [number, number][] = [
  [10_000, 10],
  [20_000, 25],
  [30_000, 50],
  [40_000, 100],
];

const AWARDS: [RegExp, Pillar, number][] = [
  // pros
  [/^Most Valuable Player/, "greatness", 120],
  [/^League champion/, "winning", 100],
  [/^Finals MVP/, "moments", 100],
  [/^All-League First Team/, "greatness", 50],
  [/^All-League Second Team/, "greatness", 30],
  [/^All-League Third Team/, "greatness", 20],
  [/^Defensive Player of the Year/, "greatness", 40],
  [/^All-Defensive Team/, "greatness", 10],
  [/^Scoring champion/, "greatness", 25],
  [/^Rookie of the Year/, "greatness", 20],
  [/^Sixth Man of the Year/, "greatness", 10],
  [/^Most Improved Player/, "greatness", 5],
  [/^All-Star Game MVP/, "moments", 5],
  [/^All-Star$/, "greatness", 15],
  [/^Three-Point Contest champion/, "moments", 3],
  [/^Dunk Contest champion/, "moments", 3],
  [/^Development League All-Star/, "greatness", 2],
  // college (checked first: these names are more specific)
  [/^National Player of the Year/, "greatness", 40],
  [/^(D2|D3) Player of the Year/, "greatness", 15],
  [/^All-American First/, "greatness", 25],
  [/^All-American Second/, "greatness", 15],
  [/^All-American Third/, "greatness", 10],
  [/^(D2|D3) All-American/, "greatness", 6],
  [/^Most Outstanding Player/, "moments", 20],
  [/^National champion/, "winning", 40],
  [/^(D2|D3) National champion/, "winning", 15],
  [/^National Invitational champion/, "winning", 8],
  [/Tournament champion$/, "winning", 5],
  [/regular-season champion$/, "winning", 5],
  [/Freshman of the Year$/, "greatness", 6],
  // high school
  [/^Open Division champion/, "winning", 15],
  [/State champion$/, "winning", 12],
  [/^Region champion/, "winning", 3],
  [/Region Player of the Year$/, "greatness", 5],
  [/^All-State .* First Team/, "greatness", 8],
  [/^All-State .* Second Team/, "greatness", 5],
  [/Region First Team$/, "greatness", 3],
  [/Region Second Team$/, "greatness", 2],
  [/^\dA Player of the Year/, "greatness", 12],
  // conference honors
  [/ Player of the Year$/, "greatness", 10],
  [/ First Team$/, "greatness", 8],
  [/ Second Team$/, "greatness", 5],
];

const awardEvent = (award: string, date: IsoDate): LegendEvent | null => {
  const hit = AWARDS.find(([re]) => re.test(award));
  return hit ? { date, pillar: hit[1], points: hit[2], text: award } : null;
};

/** Moments only come from games you played yourself, never from simulated ones. */
function gameMoments(games: ScheduledGame[], teamId: string): LegendEvent[] {
  const out: LegendEvent[] = [];
  for (const g of games) {
    const r = g.result;
    const line = r?.userLine;
    if (!r || !r.played || !line) continue;
    const won = (g.homeId === teamId) === r.home > r.away;
    if (line.pts >= 60) out.push({ date: g.date, pillar: "moments", points: 20, text: `${line.pts} points in a game` });
    else if (line.pts >= 50) out.push({ date: g.date, pillar: "moments", points: 10, text: `${line.pts} points in a game` });
    else if (line.pts >= 40) out.push({ date: g.date, pillar: "moments", points: 5, text: `${line.pts} points in a game` });
    else if (line.pts >= 30) out.push({ date: g.date, pillar: "moments", points: 2, text: `${line.pts} points in a game` });
    if (g.kind === "playoff" && won)
      out.push({ date: g.date, pillar: "moments", points: g.label?.startsWith("The Finals") ? 8 : 3, text: `Won ${g.label ?? "a playoff game"}` });
  }
  return out;
}

/** Everything that has counted toward your legacy so far, oldest first. */
export function legendEvents(c: Career): LegendEvent[] {
  const out: LegendEvent[] = [];
  for (const s of c.hs.seasons) {
    const end = `${s.year + 1}-03-15`;
    for (const a of s.awards) {
      const e = awardEvent(a, end);
      if (e) out.push(e);
    }
    out.push(...gameMoments(s.games, s.schoolId));
  }
  const stars = c.hs.seasons.at(-1)?.ranking?.stars ?? 0;
  if (stars >= 4 && c.hs.seasons.at(-1)?.grade === 12)
    out.push({ date: `${c.hs.seasons.at(-1)!.year + 1}-05-01`, pillar: "greatness", points: stars === 5 ? 10 : 5, text: `${stars}-star recruit` });
  const gpa = cumulativeGpa(c);
  if (gpa !== null && gpa >= 3.5 && c.stage !== "hs") out.push({ date: c.date, pillar: "impact", points: 3, text: `Graduated with a ${gpa.toFixed(2)} GPA` });
  for (const s of c.college?.seasons ?? []) {
    const end = `${s.year + 1}-04-10`;
    for (const a of s.awards) {
      const e = awardEvent(a, end);
      if (e) out.push(e);
    }
    out.push(...gameMoments(s.games, s.teamId));
    for (const g of s.games) {
      const won = g.result && (g.homeId === s.teamId) === g.result.home > g.result.away;
      if (g.kind === "playoff" && won && !g.result!.dnp && /National/.test(g.label ?? ""))
        out.push({ date: g.date, pillar: "winning", points: 3, text: `Won ${g.label}` });
    }
    for (const d of s.nil)
      if (d.kind === "community" && d.status === "signed")
        out.push({ date: `${s.year}-10-01`, pillar: "impact", points: 3, text: `${d.brand} with local kids` });
  }
  for (const e of c.street?.moments ?? []) out.push({ date: e.date, pillar: e.pillar, points: e.points, text: e.text });
  for (const e of c.story?.impact ?? []) out.push({ date: e.date, pillar: "impact", points: e.points, text: e.text });
  let scored = 0;
  for (const s of c.pro?.seasons ?? []) {
    const end = `${s.year + 1}-06-20`;
    for (const a of s.awards) {
      const e = awardEvent(a, end);
      if (e) out.push(e);
    }
    out.push(...gameMoments(s.games, s.teamId));
    const before = scored;
    scored += s.stats.pts;
    for (const [mark, points] of SCORING_MARKS)
      if (before < mark && scored >= mark) out.push({ date: end, pillar: "greatness", points, text: `${mark.toLocaleString("en-US")} career points` });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function legendPoints(events: LegendEvent[]) {
  const pillars: Record<Pillar, number> = { greatness: 0, winning: 0, moments: 0, impact: 0 };
  for (const e of events) pillars[e.pillar] += e.points;
  return { total: Object.values(pillars).reduce((a, b) => a + b, 0), pillars };
}

/**
 * The rank for a point total. Pro ranks need a pro career, and points alone never make a Legend:
 * that title is only decided at retirement, for a player who is already an Icon.
 */
export function rankFor(points: number, stage: CareerStage, legend = false, allStar = false): LegendRank {
  const pro = stage === "pro" || stage === "retired";
  if (pro && legend && points >= LEGEND_BAR) return "Legend";
  if (pro) {
    if (points >= RANK_POINTS.Icon!) return "Icon";
    if (points >= RANK_POINTS.Superstar!) return "Superstar";
    return points >= RANK_POINTS["All-Star"]! || allStar ? "All-Star" : "Pro";
  }
  if (points >= RANK_POINTS["National Name"]!) return "National Name";
  return points >= RANK_POINTS["State Star"]! ? "State Star" : "Local Hero";
}

/** The verdict at retirement: an Icon who cleared the bar. */
export const isLegend = (points: number) => points >= LEGEND_BAR;

/**
 * For Icons before they retire: the chance they'll be a Legend, from where they are, the seasons they likely have left,
 * and how sure that projection can be.
 */
export function legendChance(points: number, age: number) {
  const seasons = Math.max(0, ICON_RETIRE_AGE - age);
  const projected = points + seasons * ICON_SEASON_PACE;
  const spread = 60 + seasons * 22;
  const p = 1 / (1 + Math.exp(-(projected - LEGEND_BAR) / spread));
  return Math.max(1, Math.min(99, Math.round(p * 100)));
}

export interface LegendStatus {
  rank: LegendRank;
  points: number;
  pillars: Record<Pillar, number>;
  /** The next rank and the points it takes; null when the next step isn't a points target at this stage. */
  next: { rank: LegendRank; points: number } | null;
  /** Shown once you're an Icon and until you retire. */
  chance: number | null;
  events: LegendEvent[];
}

export function legendStatus(c: Career): LegendStatus {
  const events = legendEvents(c);
  const { total, pillars } = legendPoints(events);
  const retired = c.stage === "retired";
  const allStar = (c.pro?.seasons ?? []).some((s) => s.awards.includes("All-Star"));
  const rank = rankFor(total, c.stage, retired && isLegend(total), allStar);
  const after = RANKS[RANKS.indexOf(rank) + 1];
  const target = after ? RANK_POINTS[after] : undefined;
  const next = after && target !== undefined && total < target ? { rank: after, points: target } : null;
  return { rank, points: total, pillars, next, chance: rank === "Icon" && !retired ? legendChance(total, c.player.age) : null, events };
}
