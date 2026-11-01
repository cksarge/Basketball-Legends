// From declaring to draft night: choosing an agent, the combine, team workouts, GM interviews,
// a two-round draft with trades, and the two-way or development league path for undrafted players.
import { generatePlayer, playerOvr, teamTalentTarget } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { Contract, Position, Ratings, Team } from "@/engine/types";
import { draftCalendar } from "../calendar";
import { currentCollege, draftStock } from "../college/season";
import type { AgentId, Career, CareerLogEntry, DraftNight, DraftPick, InboxMessage, IsoDate, PreDraft, ProCareer } from "../types";

export const AGENTS: { id: AgentId; name: string; fee: number; pitch: string; contractBoost: number; endorsementBoost: number }[] = [
  { id: "shark", name: "Dana Sharpe", fee: 0.05, contractBoost: 0.08, endorsementBoost: 0, pitch: "A hard negotiator. Bigger contracts, the top fee." },
  {
    id: "brand",
    name: "Morgan Vale",
    fee: 0.04,
    contractBoost: 0,
    endorsementBoost: 0.35,
    pitch: "Connected with every brand in the country. Better endorsements.",
  },
  { id: "family", name: "Sam Ortega", fee: 0.02, contractBoost: 0, endorsementBoost: 0, pitch: "An old family friend. Keeps more money in your pocket." },
];
export const agentById = (id: AgentId | undefined) => AGENTS.find((a) => a.id === id) ?? AGENTS[2];

export const WORKOUTS_ALLOWED = 3;
export const DRAFT_PICKS = 60;

export interface InterviewAnswer {
  text: string;
  stock: number;
  confidence: number;
  teamFirst: number;
  reply: string;
}
export const INTERVIEWS: { q: string; a: InterviewAnswer[] }[] = [
  {
    q: "Why should we take you over the other players on our board?",
    a: [
      { text: "Because I'll outwork every one of them.", stock: 0.6, confidence: 0, teamFirst: 0.1, reply: "The room liked that." },
      {
        text: "I'm the best player in this draft. It isn't close.",
        stock: 0.2,
        confidence: 0.3,
        teamFirst: -0.2,
        reply: "A few eyebrows went up, but one GM smiled.",
      },
      { text: "I'll do whatever this team needs to win.", stock: 0.4, confidence: -0.1, teamFirst: 0.3, reply: "Solid answer. The coach nodded." },
    ],
  },
  {
    q: "We've got a veteran at your position. What if you come off the bench?",
    a: [
      { text: "I'd learn everything I can and earn the job.", stock: 0.5, confidence: -0.1, teamFirst: 0.3, reply: "Exactly what they hoped to hear." },
      { text: "Bench? I'm taking that job by Christmas.", stock: 0.3, confidence: 0.3, teamFirst: -0.1, reply: "They wrote that one down." },
      {
        text: "I'd want to talk about my role before I signed anything.",
        stock: -0.4,
        confidence: 0.1,
        teamFirst: -0.3,
        reply: "The room got a little colder.",
      },
    ],
  },
  {
    q: "Tell us about the worst game you ever played.",
    a: [
      { text: "I walked through it, and I went back to the gym that night.", stock: 0.5, confidence: 0, teamFirst: 0.1, reply: "They respected the honesty." },
      { text: "I don't really have one.", stock: -0.3, confidence: 0.2, teamFirst: -0.1, reply: "Nobody believed that." },
      {
        text: "We lost because I forced it. I trust my teammates more now.",
        stock: 0.6,
        confidence: -0.1,
        teamFirst: 0.3,
        reply: "The GM leaned in. Good answer.",
      },
    ],
  },
];

const msg = (date: IsoDate, from: string, subject: string, body: string): InboxMessage => ({
  id: `m-${date}-${Math.random().toString(36).slice(2, 8)}`,
  date,
  from,
  subject,
  body,
  read: false,
});
const log = (date: IsoDate, text: string, kind: CareerLogEntry["kind"] = "milestone"): CareerLogEntry => ({ date, text, kind });

const withPro = (c: Career, pro: Partial<ProCareer>): Career => ({ ...c, pro: { ...c.pro!, ...pro } });
const withPre = (c: Career, pre: Partial<PreDraft>): Career => withPro(c, { preDraft: { ...c.pro!.preDraft, ...pre } });

