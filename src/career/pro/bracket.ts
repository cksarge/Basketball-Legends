// The pro playoff bracket: play-in, three conference rounds and the Finals. Shared by careers and franchises.
import { addDays, proCalendar } from "../calendar";
import { standings } from "../hs/sim";
import type { IsoDate, ProSeries, ScheduledGame } from "../types";

export interface BracketInput {
  year: number;
  games: ScheduledGame[];
  series: ProSeries[];
  /** Team ids in conference order, best first. */
  seeds: (conf: "East" | "West") => string[];
  /** Franchise league settings. With none, a play-in and best of seven throughout. */
  format?: { firstRoundBestOf: number; playIn: boolean };
}

const ROUND_NAME = ["Play-In", "First Round", "Semifinals", "Conference Finals", "Finals"];
export const roundStart = (year: number, round: number) => addDays(proCalendar(year).playoffs, (round - 1) * 15);

export function makeSeries(
  id: string,
  conf: ProSeries["conf"],
  round: number,
  high: string,
  low: string,
  bestOf: number,
  start: IsoDate,
  label?: string,
): ProSeries {
  return { id, conf, round, label: label ?? (conf === "Finals" ? "The Finals" : `${conf} ${ROUND_NAME[round]}`), high, low, bestOf, start, games: [] };
}

export const seriesWins = (x: ProSeries, byId: Map<string, ScheduledGame>) => {
  let high = 0,
    low = 0;
  for (const id of x.games) {
    const r = byId.get(id)?.result;
    if (!r) continue;
    const g = byId.get(id)!;
    const homeWon = r.home > r.away;
    if ((g.homeId === x.high) === homeWon) high++;
    else low++;
  }
  return { high, low };
};
export const seriesScore = (x: ProSeries, games: ScheduledGame[]) => seriesWins(x, new Map(games.map((g) => [g.id, g])));

/** Creates each round's series as the last one finishes. */
export function nextSeries(s: BracketInput): ProSeries[] {
  const out: ProSeries[] = [];
  const has = (id: string) => s.series.some((x) => x.id === id);
  const get = (id: string) => s.series.find((x) => x.id === id);
  const year = s.year;
  const seeds = s.seeds;
  const firstRound = s.format?.firstRoundBestOf ?? 7;
  const noPlayIn = s.format?.playIn === false;
  if (!s.series.length) {
    for (const conf of ["East", "West"] as const) {
      const t = seeds(conf);
      if (noPlayIn) {
        const pairs = [
          [t[0], t[7]],
          [t[3], t[4]],
          [t[2], t[5]],
          [t[1], t[6]],
        ];
        pairs.forEach(([h, l], i) => out.push(makeSeries(`${conf}-r1-${i}`, conf, 1, h, l, firstRound, roundStart(year, 1))));
        continue;
      }
      const cal = proCalendar(year);
      out.push(makeSeries(`${conf}-pi1`, conf, 0, t[6], t[7], 1, cal.playIn, `${conf} Play-In (7 vs 8)`));
      out.push(makeSeries(`${conf}-pi2`, conf, 0, t[8], t[9], 1, cal.playIn, `${conf} Play-In (9 vs 10)`));
    }
    return out;
  }
  for (const conf of ["East", "West"] as const) {
    const a = get(`${conf}-pi1`),
      b = get(`${conf}-pi2`);
    if (a?.winner && b?.winner && !has(`${conf}-pi3`)) {
      const loser = a.winner === a.high ? a.low : a.high;
      out.push(makeSeries(`${conf}-pi3`, conf, 0, loser, b.winner, 1, addDays(proCalendar(year).playIn, 2), `${conf} Play-In (final spot)`));
    }
    const c = get(`${conf}-pi3`);
    if (c?.winner && a?.winner && !has(`${conf}-r1-0`)) {
      const t = seeds(conf);
      const pairs = [
        [t[0], c.winner],
        [t[3], t[4]],
        [t[2], t[5]],
        [t[1], a.winner],
      ];
      pairs.forEach(([h, l], i) => out.push(makeSeries(`${conf}-r1-${i}`, conf, 1, h, l, firstRound, roundStart(year, 1))));
    }
    for (const round of [2, 3]) {
      const prev = s.series.filter((x) => x.conf === conf && x.round === round - 1);
      if (prev.length && prev.every((x) => x.winner) && !has(`${conf}-r${round}-0`)) {
        const order = new Map(seeds(conf).map((id, i) => [id, i]));
        for (let i = 0; i < prev.length; i += 2) {
          const [p, q] = [prev[i].winner!, prev[i + 1].winner!];
          const [h, l] = order.get(p)! <= order.get(q)! ? [p, q] : [q, p];
          out.push(makeSeries(`${conf}-r${round}-${i / 2}`, conf, round, h, l, 7, roundStart(year, round)));
        }
      }
    }
  }
  const e = get("East-r3-0"),
    w = get("West-r3-0");
  if (e?.winner && w?.winner && !has("finals")) {
    const st = standings(
      s.games.filter((g) => g.kind === "region"),
      [e.winner, w.winner],
    );
    const [h, l] = st.get(e.winner)!.w >= st.get(w.winner)!.w ? [e.winner, w.winner] : [w.winner, e.winner];
    out.push(makeSeries("finals", "Finals", 4, h, l, 7, roundStart(year, 4)));
  }
  return out;
}
