// The end of the road: career totals, the Hall of Legends, jerseys in the rafters, the Hall of Fame vote,
// your speech and the verdict on whether you became a Basketball Legend.
import { Rng } from "@/engine/rng";
import type { HsContext } from "../hs/season";
import { isLegend, legendStatus } from "../legend";
import type { Career, CareerTotals, IsoDate } from "../types";
import { currentPro } from "./season";

/** The greats of the game: invented players, there to chase. */
export const HALL_OF_LEGENDS: (CareerTotals & { name: string; era: string })[] = [
  { name: "Marcus Delacroix", era: "1985-2003", games: 1486, pts: 38210, reb: 7420, ast: 6130, rings: 6, mvps: 5, allStars: 15 },
  { name: "Theo Okafor-Hayes", era: "2001-2021", games: 1502, pts: 36880, reb: 10620, ast: 8410, rings: 4, mvps: 4, allStars: 18 },
  { name: "Roman Castellanos", era: "1975-1993", games: 1410, pts: 34110, reb: 13890, ast: 3020, rings: 5, mvps: 6, allStars: 16 },
  { name: "Dashiell Ward", era: "1996-2014", games: 1344, pts: 31990, reb: 5120, ast: 5530, rings: 5, mvps: 1, allStars: 16 },
  { name: "Isaiah Blackwood", era: "1966-1982", games: 1190, pts: 31420, reb: 15770, ast: 4330, rings: 3, mvps: 4, allStars: 14 },
  { name: "Cassius Reyes", era: "2009-2028", games: 1311, pts: 29850, reb: 5640, ast: 9110, rings: 4, mvps: 3, allStars: 12 },
  { name: "Lamar Whitfield", era: "1979-1992", games: 980, pts: 22140, reb: 6910, ast: 10640, rings: 5, mvps: 3, allStars: 12 },
  { name: "Viktor Sorensen", era: "1998-2019", games: 1477, pts: 30120, reb: 11280, ast: 3550, rings: 1, mvps: 1, allStars: 14 },
  { name: "Jerome Tolliver", era: "1990-2005", games: 1120, pts: 24560, reb: 12330, ast: 2610, rings: 2, mvps: 2, allStars: 11 },
  { name: "Anton Mbeki", era: "1999-2016", games: 1180, pts: 23710, reb: 13020, ast: 2980, rings: 5, mvps: 2, allStars: 14 },
];

export const NUMBER_RETIRED_SEASONS = 6;
/** Legend points a Hall of Fame ballot needs. */
export const HALL_OF_FAME_POINTS = 550;

export function careerTotals(c: Career): CareerTotals {
  const seasons = c.pro?.seasons ?? [];
  const t = { games: 0, pts: 0, reb: 0, ast: 0, rings: 0, mvps: 0, allStars: 0 };
  for (const s of seasons) {
    t.games += s.stats.gp;
    t.pts += s.stats.pts;
    t.reb += s.stats.oreb + s.stats.dreb;
    t.ast += s.stats.ast;
    if (s.awards.includes("League champion")) t.rings++;
    if (s.awards.includes("Most Valuable Player")) t.mvps++;
    if (s.awards.includes("All-Star")) t.allStars++;
  }
  return t;
}

export type HallKey = "pts" | "reb" | "ast" | "rings" | "mvps" | "allStars";
export const HALL_STATS: { key: HallKey; label: string }[] = [
  { key: "pts", label: "Points" },
  { key: "reb", label: "Rebounds" },
  { key: "ast", label: "Assists" },
  { key: "rings", label: "Championships" },
  { key: "mvps", label: "MVPs" },
  { key: "allStars", label: "All-Star selections" },
];

/** Where you'd stand on an all-time list (1 = first). */
export const allTimeRank = (t: CareerTotals, key: HallKey) => 1 + HALL_OF_LEGENDS.filter((h) => h[key] > t[key]).length;

/** Who's next on an all-time list, and how far off they are. */
export function nextToPass(t: CareerTotals, key: HallKey) {
  const ahead = HALL_OF_LEGENDS.filter((h) => h[key] > t[key]).sort((a, b) => a[key] - b[key])[0];
  return ahead ? { name: ahead.name, value: ahead[key], gap: ahead[key] - t[key] } : null;
}

export const canRetire = (c: Career) => {
  const s = currentPro(c);
  return !!s?.wrapped;
};

