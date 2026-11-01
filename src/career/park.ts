// Play in the Park inside a career: pickup runs in the off-season earn street reputation and XP,
// reputation opens new parks, league players drop in, and your rival calls you out.
import { generatePlayer, generateRoster, playerOvr } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { Player, Team } from "@/engine/types";
import { parkById } from "@/game/park/parks";
import { PARK_LADDER, nextUnlock, unlockedParks } from "@/game/park/unlocks";
import { simScore } from "@/game/park/line";
import { parkRegulars } from "@/game/park/regulars";
import { buildPark, pickCast, rulesFor } from "@/game/park/session";
import type { PendingMatch } from "@/state/matchStore";
import { DEFAULT_SETUP, type ParkSetup } from "@/state/parkStore";
import { currentCollege } from "./college/season";
import { currentSeason, withXp, type HsContext } from "./hs/season";
import { currentPro } from "./pro/season";
import { STORY_RATE } from "./story/rates";
import type { ActiveRun, Career, IsoDate, StreetState } from "./types";

export const RUNS_PER_WINDOW = 3;
const REP_NAME: [number, string][] = [
  [160, "Park royalty"],
  [110, "Street legend"],
  [60, "Known in every city"],
  [25, "Rising name"],
  [8, "Getting noticed"],
  [0, "New face"],
];
export const repName = (rep: number) => REP_NAME.find(([n]) => rep >= n)![1];

const blank = (): StreetState => ({ rep: 0, wins: 0, losses: 0, window: "", used: 0, regulars: {}, callouts: [], moments: [] });
export const streetOf = (c: Career): StreetState => c.street ?? blank();

export { PARK_LADDER, nextUnlock, unlockedParks };

/** The off-season you're in, if you can get to the park. Once you're retired, you can play whenever you like. */
export function runWindow(c: Career): string | null {
  if (c.stage === "retired") return "retired";
  if (c.stage === "pro") {
    const s = currentPro(c);
    if (s) return s.wrapped ? `pro-${s.year}` : null;
    return c.pro?.draft?.seen ? `pro-rookie` : null;
  }
  if (c.stage === "college") {
    const s = currentCollege(c);
    return s?.wrapped ? `col-${s.year}` : null;
  }
  const s = currentSeason(c);
  if (!s) return "hs-summer";
  if (!s.tryout) return `hs-pre-${s.year}`;
  return s.wrapped ? `hs-${s.year}` : null;
}

export function runsLeft(c: Career) {
  const w = runWindow(c);
  if (!w) return 0;
  if (w === "retired") return Infinity;
  const st = streetOf(c);
  return st.window === w ? Math.max(0, RUNS_PER_WINDOW - st.used) : RUNS_PER_WINDOW;
}

/** Whether your rival has called you out this off-season: not every summer, and more often with more story turned on. */
export function calloutOpen(c: Career) {
  const w = runWindow(c);
  if (!w || w === "retired" || !c.story) return false;
  if (streetOf(c).callouts.includes(w)) return false;
  return new Rng(`${c.seed}:callout:${w}`).chance(0.7 * STORY_RATE[c.settings.storyFrequency] + 0.1);
}

/** Your rival, in the flesh: about your level, and they've kept up with you. */
export function rivalPlayer(c: Career): Player {
  const r = c.story!.rival;
  const rng = new Rng(`${c.seed}:rival-player`);
  const year = new Rng(`${c.seed}:rival-form:${runWindow(c)}`);
  const p = generatePlayer(rng, {
    pos: r.pos as Player["pos"],
    targetOvr: clamp(playerOvr(c.player) + year.int(-4, 3), 30, 96),
    age: c.player.age,
    league: "pro",
    teamId: null,
    hometownPool: "az",
    idPrefix: "rival",
  });
  const [firstName, ...rest] = r.name.split(" ");
  return { ...p, id: "street-rival", firstName, lastName: rest.join(" "), age: c.player.age };
}

/** A known pro who shows up for a run: the best player on a random team. */
function dropInPlayer(ctx: HsContext, rng: Rng): Player | null {
  const pros = ctx.pros ?? [];
  if (!pros.length) return null;
  const t: Team = rng.pick(pros);
  const year = rng.int(2000, 2100);
  return [...generateRoster(t, year)].sort((a, b) => playerOvr(b) - playerOvr(a))[0];
}

export const DROP_IN_CHANCE = 0.25;

