// Box score accumulation shared by the real-time match and the instant sim.

export interface StatLine {
  min: number; // seconds played
  pts: number;
  fgm: number; fga: number;
  tpm: number; tpa: number;
  ftm: number; fta: number;
  oreb: number; dreb: number;
  ast: number; stl: number; blk: number; tov: number; pf: number;
  plusMinus: number;
  dunks: number;
}

export const emptyLine = (): StatLine => ({
  min: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0,
  ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, plusMinus: 0, dunks: 0,
});

export type BoxScore = Record<string, StatLine>; // player id -> line

export function addLine(a: StatLine, b: StatLine): StatLine {
  const o = emptyLine();
  for (const k of Object.keys(o) as (keyof StatLine)[]) o[k] = a[k] + b[k];
  return o;
}

export function teamTotals(box: BoxScore, ids: string[]): StatLine {
  return ids.reduce((acc, id) => (box[id] ? addLine(acc, box[id]) : acc), emptyLine());
}

export const reb = (s: StatLine) => s.oreb + s.dreb;
export const pct = (m: number, a: number) => (a ? (m / a) * 100 : 0);
export const fmtPct = (m: number, a: number) => (a ? `${((m / a) * 100).toFixed(1)}%` : "-");
export const fmtMin = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Simple game score for player-of-the-game selection. */
export function gameScore(s: StatLine) {
  return s.pts + 0.4 * s.fgm - 0.7 * s.fga - 0.4 * (s.fta - s.ftm) + 0.7 * s.oreb + 0.3 * s.dreb + s.stl + 0.7 * s.ast + 0.7 * s.blk - 0.4 * s.pf - s.tov;
}
