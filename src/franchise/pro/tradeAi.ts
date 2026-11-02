// How AI teams judge deals, the trade finder and block, and the trades teams make with each other.
import { addDays } from "@/career/calendar";
import { playerOvr } from "@/engine/player";
import { Rng } from "@/engine/rng";
import type { DraftPick, Franchise } from "../types";
import { currentPick } from "./draft";
import { pickTradeValue, playerTradeValue, teamDirection } from "./tradeValue";
import { applyTrade, tradeOpen, tradeProblems, type Trade, type TradeAsset } from "./trades";

export interface TradeOffer {
  id: string;
  trade: Trade;
  date: string;
}

/** What an AI team has to gain. It becomes the trade difficulty setting. */
export const TRADE_MARGIN = 0.08;
const OFFER_DAYS = 7;
/** Extra pieces in a package count for less: a roster only has so many spots. */
const PACKAGE_WEIGHTS = [1, 0.6, 0.35, 0.2];
const LAST_WEIGHT = 0.1;
const MIN_GAIN = 0.2;
const FINDER_RESULTS = 5;
const BLOCK_TEAMS = 10;
const BLOCK_OFFERS = 5;
const AI_TRADE_CHANCE = 0.7;
const AI_ATTEMPTS = 12;
const VETERAN_AGE = 27;

function assetValue(f: Franchise, a: TradeAsset, teamId: string) {
  if (a.kind === "pick")
    return pickTradeValue(
      f,
      f.picks.find((p) => p.id === a.id)!,
      teamId,
    );
  const p = f.players[a.id];
  return playerTradeValue(f, a.signAndTrade ? { ...p, contract: a.signAndTrade } : p, teamId);
}

/** A package's worth to a team: its best piece in full, the rest less and less. Bad contracts count in full. */
function packageValue(f: Franchise, assets: TradeAsset[], teamId: string) {
  const values = assets.map((a) => assetValue(f, a, teamId)).sort((a, b) => b - a);
  return values.reduce((sum, v, i) => sum + (v > 0 ? v * (PACKAGE_WEIGHTS[i] ?? LAST_WEIGHT) : v), 0);
}

export function tradeReply(f: Franchise, t: Trade): { accepted: boolean; note: string; gap: number } {
  const problems = tradeProblems(f, t);
  if (problems.length) return { accepted: false, note: problems[0], gap: 0 };
  let gap = 0;
  for (const teamId of t.teams) {
    if (teamId === f.teamId) continue;
    const coming = packageValue(
      f,
      t.assets.filter((a) => a.to === teamId),
      teamId,
    );
    const going = t.assets.filter((a) => a.from === teamId).reduce((sum, a) => sum + assetValue(f, a, teamId), 0);
    gap = Math.max(gap, going + Math.abs(going) * TRADE_MARGIN + MIN_GAIN - coming);
  }
  return gap > 0 ? { accepted: false, note: "They'd need more to do this deal.", gap } : { accepted: true, note: "They'd do this deal.", gap: 0 };
}

const playerAsset = (id: string, from: string, to: string): TradeAsset => ({ kind: "player", id, from, to });
const pickAsset = (id: string, from: string, to: string): TradeAsset => ({ kind: "pick", id, from, to });

/** Everything a team could put in a deal to another team. */
function teamAssets(f: Franchise, from: string, to: string): TradeAsset[] {
  const players = f.rosters[from].map((id) => playerAsset(id, from, to));
  const picks = f.picks.filter((p) => p.ownerId === from && !f.draft.results.some((r) => r.pickId === p.id)).map((p) => pickAsset(p.id, from, to));
  return [...players, ...picks];
}

const myCost = (f: Franchise, t: Trade) =>
  t.assets.filter((a) => a.from === f.teamId).reduce((sum, a) => sum + assetValue(f, a, f.teamId), 0) -
  t.assets.filter((a) => a.to === f.teamId).reduce((sum, a) => sum + assetValue(f, a, f.teamId), 0);

/** The trade finder: the cheapest packages of the user's that get these assets. */
export function askFor(f: Franchise, wanted: TradeAsset[]): Trade[] {
  const from = wanted[0]?.from;
  if (!from) return [];
  const mine = teamAssets(f, f.teamId, from);
  const singles = mine.map((a) => [a]);
  const pairs = mine.flatMap((a, i) => mine.slice(i + 1).map((b) => [a, b]));
  const found: Trade[] = [];
  for (const giving of [...singles, ...pairs]) {
    const t = { teams: [f.teamId, from], assets: [...wanted, ...giving] };
    if (tradeReply(f, t).accepted) found.push(t);
  }
  return found.sort((a, b) => myCost(f, a) - myCost(f, b)).slice(0, FINDER_RESULTS);
}

export function toggleBlock(f: Franchise, id: string): Franchise {
  return { ...f, tradeBlock: f.tradeBlock.includes(id) ? f.tradeBlock.filter((x) => x !== id) : [...f.tradeBlock, id] };
}