/** Sets up a run: the regulars at the park, sometimes with a pro in the other crew, or your rival one-on-one. */
export function startRun(
  c: Career,
  parkId: string,
  teamSize: number,
  kind: ActiveRun["kind"],
  ctx: HsContext,
  controller: string,
): { career: Career; pending: PendingMatch } | null {
  const st = streetOf(c);
  if (kind === "pickup" && (runsLeft(c) <= 0 || !unlockedParks(st.rep).includes(parkId))) return null;
  if (kind === "callout" && !calloutOpen(c)) return null;
  const count = st.wins + st.losses;
  const rng = new Rng(`${c.seed}:run:${count}:${parkId}`);
  const setup: ParkSetup = {
    ...DEFAULT_SETUP,
    parkId,
    teamSize: kind === "callout" ? 1 : teamSize,
    halfCourt: teamSize <= 3 || kind === "callout",
    target: kind === "callout" ? 11 : 15,
    you: c.player,
  };
  const cast = pickCast(setup, parkRegulars(parkById(parkId)), count + (c.seed % 1000));
  let dropIn: string | undefined;
  if (kind === "callout") cast.opps = [rivalPlayer(c)];
  else if (rng.chance(DROP_IN_CHANCE)) {
    const pro = dropInPlayer(ctx, rng);
    if (pro) {
      cast.opps = [pro, ...cast.opps.slice(1)];
      dropIn = `${pro.firstName} ${pro.lastName}`;
    }
  }
  const built = buildPark(setup, cast, controller, rng.int(1, 999_999)).pending;
  const pending: PendingMatch = {
    ...built,
    returnTo: `/career/hub/?id=${encodeURIComponent(c.id)}`,
    lockPlayerId: c.player.id,
    difficulty: c.settings.difficulty,
    careerRun: c.id,
  };
  const active: ActiveRun = { parkId, kind, oppIds: cast.opps.map((p) => p.id), ...(dropIn ? { dropIn } : {}) };
  return { career: { ...c, street: { ...st, active } }, pending };
}

const rungOf = (parkId: string) => Math.max(0, PARK_LADDER.findIndex((p) => p.parkId === parkId) - 1);

/** Records a finished run: reputation, XP, your record with the regulars, and any doors it opened. */
export function finishRun(c: Career, won: boolean, played: boolean, date: IsoDate = c.date): Career {
  const st = streetOf(c);
  const run = st.active;
  if (!run) return c;
  const w = runWindow(c) ?? st.window;
  const used = run.kind === "callout" ? (st.window === w ? st.used : 0) : (st.window === w ? st.used : 0) + 1;
  let gain = Math.round((won ? 6 : 2) * (1 + rungOf(run.parkId) * 0.5) * (played ? 1 : 0.5));
  const moments = [...st.moments];
  const entries: Career["log"] = [];
  const park = parkById(run.parkId).name;
  if (run.dropIn && won) {
    gain += 8;
    entries.push({ date, text: `Beat ${run.dropIn} at the park (${park}).`, kind: "story" });
    if (played) moments.push({ date, text: `Beat ${run.dropIn} at ${park}`, points: 3, pillar: "moments" });
  }
  if (run.kind === "callout" && won) {
    gain += 10;
    const rival = c.story?.rival.name ?? "your rival";
    entries.push({ date, text: `Beat ${rival} at the park (${park}).`, kind: "story" });
    if (played) moments.push({ date, text: `Beat ${rival} one-on-one at ${park}`, points: 2, pillar: "moments" });
  }
  const rep = st.rep + gain;
  for (const p of PARK_LADDER)
    if (st.rep < p.rep && rep >= p.rep) entries.push({ date, text: `Earned a run at ${parkById(p.parkId).name}.`, kind: "milestone" });
  const top = PARK_LADDER[PARK_LADDER.length - 1].rep;
  if (st.rep < top && rep >= top) moments.push({ date, text: "Known at every park in the country", points: 10, pillar: "impact" });
  const regulars = { ...st.regulars };
  for (const id of run.oppIds) {
    if (!id.startsWith("park-")) continue;
    const r = regulars[id] ?? { w: 0, l: 0 };
    regulars[id] = won ? { ...r, w: r.w + 1 } : { ...r, l: r.l + 1 };
  }
  const street: StreetState = {
    ...st,
    rep,
    wins: st.wins + (won ? 1 : 0),
    losses: st.losses + (won ? 0 : 1),
    window: w,
    used,
    regulars,
    moments,
    active: undefined,
    callouts: run.kind === "callout" ? [...st.callouts, w] : st.callouts,
  };
  const rival =
    run.kind === "callout" && c.story
      ? { ...c.story, rival: { ...c.story.rival, wins: c.story.rival.wins + (won ? 1 : 0), losses: c.story.rival.losses + (won ? 0 : 1) } }
      : c.story;
  const next: Career = { ...c, street, story: rival, log: [...c.log, ...entries] };
  return withXp(next, Math.round((won ? 40 : 15) * (played ? 1 : 0.5)), date);
}

/** Skips the game: the run is played out by the numbers, for half the reputation. */
export function simRun(c: Career, parkId: string, teamSize: number, kind: ActiveRun["kind"], ctx: HsContext): Career {
  const started = startRun(c, parkId, teamSize, kind, ctx, "keyboard");
  if (!started) return c;
  const { home, away, park } = started.pending;
  const avg = (ps: Player[]) => ps.reduce((a, p) => a + playerOvr(p), 0) / Math.max(1, ps.length);
  const rng = new Rng(`${c.seed}:simrun:${streetOf(c).wins + streetOf(c).losses}`);
  const [mine, theirs] = simScore(avg(home.roster), avg(away.roster), park!.rules ?? rulesFor(DEFAULT_SETUP), rng);
  return finishRun(started.career, mine > theirs, false);
}

/** Passing on a call-out costs you at the park. */
export function declineCallout(c: Career): Career {
  const w = runWindow(c);
  if (!w || !calloutOpen(c)) return c;
  const st = streetOf(c);
  return { ...c, street: { ...st, rep: Math.max(0, st.rep - 3), callouts: [...st.callouts, w] } };
}
