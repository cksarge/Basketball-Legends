// College recruiting: which programs want you, offers, official visits, commitment, signing day and NIL.
// Interest compares your scouting score with the level each program recruits at (by division and prestige),
// with an in-state bonus for Arizona schools and the NCAA's 2.3 GPA bar for Division I.
import { playerOvr } from "@/engine/player";
import { Rng, clamp } from "@/engine/rng";
import type { Team } from "@/engine/types";
import { iso } from "./calendar";
import type { Career, InboxMessage, IsoDate, Offer, Recruiting } from "./types";
import { D1_GPA } from "./hs/academics";

export const VISITS_ALLOWED = 5;
export const MAX_TRACKED = 24;

/** The recruiting score a program usually lands, by division and prestige. */
export function programBar(t: Team) {
  const p = t.prestige;
  return t.tier === "D1" ? 60 + p * 20 : t.tier === "D2" ? 51 + p * 12 : 43 + p * 12;
}

/** Your latest GPA (fall and spring of every year), for academic requirements. */
export function cumulativeGpa(c: Career) {
  const all = c.hs.seasons.flatMap((s) => [s.grades?.fall, s.grades?.spring]).filter((g): g is number => g !== undefined);
  return all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
}

export function recruitScore(c: Career) {
  return c.hs.seasons.at(-1)?.ranking?.score ?? 0;
}

const isAz = (t: Team) => t.state === "AZ";

/** How much a program wants you right now (0..100). */
export function programInterest(c: Career, t: Team, rng: Rng) {
  const score = recruitScore(c);
  const gpa = cumulativeGpa(c);
  if (t.tier === "D1" && gpa !== null && gpa < D1_GPA) return 0;
  let fit = score - programBar(t) + (isAz(t) ? 4 : 0) + rng.normal(0, 2.2);
  if (t.tier === "D3" && gpa !== null) fit += (gpa - 3) * 2;
  // programs far below your level know they can't land you
  const reach = score - programBar(t);
  const reachPenalty = reach > 12 ? clamp(1 - (reach - 12) / 10, 0.1, 1) : 1;
  return Math.round(clamp(100 / (1 + Math.exp(-fit / 3)), 0, 100) * reachPenalty);
}

export function nilValue(c: Career, t: Team) {
  if (t.tier !== "D1") return t.tier === "D2" ? 2_000 : 0;
  const rank = c.hs.seasons.at(-1)?.ranking?.national ?? null;
  const base =
    rank === null ? 4_000 : rank <= 10 ? 900_000 : rank <= 32 ? 400_000 : rank <= 100 ? 150_000 : rank <= 300 ? 60_000 : rank <= 1200 ? 18_000 : 6_000;
  return Math.round((base * (0.5 + t.prestige)) / 1000) * 1000;
}

/** The coaches' pitch for your first year, from how your overall compares with their level. */
export function projectedRole(c: Career, t: Team) {
  const ovr = playerOvr(c.player);
  const starter = t.tier === "D1" ? 56 + t.prestige * 20 : t.tier === "D2" ? 50 + t.prestige * 14 : 45 + t.prestige * 12;
  const gap = ovr + 3 - starter; // you'll improve before you get there
  return gap >= 4
    ? "Starter from day one"
    : gap >= -2
      ? "Rotation player as a freshman"
      : gap >= -8
        ? "Bench minutes, bigger role later"
        : "Likely redshirt year";
}

/** Recruiting opens June 15 after sophomore year (the NCAA contact date). */
export const contactDate = (startYear: number) => iso(startYear + 2, 6, 15);
export const earlySigning = (seniorYear: number) => iso(seniorYear, 11, 11);
export const lateSigning = (seniorYear: number) => iso(seniorYear + 1, 4, 15);

const msg = (date: IsoDate, from: string, subject: string, body: string): InboxMessage => ({
  id: `m-${date}-${Math.random().toString(36).slice(2, 8)}`,
  date,
  from,
  subject,
  body,
  read: false,
});

/**
 * Updates program interest, sends new offers, withdraws offers that cooled off, and signs your letter of intent
 * on signing day if you're committed. Safe to call often; does nothing before the contact date.
 */
