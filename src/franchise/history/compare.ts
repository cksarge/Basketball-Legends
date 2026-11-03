// Side-by-side comparison of two players, or a player and a Hall of Famer, or two teams.
import { fullName, playerOvr } from "@/engine/player";
import type { Player, Team } from "@/engine/types";
import { reb } from "@/game/sim/stats";
import { moneyM, payroll } from "../pro/cap";
import { isUnknown, shownOvr } from "../pro/scouting";
import type { Franchise, HallEntry } from "../types";
import { powerRankings } from "./power";

export interface CompareRow {
  label: string;
  a: string;
  b: string;
  better: "a" | "b" | null;
}

type Side = Player | HallEntry;
const isHall = (x: Side): x is HallEntry => "career" in x && "score" in x;
const DASH = "-";

/** A number for each side, or null where it can't be compared. Higher is better unless `lower` is set. */
function row(label: string, a: number | null, b: number | null, show: (n: number) => string, lower = false, shown?: [string, string]): CompareRow {
  const better = a === null || b === null || a === b ? null : a > b !== lower ? "a" : "b";
  return { label, a: shown?.[0] ?? (a === null ? DASH : show(a)), b: shown?.[1] ?? (b === null ? DASH : show(b)), better };
}

const perGame = (f: Franchise, x: Side, stat: "pts" | "reb" | "ast") => {
  if (isHall(x)) return x.career.gp ? x.career[stat] / x.career.gp : null;
  const l = f.season.stats[x.id];
  if (!l?.gp) return null;
  return (stat === "reb" ? reb(l) : l[stat]) / l.gp;
};

const nameOf = (x: Side) => (isHall(x) ? x.name : fullName(x));

export function compareRows(a: Side, b: Side, f: Franchise): CompareRow[] {
  const ovr = (x: Side) => (isHall(x) || isUnknown(x) ? null : playerOvr(x));
  const ovrText = (x: Side) => (isHall(x) ? DASH : shownOvr(x));
  const pot = (x: Side) => (isHall(x) || isUnknown(x) ? null : x.potential);
  const potText = (x: Side) => (isHall(x) ? DASH : x.file?.range ? x.file.range.pot.join("-") : String(x.potential));
  const career = (x: Side) => (isHall(x) ? x.career : x.file?.career);
  const one = (n: number) => n.toFixed(1);
  const whole = (n: number) => Math.round(n).toLocaleString("en-US");
  return [
    { label: "Name", a: nameOf(a), b: nameOf(b), better: null },
    row("Overall", ovr(a), ovr(b), whole, false, [ovrText(a), ovrText(b)]),
    row("Potential", pot(a), pot(b), whole, false, [potText(a), potText(b)]),
    row("Age", isHall(a) ? null : a.age, isHall(b) ? null : b.age, whole, true),
    row("Points per game", perGame(f, a, "pts"), perGame(f, b, "pts"), one),
    row("Rebounds per game", perGame(f, a, "reb"), perGame(f, b, "reb"), one),
    row("Assists per game", perGame(f, a, "ast"), perGame(f, b, "ast"), one),
    row("Career points", career(a)?.pts ?? 0, career(b)?.pts ?? 0, whole),
    row("Seasons", career(a)?.seasons ?? 0, career(b)?.seasons ?? 0, whole),
    row("Honors", (isHall(a) ? a.awards : a.file?.awards) ?? 0, (isHall(b) ? b.awards : b.file?.awards) ?? 0, whole),
    row("Titles", (isHall(a) ? a.titles : a.file?.titles) ?? 0, (isHall(b) ? b.titles : b.file?.titles) ?? 0, whole),
    row("Salary", isHall(a) ? null : (a.contract?.salary ?? null), isHall(b) ? null : (b.contract?.salary ?? null), moneyM, true),
  ];
}

export function compareTeams(f: Franchise, a: string, b: string, teams: Team[]): CompareRow[] {
  const record = (id: string) => {
    let w = 0,
      l = 0;
    for (const g of f.season.games) {
      if (!g.result || g.kind !== "region" || (g.homeId !== id && g.awayId !== id)) continue;
      if (g.result.home > g.result.away === (g.homeId === id)) w++;
      else l++;
    }
    return { w, l };
  };
  const share = (id: string) => {
    const r = record(id);
    return r.w + r.l ? r.w / (r.w + r.l) : null;
  };
  const top8 = (id: string) => {
    const top = f.rosters[id]
      .map((p) => playerOvr(f.players[p]))
      .sort((x, y) => y - x)
      .slice(0, 8);
    return top.reduce((s, n) => s + n, 0) / Math.max(1, top.length);
  };
  const firsts = (id: string) => f.picks.filter((p) => p.ownerId === id && p.round === 1).length;
  const power = powerRankings(f);
  const rank = (id: string) => power.find((r) => r.teamId === id)!.rank;
  const recordText = (id: string) => `${record(id).w}-${record(id).l}`;
  return [
    { label: "Team", a: teams.find((t) => t.id === a)?.name ?? a, b: teams.find((t) => t.id === b)?.name ?? b, better: null },
    row("Record", share(a), share(b), () => "", false, [recordText(a), recordText(b)]),
    row("Power rank", rank(a), rank(b), String, true),
    row("Top eight", top8(a), top8(b), (n) => n.toFixed(1)),
    row("Payroll", payroll(f, a), payroll(f, b), moneyM, true),
    row("First-round picks", firsts(a), firsts(b), String),
  ];
}
