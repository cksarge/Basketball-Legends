// Where a career begins: high school by default, or skip ahead to college or the pros with a player of that level.
import { overall } from "@/engine/player";
import type { RatingKey, Ratings } from "@/engine/types";
import { enterCollege } from "./college/season";
import type { HsContext } from "./hs/season";
import type { Career, ProCareer } from "./types";

export type StartAt = "hs" | "college" | "pro";
export const START_OPTIONS: { value: StartAt; label: string; blurb: string }[] = [
  { value: "hs", label: "High school", blurb: "The full road: tryouts, recruiting and every step from freshman year. The most time to build a legacy." },
  { value: "college", label: "College", blurb: "Start as a college freshman at the program of your choice." },
  { value: "pro", label: "The pros", blurb: "Start as a rookie. Go through the draft, or pick your team. The least time to become a Legend." },
];
/** The overall you start with at each level. */
export const START_OVR = { college: 66, pro: 76 } as const;

/** Grows every rating the same share of the way to its cap until the player reaches an overall. */
export function grownRatings(c: Career, target: number): Ratings {
  const { ratings, caps, pos } = c.player;
  const at = (t: number) => {
    const r = { ...ratings };
    for (const k of Object.keys(r) as RatingKey[]) r[k] = Math.round(ratings[k] + (Math.max(ratings[k], caps[k]) - ratings[k]) * t);
    return r;
  };
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (overall(at(mid), pos) < target) lo = mid;
    else hi = mid;
  }
  return at(hi);
}

const stageLog = (c: Career, date: string, text: string): Career => ({ ...c, date, inbox: [], log: [{ date, text, kind: "milestone" }] });

/** A college freshman at the program you picked, on scholarship or as a walk-on. */
export function startInCollege(c: Career, teamId: string, walkOn: boolean, ctx: HsContext, year: number): Career {
  const team = ctx.collegeById?.get(teamId);
  if (!team) return c;
  const date = `${year}-05-28`;
  const ready: Career = {
    ...stageLog(c, date, `${c.player.firstName} ${c.player.lastName} starts at ${team.name}.`),
    startYear: year - 4,
    player: { ...c.player, ratings: grownRatings(c, START_OVR.college), age: 17, birthYear: year - 17, classYear: "SR", devDate: `${year}-08-20` },
    recruiting: { offers: [], visitsUsed: 0, visitsAllowed: 5, college: { teamId, walkOn, date } },
  };
  return enterCollege(ready, ctx);
}

/** A rookie: heading into the draft, or already on the team you picked. */
export function startInPros(c: Career, teamId: string | null, ctx: HsContext, year: number): Career {
  const team = teamId ? ctx.proById?.get(teamId) : undefined;
  if (teamId && !team) return c;
  const date = `${year}-04-25`;
  const ratings = grownRatings(c, START_OVR.pro);
  const pro: ProCareer = {
    preDraft: { year, workouts: [], interviews: [], stockDelta: 0, ...(team ? { agent: "family" as const } : {}) },
    confidence: 0,
    teamFirst: 0,
    earnings: 0,
    seasons: [],
    endorsements: [],
    ...(team ? { skipDraft: true, status: "standard" as const } : {}),
  };
  const name = `${c.player.firstName} ${c.player.lastName}`;
  const score = START_OVR.pro + 4.5;
  return {
    ...stageLog(c, date, team ? `${name} starts as a rookie with ${team.name}.` : `${name} starts the road to the draft.`),
    stage: "pro",
    startYear: year - 6,
    player: {
      ...c.player,
      ratings,
      age: 20,
      birthYear: year - 20,
      classYear: undefined,
      devDate: `${year}-09-28`,
      teamId: team?.id ?? null,
      contract: team ? { salary: 3_000_000, years: 3, rookie: true } : undefined,
    },
    college: { seasons: [], earnings: 0, declared: { date, stock: { pick: Math.round(1 + (85 - score) * 5), label: "First-round pick", score } } },
    pro,
  };
}

/** Starts a career at the chosen level. */
export function applyStart(
  c: Career,
  at: StartAt,
  o: { collegeId?: string; walkOn?: boolean; proTeamId?: string | null },
  ctx: HsContext,
  year = +c.date.slice(0, 4),
): Career {
  if (at === "college" && o.collegeId) return startInCollege(c, o.collegeId, !!o.walkOn, ctx, year);
  if (at === "pro") return startInPros(c, o.proTeamId ?? null, ctx, year);
  return c;
}