/** Starts the pre-draft process for a player who has declared. */
export function enterPreDraft(c: Career): Career {
  if (c.pro || !c.college?.declared) return c;
  const s = currentCollege(c)!;
  const year = s.year + 1;
  const pro: ProCareer = {
    preDraft: { year, workouts: [], interviews: [], stockDelta: 0 },
    confidence: 0,
    teamFirst: 0,
    earnings: 0,
    seasons: [],
    endorsements: [],
  };
  const date = `${year}-04-25`;
  return {
    ...c,
    stage: "pro",
    date: date > c.date ? date : c.date,
    pro,
    log: [...c.log, log(date, "Left school to start the road to the draft.")],
  };
}

export function chooseAgent(c: Career, id: AgentId): Career {
  const a = AGENTS.find((x) => x.id === id);
  if (!a || c.pro?.preDraft.agent) return c;
  const next = withPre(c, { agent: id });
  return { ...next, log: [...next.log, log(c.date, `Signed with agent ${a.name}.`)] };
}

/** Combine numbers come from your body and ratings, and the drills add what you showed on the day. */
export function runCombine(c: Career, scores: number[], bonus: number): Career {
  const pre = c.pro!.preDraft;
  if (pre.combine) return c;
  const r: Ratings = c.player.ratings;
  const rng = new Rng(`${c.seed}:combine`);
  const [shot = 0.5, agility = 0.5, burst = 0.5] = scores;
  const combine = {
    scores,
    bonus,
    verticalIn: Math.round((22 + r.vertical * 0.17 + burst * 3 + rng.range(-1, 1)) * 2) / 2,
    laneSec: Math.round((12.4 - r.speed * 0.016 - agility * 0.4 + rng.range(-0.1, 0.1)) * 100) / 100,
    threesMade: Math.round(clamp(5 + r.three * 0.11 + shot * 7, 0, 25)),
  };
  const date = draftCalendar(pre.year).combine;
  const next = withPre({ ...c, date: date > c.date ? date : c.date }, { combine, stockDelta: pre.stockDelta + bonus * 0.35 });
  return {
    ...next,
    log: [...next.log, log(date, `Combine: ${combine.verticalIn}" vertical, ${combine.laneSec}s lane agility, ${combine.threesMade}/25 threes.`)],
  };
}

/** The teams picking around your projected spot, who ask you in for a workout. */
export function workoutTeams(c: Career, teams: Team[]): Team[] {
  const stock = currentStock(c);
  const order = draftOrder(teams, c.pro!.preDraft.year, c.seed);
  const spot = clamp(stock.pick - 1, 0, 29);
  const near = Array.from({ length: 8 }, (_, i) => order[clamp(spot, 4, 25) - 4 + i]);
  return near.filter((t) => !c.pro!.preDraft.workouts.some((w) => w.teamId === t.id));
}

/** A private workout: mostly your overall against what they need, with a good or a bad day mixed in. */
export function workOut(c: Career, teamId: string, teams: Team[]): Career {
  const pre = c.pro!.preDraft;
  const team = teams.find((t) => t.id === teamId);
  if (!team || pre.workouts.length >= WORKOUTS_ALLOWED || pre.workouts.some((w) => w.teamId === teamId)) return c;
  const rng = new Rng(`${c.seed}:workout:${teamId}`);
  const grade = Math.round(clamp((playerOvr(c.player) - 68 + rng.normal(0, 4)) * 0.3, -3, 3) * 10) / 10;
  const note =
    grade >= 2
      ? "You lit it up. They want you."
      : grade >= 0.5
        ? "A solid workout. They left impressed."
        : grade > -1
          ? "Nothing special either way."
          : "A rough day. You could tell they were disappointed.";
  const date = draftCalendar(pre.year).workouts;
  const next = withPre(
    { ...c, date: date > c.date ? date : c.date },
    { workouts: [...pre.workouts, { teamId, grade, note }], stockDelta: pre.stockDelta + grade * 0.1 },
  );
  return { ...next, log: [...next.log, log(date, `Worked out for ${team.name}.`)] };
}

export function answerInterview(c: Career, answer: number): Career {
  const pre = c.pro!.preDraft;
  const q = INTERVIEWS[pre.interviews.length];
  const a = q?.a[answer];
  if (!a) return c;
  const date = draftCalendar(pre.year).interviews;
  const next = withPre({ ...c, date: date > c.date ? date : c.date }, { interviews: [...pre.interviews, answer], stockDelta: pre.stockDelta + a.stock });
  return withPro(next, { confidence: clamp(next.pro!.confidence + a.confidence, -1, 1), teamFirst: clamp(next.pro!.teamFirst + a.teamFirst, -1, 1) });
}