export function refreshRecruiting(c: Career, colleges: Team[], date: IsoDate): Career {
  if (c.stage !== "hs" || date < contactDate(c.startYear)) return c;
  const rec: Recruiting = c.recruiting ?? { offers: [], visitsUsed: 0, visitsAllowed: VISITS_ALLOWED };
  if (rec.signedDate) return c;
  const rng = new Rng(`${c.seed}:recruit:${date}`);
  const byId = new Map(colleges.map((t) => [t.id, t]));
  const inbox = [...c.inbox];
  const log = [...c.log];
  // re-score programs already in touch, and find the best new ones
  const tracked = new Map(rec.offers.map((o) => [o.teamId, o]));
  const candidates = colleges
    .map((t) => ({ t, interest: programInterest(c, t, rng) }))
    .filter((x) => x.interest >= 35 || tracked.has(x.t.id))
    .sort((a, b) => b.interest - a.interest || b.t.prestige - a.t.prestige)
    .slice(0, MAX_TRACKED);
  const offers: Offer[] = [];
  const newOffers: Team[] = [];
  for (const { t, interest } of candidates) {
    const prev = tracked.get(t.id);
    const blended = prev ? Math.round(prev.interest * 0.5 + interest * 0.5) : interest;
    let status = prev?.status ?? "interested";
    if (status === "interested" && blended >= 68) {
      status = "offered";
      newOffers.push(t);
    } else if (status === "offered" && blended < 40 && rec.committedTo !== t.id) status = "withdrawn";
    offers.push({
      teamId: t.id,
      date: prev?.date ?? date,
      status,
      interest: blended,
      myInterest: prev?.myInterest ?? Math.round(clamp(45 + t.prestige * 30 + (isAz(t) ? 12 : 0) + rng.normal(0, 6), 5, 95)),
      nil: nilValue(c, t),
      role: projectedRole(c, t),
      visited: prev?.visited,
      favorite: prev?.favorite,
    });
    if (prev?.status === "offered" && status === "withdrawn")
      inbox.push(msg(date, `${t.name} coaches`, "Offer withdrawn", `${t.name} has moved on to other recruits.`));
  }
  // keep offers that dropped off the list so you never lose a committed school
  for (const o of rec.offers) if (!offers.some((x) => x.teamId === o.teamId) && (o.status === "committed" || o.status === "offered")) offers.push(o);
  for (const t of newOffers.slice(0, 6)) {
    inbox.push(
      msg(date, `${t.name} coaches`, `Scholarship offer from ${t.name}`, `${t.name} (${t.tier}) is offering you a scholarship. ${projectedRole(c, t)}.`),
    );
    log.push({ date, text: `Scholarship offer from ${t.name}.`, kind: "milestone" });
  }
  if (newOffers.length > 6) inbox.push(msg(date, "Recruiting", `${newOffers.length - 6} more offers`, "Check the Recruiting tab for every offer."));
  let next: Career = { ...c, recruiting: { ...rec, offers, updated: date }, inbox, log };
  next = autoSign(next, byId, date);
  return next;
}

/** Signing day: a committed senior signs a letter of intent on the early or late signing date. */
function autoSign(c: Career, byId: Map<string, Team>, date: IsoDate): Career {
  const rec = c.recruiting!;
  const senior = c.hs.seasons.at(-1);
  if (!rec.committedTo || rec.signedDate || !senior || (senior.grade !== 12 && !rec.reclassified)) return c;
  const year = senior.year;
  const signDay = date >= earlySigning(year) ? (date >= lateSigning(year) ? lateSigning(year) : earlySigning(year)) : null;
  if (!signDay) return c;
  const t = byId.get(rec.committedTo);
  return {
    ...c,
    recruiting: { ...rec, signedDate: signDay, offers: rec.offers.map((o) => (o.teamId === rec.committedTo ? { ...o, status: "signed" } : o)) },
    inbox: [
      ...c.inbox,
      msg(
        signDay,
        t ? `${t.name} coaches` : "Coaches",
        "Letter of intent signed",
        `It's official: you've signed with ${t?.name ?? "your school"}. Welcome to the family.`,
      ),
    ],
    log: [...c.log, { date: signDay, text: `Signed a letter of intent with ${t?.name ?? "a college"}.`, kind: "milestone" }],
  };
}

export function commit(c: Career, teamId: string, colleges: Team[], date: IsoDate): Career {
  const rec = c.recruiting;
  const o = rec?.offers.find((x) => x.teamId === teamId);
  if (!rec || !o || o.status !== "offered" || rec.signedDate) return c;
  const t = colleges.find((x) => x.id === teamId)!;
  const offers = rec.offers.map((x) =>
    x.teamId === teamId ? { ...x, status: "committed" as const } : x.status === "committed" ? { ...x, status: "offered" as const } : x,
  );
  const next: Career = {
    ...c,
    recruiting: { ...rec, offers, committedTo: teamId, commitDate: date },
    inbox: [
      ...c.inbox,
      msg(
        date,
        "Family",
        "You committed!",
        `The hat's on: you're going to ${t.name}. ${o.nil ? `Your NIL deal is worth about $${o.nil.toLocaleString()} a year.` : ""}`,
      ),
    ],
    log: [...c.log, { date, text: `Committed to ${t.name} (${t.tier}).`, kind: "milestone" }],
  };
  return autoSign(next, new Map(colleges.map((x) => [x.id, x])), date);
}