/** Teams and schools that retire your number: long, great runs at a pro team, and the honors that made you at the others. */
export function jerseysRetired(c: Career, ctx: HsContext): string[] {
  const out: string[] = [];
  const seasons = c.pro?.seasons ?? [];
  const byTeam = new Map<string, number>();
  for (const s of seasons.filter((x) => x.status === "standard")) byTeam.set(s.teamId, (byTeam.get(s.teamId) ?? 0) + 1);
  for (const [id, n] of byTeam) {
    const honored = seasons.some((s) => s.teamId === id && s.awards.some((a) => /Most Valuable|League champion|First Team/.test(a)));
    if (n >= NUMBER_RETIRED_SEASONS && honored) out.push(ctx.proById?.get(id)?.name ?? id);
  }
  const col = new Map<string, boolean>();
  for (const s of c.college?.seasons ?? [])
    col.set(s.teamId, !!col.get(s.teamId) || s.awards.some((a) => /All-American|National Player|National champion/.test(a)));
  for (const [id, honored] of col) if (honored) out.push(ctx.collegeById?.get(id)?.name ?? id);
  const hs = c.hs.seasons.some((s) => s.awards.some((a) => /champion$|Player of the Year|All-State/.test(a) && !/^Region champion/.test(a)));
  if (hs) out.push(ctx.byId.get(c.hs.schoolId)?.name ?? c.hs.schoolId);
  return out;
}

export const SPEECH_CHOICES = [
  { id: "family", label: "My family", text: "None of this happens without the people who drove me to every gym in Arizona." },
  { id: "teammates", label: "My teammates", text: "I got the headlines, but my teammates set the screens and made the extra pass for all those years." },
  { id: "doubters", label: "The people who doubted me", text: "Every coach who cut me and every scout who passed: thank you. You kept me in the gym." },
  { id: "kids", label: "The kids watching", text: "To the kid on a cracked court in the summer heat: it can be you. Keep shooting." },
] as const;

function writeSpeech(c: Career, choice: string, legend: boolean) {
  const line = SPEECH_CHOICES.find((s) => s.id === choice) ?? SPEECH_CHOICES[0];
  const rng = new Rng(`${c.seed}:speech`);
  const school = c.hs.seasons.at(-1) ? "high school" : "the park";
  const open =
    (c.story?.confident ?? 0) + (c.pro?.confidence ?? 0) > 0.2
      ? "I always told you I'd be standing here."
      : rng.pick(["I never thought I'd be standing here.", "I don't really know how to do this."]);
  const mentor = c.story?.mentor ? ` And to ${c.story.mentor}: you were right about me.` : "";
  const close = `${legend ? "They say legends never really leave. I'll see you at the park." : "I gave this game everything I had. Thank you."}${mentor}`;
  return `${open} I started as a kid from ${c.player.hometown} who just wanted to make the team in ${school}. ${line.text} ${close}`;
}

/** Hangs it up: the honors are decided, and an Icon past the bar is named a Legend. */
export function retire(c: Career, speech: string, ctx: HsContext): Career {
  if (!canRetire(c) || c.retirement) return c;
  const s = currentPro(c)!;
  const date: IsoDate = `${s.year + 1}-07-15`;
  const st = legendStatus(c);
  const legend = st.rank === "Icon" && isLegend(st.points);
  const retired: Career = { ...c, stage: "retired", date };
  const final = legendStatus(retired);
  const hallOfFame = st.points >= HALL_OF_FAME_POINTS;
  const jerseys = jerseysRetired(c, ctx);
  const name = `${c.player.firstName} ${c.player.lastName}`;
  return {
    ...retired,
    retirement: {
      date,
      age: c.player.age,
      totals: careerTotals(c),
      points: st.points,
      rank: final.rank,
      legend,
      hallOfFame,
      jerseys,
      speech: writeSpeech(c, speech, legend),
    },
    log: [
      ...c.log,
      { date, text: `Retired at ${c.player.age}.`, kind: "milestone" },
      ...jerseys.map((j) => ({ date, text: `${j} retired your number ${c.player.jersey}.`, kind: "award" as const })),
      ...(hallOfFame ? [{ date, text: "Elected to the Hall of Fame.", kind: "award" as const }] : []),
      ...(legend ? [{ date, text: `${name}: Basketball Legend.`, kind: "award" as const }] : []),
    ],
  };
}
