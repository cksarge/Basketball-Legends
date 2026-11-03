// A fingerprint of a pro franchise run, so moving code around can be checked against the results it gave before.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Team } from "@/engine/types";
import { jobOffers, takeJob } from "../club/jobs";
import { advanceOffseason } from "../core/offseason";
import { simDay } from "../core/season";
import { createFranchise } from "../create";
import { simDraftToEnd } from "../pro/draft";
import { staffHandles } from "../pro/freeAgency";
import type { Franchise } from "../types";

export const proTeams = (JSON.parse(readFileSync("src/data/generated/pro.json", "utf8")) as { teams: Team[] }).teams;
const digest = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);

export function proRun(seed = "snapshot") {
  let f: Franchise = createFranchise({ league: "pro", team: proTeams[3], teams: proTeams, seed, now: 1 });
  for (let i = 0; i < 400 && f.phase !== "offseason"; i++) f = simDay(f, proTeams, { includeUser: true }).franchise;
  const season = digest({
    games: f.season.games.map((g) => [g.id, g.result?.home, g.result?.away]),
    stats: f.season.stats,
    awards: f.season.awards,
    champ: f.season.championId,
  });
  for (let i = 0; i < 12 && f.phase === "offseason"; i++) {
    if (f.offseason?.step === "draft") f = simDraftToEnd(f);
    if (f.job.fired) f = takeJob(f, jobOffers(f, proTeams)[0], proTeams);
    f = advanceOffseason(staffHandles(f), proTeams);
  }
  for (let i = 0; i < 14; i++) f = simDay(f, proTeams, { includeUser: true }).franchise;
  const ids = Object.keys(f.players).sort();
  const offseason = digest({
    rosters: f.rosters,
    picks: f.picks,
    cap: f.cap,
    players: ids.map((id) => [id, f.players[id].ratings, f.players[id].contract, f.players[id].age]),
    finance: f.finance,
    job: f.job,
    week: f.season.games.filter((g) => g.result).map((g) => [g.id, g.result!.home, g.result!.away]),
  });
  return { season, offseason };
}