/** Your draft stock with everything from the pre-draft process folded in. */
export function currentStock(c: Career) {
  const base = c.college?.declared?.stock ?? draftStock(c);
  const score = base.score + (c.pro?.preDraft.stockDelta ?? 0);
  const pick = Math.max(1, Math.round(1 + (85 - score) * 5));
  const label =
    pick <= 5 ? "Top-five pick" : pick <= 14 ? "Lottery pick" : pick <= 30 ? "First-round pick" : pick <= 60 ? "Second-round pick" : "Likely undrafted";
  return { pick, label, score };
}

/** Worst teams pick first; the lottery shuffles the top four. */
export function draftOrder(teams: Team[], year: number, seed: number | string): Team[] {
  const rng = new Rng(`draft-order:${seed}:${year}`);
  const order = teams
    .map((t) => ({ t, k: teamTalentTarget(t) + rng.normal(0, 2.5) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.t);
  return [...rng.shuffle(order.slice(0, 4)), ...order.slice(4)];
}

/** Everyone on the board besides you, best first (their score lines up with pick numbers). */
function prospects(year: number, seed: number | string) {
  const rng = new Rng(`draft-class:${seed}:${year}`);
  const slots: Position[] = ["PG", "SG", "SF", "PF", "C"];
  return Array.from({ length: DRAFT_PICKS + 10 }, (_, i) => {
    const score = 85 - i / 5 + rng.normal(0, 0.5);
    const p = generatePlayer(rng, {
      pos: rng.pick(slots),
      targetOvr: Math.round(score - 8 + rng.normal(0, 2)),
      age: rng.int(19, 22),
      league: "college",
      teamId: "",
      idPrefix: `draft-${year}`,
    });
    return { name: `${p.firstName} ${p.lastName}`, pos: p.pos as string, ovr: playerOvr(p), score, user: false };
  });
}

const THROUGH = ["for a future first-round pick", "for two second-round picks", "for a veteran and a future second", "for cash and a future second"];

/** Runs the whole draft: each team takes the best player left, shaded by its own board and how you did in a workout there. */
export function runDraft(c: Career, teams: Team[]): Career {
  const pre = c.pro!.preDraft;
  if (c.pro!.draft) return c;
  const rng = new Rng(`${c.seed}:draft:${pre.year}`);
  const order = draftOrder(teams, pre.year, c.seed);
  const name = (id: string) => teams.find((t) => t.id === id)!.name;
  const owners = [...order, ...order].map((t) => t.id);
  const originals = [...owners];
  const trades: string[] = [];
  for (let i = 0; i < 5; i++) {
    const slot = rng.int(3, 50);
    const buyer = rng.pick(order).id;
    if (buyer === owners[slot]) continue;
    trades.push(`${name(buyer)} trade up with ${name(owners[slot])} for pick ${slot + 1}, ${rng.pick(THROUGH)}.`);
    owners[slot] = buyer;
  }
  const board = prospects(pre.year, c.seed);
  const stock = currentStock(c);
  const you = { name: `${c.player.firstName} ${c.player.lastName}`, pos: c.player.pos as string, ovr: playerOvr(c.player), score: stock.score, user: true };
  const left = [...board, you].sort((a, b) => b.score - a.score);
  const picks: DraftPick[] = [];
  for (let i = 0; i < DRAFT_PICKS; i++) {
    const teamId = owners[i];
    const shade = (p: (typeof left)[number]) => p.score + rng.normal(0, 0.6) + (p.user ? (pre.workouts.find((w) => w.teamId === teamId)?.grade ?? 0) : 0);
    const chosen = left.slice(0, 6).reduce((best, p) => (shade(p) > shade(best) ? p : best));
    left.splice(left.indexOf(chosen), 1);
    picks.push({
      round: i < 30 ? 1 : 2,
      pick: i + 1,
      teamId,
      ...(owners[i] !== originals[i] ? { via: originals[i] } : {}),
      name: chosen.name,
      pos: chosen.pos,
      ovr: chosen.ovr,
      ...(chosen.user ? { isUser: true } : {}),
    });
  }
  const mine = picks.find((p) => p.isUser);
  // sometimes the team that drafts you was picking for someone else
  const tradedTo = mine && rng.chance(0.1) ? rng.pick(order.filter((t) => t.id !== mine.teamId)).id : undefined;
  const draft: DraftNight = { year: pre.year, picks, trades, ...(tradedTo ? { tradedTo } : {}), teamId: mine ? (tradedTo ?? mine.teamId) : null };
  return withPro({ ...c, date: draftCalendar(pre.year).draft }, { draft });
}

/** The rookie deal for a pick: the scale slides down the first round, and second-rounders sign small two-year deals. */
export function rookieContract(pick: number): Contract {
  if (pick > 30) return { salary: 1_300_000 - (pick - 31) * 4_000, years: 2, rookie: true };
  return { salary: Math.round(12_500_000 * Math.pow(0.937, pick - 1)), years: 4, rookie: true };
}

/** Called after you've seen the draft through: your contract, your team, or your options if nobody called. */
export function finishDraft(c: Career, teams: Team[]): Career {
  const d = c.pro?.draft;
  if (!d || d.seen) return c;
  const date = draftCalendar(d.year).draft;
  const mine = d.picks.find((p) => p.isUser);
  if (mine && d.teamId) {
    const team = teams.find((t) => t.id === d.teamId)!;
    const contract = rookieContract(mine.pick);
    const by = d.tradedTo ? `, then traded to ${team.name}` : ` by ${team.name}`;
    return {
      ...withPro(c, { draft: { ...d, seen: true }, status: "standard" }),
      player: { ...c.player, teamId: team.id, contract },
      log: [...c.log, log(date, `Drafted ${ordinal(mine.pick)} overall${by}.`)],
      inbox: [
        ...c.inbox,
        msg(
          date,
          team.name,
          "Welcome to the team",
          `We're thrilled to have you. Your rookie deal is ${contract.years} years at $${contract.salary.toLocaleString("en-US")} a season.`,
        ),
      ],
    };
  }
  const rng = new Rng(`${c.seed}:undrafted`);
  const stock = currentStock(c);
  const offers = stock.pick <= 80 ? rng.shuffle(teams.map((t) => t.id)).slice(0, 2) : [];
  return {
    ...withPro(c, { draft: { ...d, seen: true }, undraftedOffers: offers }),
    log: [...c.log, log(date, "Went undrafted.")],
    inbox: [
      ...c.inbox,
      msg(
        date,
        agentById(c.pro!.preDraft.agent).name,
        "Tonight wasn't the end",
        offers.length
          ? "Two teams called about a two-way deal. There's also the development league."
          : "The development league will give you a real shot. Show them they missed.",
      ),
    ],
  };
}

/** A two-way deal splits your year between a pro team and its development affiliate. */
export function signTwoWay(c: Career, teamId: string, teams: Team[]): Career {
  const team = teams.find((t) => t.id === teamId);
  if (!team || !c.pro?.undraftedOffers?.includes(teamId)) return c;
  return {
    ...withPro(c, { status: "twoWay", undraftedOffers: undefined }),
    player: { ...c.player, teamId, contract: { salary: 580_000, years: 1, twoWay: true } },
    log: [...c.log, log(c.date, `Signed a two-way contract with ${team.name}.`)],
  };
}

/** Joining a development league team: pick the affiliate of any pro team. */
export function joinDevLeague(c: Career, teamId: string, teams: Team[]): Career {
  const team = teams.find((t) => t.id === teamId);
  if (!team || c.pro?.draft?.teamId) return c;
  return {
    ...withPro(c, { status: "dev", undraftedOffers: undefined }),
    player: { ...c.player, teamId, contract: { salary: 45_000, years: 1 } },
    log: [...c.log, log(c.date, `Joined the ${team.name} development team.`)],
  };
}

export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

export type DraftEvent = "agent" | "combine" | "workouts" | "interview" | "draft" | "undrafted" | "drafted";

/** Which step of the road to the draft you're on. */
export function draftStep(c: Career): DraftEvent {
  const p = c.pro!;
  const pre = p.preDraft;
  if (!pre.agent) return "agent";
  if (!pre.combine) return "combine";
  if (pre.workouts.length < WORKOUTS_ALLOWED) return "workouts";
  if (pre.interviews.length < INTERVIEWS.length) return "interview";
  if (!p.draft?.seen) return "draft";
  return p.status ? "drafted" : "undrafted";
}