/** One offer per interested team, for the first player on the block it wants. */
export function blockOffers(f: Franchise): TradeOffer[] {
  const rng = new Rng(`${f.seed}:block:${f.date}`);
  const offers: TradeOffer[] = [];
  const others = rng.shuffle(Object.keys(f.rosters).filter((id) => id !== f.teamId)).slice(0, BLOCK_TEAMS);
  for (const teamId of others) {
    if (offers.length >= BLOCK_OFFERS) break;
    for (const id of f.tradeBlock) {
      if (!f.rosters[f.teamId].includes(id)) continue;
      const asked = playerAsset(id, f.teamId, teamId);
      const best = teamAssets(f, teamId, f.teamId)
        .map((a) => ({ trade: { teams: [f.teamId, teamId], assets: [asked, a] }, worth: assetValue(f, a, f.teamId) }))
        .filter((x) => x.worth > 0 && tradeReply(f, x.trade).accepted)
        .sort((a, b) => b.worth - a.worth)[0];
      if (best) {
        offers.push({ id: `offer-${f.date}-${teamId}-${id}`, trade: best.trade, date: f.date });
        break;
      }
    }
  }
  return offers;
}

/** Old and broken offers go, and the block draws new ones. */
export function refreshOffers(f: Franchise): Franchise {
  const live = f.tradeOffers.filter((o) => addDays(o.date, OFFER_DAYS) > f.date && !tradeProblems(f, o.trade).length);
  const taken = new Set(live.map((o) => o.id));
  const fresh = f.tradeBlock.length && tradeOpen(f) ? blockOffers(f).filter((o) => !taken.has(o.id)) : [];
  return live.length === f.tradeOffers.length && !fresh.length ? f : { ...f, tradeOffers: [...live, ...fresh] };
}

/** A contender tries to buy a veteran from a rebuilding team, paying with picks and a matching contract. */
function aiDeal(f: Franchise, buyer: string, seller: string): Trade | null {
  const veterans = f.rosters[seller].map((id) => f.players[id]).filter((p) => p.age >= VETERAN_AGE && playerOvr(p) >= 75 && !p.contract?.twoWay);
  const target = veterans.sort((a, b) => playerOvr(b) - playerOvr(a))[0];
  if (!target) return null;
  const salary = target.contract!.salary;
  const filler = f.rosters[buyer]
    .map((id) => f.players[id])
    .filter((p) => !p.contract?.twoWay && p.contract!.salary <= salary * 1.1)
    .sort((a, b) => b.contract!.salary - a.contract!.salary)
    .slice(0, 4);
  const picks = f.picks.filter((p: DraftPick) => p.ownerId === buyer).sort((a, b) => a.round - b.round || a.year - b.year);
  const want = playerAsset(target.id, seller, buyer);
  for (const body of filler)
    for (const pick of [null, picks[0], picks[1]]) {
      const assets = [want, playerAsset(body.id, buyer, seller), ...(pick ? [pickAsset(pick.id, buyer, seller)] : [])];
      const t = { teams: [buyer, seller], assets };
      if (tradeProblems(f, t).length) continue;
      const buyerGives = assets.slice(1);
      const worthIt = assetValue(f, want, buyer) > buyerGives.reduce((sum, a) => sum + assetValue(f, a, buyer), 0);
      if (worthIt && tradeReply({ ...f, teamId: buyer }, t).accepted) return t;
    }
  return null;
}

/** Most weeks, one contender and one rebuilding team find a deal. */
export function aiTradeDay(f: Franchise, rng: Rng): { franchise: Franchise; changedPlayers: string[] } {
  if (!tradeOpen(f) || !rng.chance(AI_TRADE_CHANCE)) return { franchise: f, changedPlayers: [] };
  const others = Object.keys(f.rosters).filter((id) => id !== f.teamId);
  const buyers = rng.shuffle(others.filter((id) => teamDirection(f, id) !== "rebuilding"));
  const sellers = rng.shuffle(others.filter((id) => teamDirection(f, id) !== "contending"));
  for (let i = 0; i < AI_ATTEMPTS && i < buyers.length && i < sellers.length; i++) {
    if (buyers[i] === sellers[i]) continue;
    const t = aiDeal(f, buyers[i], sellers[i]);
    if (!t) continue;
    const next = applyTrade(f, t);
    const entry = { date: f.date, teams: t.teams, assets: t.assets };
    return { franchise: { ...next, tradeLog: [...next.tradeLog, entry] }, changedPlayers: t.assets.flatMap((a) => (a.kind === "player" ? [a.id] : [])) };
  }
  return { franchise: f, changedPlayers: [] };
}

/** While the user is on the clock, teams call about the pick. */
export function draftDayOffers(f: Franchise): TradeOffer[] {
  const pick = currentPick(f);
  if (pick?.ownerId !== f.teamId) return [];
  const offers: TradeOffer[] = [];
  const rng = new Rng(`${f.seed}:draftday:${pick.id}`);
  for (const teamId of rng.shuffle(Object.keys(f.rosters).filter((id) => id !== f.teamId))) {
    if (offers.length >= BLOCK_OFFERS) break;
    const theirs = f.picks.filter((p) => p.ownerId === teamId && p.id !== pick.id && !f.draft.results.some((r) => r.pickId === p.id));
    const trade = theirs
      .map((p) => ({ teams: [f.teamId, teamId], assets: [pickAsset(pick.id, f.teamId, teamId), pickAsset(p.id, teamId, f.teamId)] }))
      .filter((t) => tradeReply(f, t).accepted)
      .sort((a, b) => assetValue(f, b.assets[1], f.teamId) - assetValue(f, a.assets[1], f.teamId))[0];
    if (trade) offers.push({ id: `draftday-${pick.id}-${teamId}`, trade, date: f.date });
  }
  return offers;
}