export function decommit(c: Career, colleges: Team[], date: IsoDate): Career {
  const rec = c.recruiting;
  if (!rec?.committedTo || rec.signedDate) return c;
  const t = colleges.find((x) => x.id === rec.committedTo);
  const offers = rec.offers.map((x) => (x.teamId === rec.committedTo ? { ...x, status: "offered" as const, interest: Math.max(0, x.interest - 25) } : x));
  return {
    ...c,
    recruiting: { ...rec, offers, committedTo: undefined, commitDate: undefined },
    log: [...c.log, { date, text: `Decommitted from ${t?.name ?? "a college"}.`, kind: "milestone" }],
  };
}

export const toggleFavorite = (c: Career, teamId: string): Career =>
  c.recruiting
    ? { ...c, recruiting: { ...c.recruiting, offers: c.recruiting.offers.map((o) => (o.teamId === teamId ? { ...o, favorite: !o.favorite } : o)) } }
    : c;

export type VisitFocus = "facilities" | "coach" | "players" | "academics";
export const VISIT_FOCUS: { id: VisitFocus; label: string; blurb: string }[] = [
  { id: "coach", label: "Sit down with the head coach", blurb: "Hear exactly how they'd use you." },
  { id: "players", label: "Hang out with the players", blurb: "See if this locker room feels like home." },
  { id: "facilities", label: "Tour the arena and facilities", blurb: "The practice gym, the weight room, the game-day setup." },
  { id: "academics", label: "Meet with an academic advisor", blurb: "Majors, tutoring, life after basketball." },
];

/** An official visit: the program's interest rises, and yours moves depending on what you focused on and how the trip went. */
export function officialVisit(c: Career, teamId: string, focus: VisitFocus, colleges: Team[], date: IsoDate): { career: Career; story: string } {
  const rec = c.recruiting;
  const o = rec?.offers.find((x) => x.teamId === teamId);
  if (!rec || !o || o.visited || rec.visitsUsed >= rec.visitsAllowed) return { career: c, story: "" };
  const t = colleges.find((x) => x.id === teamId)!;
  const rng = new Rng(`${c.seed}:visit:${teamId}`);
  const vibe = rng.normal(0, 8);
  const role = o.role;
  const bonus =
    focus === "coach"
      ? role.startsWith("Starter") || role.startsWith("Rotation")
        ? 10
        : -4
      : focus === "players"
        ? 6 + vibe * 0.5
        : focus === "facilities"
          ? 4 + t.prestige * 8
          : (c.player.academics ?? 0.6) > 0.7
            ? 9
            : 3;
  const delta = Math.round(bonus + vibe);
  const story =
    focus === "coach"
      ? role.startsWith("Starter") || role.startsWith("Rotation")
        ? `The coach pulled up film of your games and showed you exactly where you'd fit: "${role}."`
        : `The coach was honest that you'd have to wait your turn: "${role}."`
      : focus === "players"
        ? delta > 6
          ? "You ended up at a team dinner that ran past midnight. These guys already feel like teammates."
          : "The players were friendly, but you didn't really click with the group."
        : focus === "facilities"
          ? `${t.arena.name} seats ${t.arena.capacity.toLocaleString()}. Standing at center court, you could picture it full.`
          : "The advisor walked you through majors, tutoring and the graduation rate. Your family loved it.";
  const offers = rec.offers.map((x) =>
    x.teamId === teamId ? { ...x, visited: true, interest: clamp(x.interest + 8, 0, 100), myInterest: Math.round(clamp(x.myInterest + delta, 0, 100)) } : x,
  );
  return {
    career: {
      ...c,
      recruiting: { ...rec, offers, visitsUsed: rec.visitsUsed + 1 },
      log: [...c.log, { date, text: `Official visit to ${t.name}.`, kind: "milestone" }],
    },
    story,
  };
}

/** Reclassifying (graduating a year early): for juniors who are top recruits with strong grades. */
export function canReclassify(c: Career) {
  const s = c.hs.seasons.at(-1);
  const gpa = cumulativeGpa(c);
  return !!s && s.grade === 11 && !!s.wrapped && (s.ranking?.stars ?? 0) >= 4 && gpa !== null && gpa >= 3.0 && !c.recruiting?.reclassified;
}

export function reclassify(c: Career, date: IsoDate): Career {
  if (!canReclassify(c)) return c;
  const rec: Recruiting = c.recruiting ?? { offers: [], visitsUsed: 0, visitsAllowed: VISITS_ALLOWED };
  return {
    ...c,
    recruiting: { ...rec, reclassified: true },
    log: [...c.log, { date, text: "Reclassified to graduate a year early.", kind: "milestone" }],
    inbox: [
      ...c.inbox,
      msg(
        date,
        "Counselor",
        "Reclassification approved",
        "You'll finish your remaining credits this spring and graduate a year early. College starts in the fall.",
      ),
    ],
  };
}

/** Offers you can still accept, best first by your own interest. */
export const liveOffers = (c: Career) =>
  (c.recruiting?.offers ?? [])
    .filter((o) => o.status === "offered" || o.status === "committed" || o.status === "signed")
    .sort((a, b) => b.myInterest - a.myInterest);
