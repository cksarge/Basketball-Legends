# Franchise M1–M2: Pro Season Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pro franchise that can be created, saved, exported and played or simulated through one full season and playoffs, shipped to `/beta/` as `0.4.0-beta.1` and `0.4.0-beta.2`.

**Architecture:** A new pure-TypeScript `src/franchise/` module holds one persistent league in its own Dexie database, written one transaction per simulated day. A new box-score simulator handles other teams' games in a Web Worker. Played games reuse `PendingMatch` and `MatchResult`.

**Tech Stack:** TypeScript, Next.js static export, Dexie, comlink, zustand, Vitest with fake-indexeddb, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-phase3-franchise-design.md`

## Global Constraints

- Work on `prerelease`. Never merge to `main` without the user's go-ahead.
- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (this version has breaking changes).
- Root-relative file paths go through `asset()` in `src/lib/site.ts`.
- `src/franchise/` has no React and no `window` access, so it runs in tests and workers.
- No real league marks or real player names.
- Road to Legend, Quick Play and the park keep their current behavior and saves. Existing tests are not edited to make them pass.
- Bump versions by editing the `version` lines in `package.json` and `package-lock.json` only. Never let npm rewrite the lockfile.
- Every push updates `CHANGELOG.md`, README, How to Play, Terms, Privacy, Credits and the sitemap as needed.
- A push is done only after `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run format:check` pass, and `curl -s https://legends.carterscoding.com/beta/ | grep -o '0\.4\.0-beta\.[0-9]*' | head -1` shows the new version.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Each line has its test in the owning task.

1. Closing the tab during a long sim: reopening resumes at the last finished day with no doubled stats (Task 6).
2. The same franchise open in two tabs: the older tab cannot overwrite newer progress and says why (Task 2).
3. Browser storage blocked or full: the game shows an error and never claims it saved (Task 2, Task 3).
4. Finishing a played game twice, through the back button or by reloading the result: the result applies once (Task 9).
5. A team too hurt to fill a rotation: the game still simulates with 240 total minutes per team (Task 5).

---

## File Structure

```
src/franchise/
  types.ts             save format, FRANCHISE_VERSION
  create.ts            builds a new league from team data
  storage.ts           Dexie database, revision guard, day commits, export and import
  boxsim.ts            box-score simulator
  rotation.ts          default minutes for a roster
  core/season.ts       nextEvent, simDay, finishing a game
  core/awards.ts       leaders and awards
  leagues/index.ts     LeagueModule interface and lookup
  leagues/pro.ts       pro calendar, schedule and postseason
  simRun.ts            runs a date range with day commits and cancel
  worker.ts            comlink worker around simRun
  simClient.ts         starts the worker, falls back to the main thread
  match.ts             franchisePending and result conversion
  __tests__/           unit tests and engine-baseline.json
src/career/pro/bracket.ts   playoff bracket moved out of season.ts
src/state/franchiseStore.ts
src/app/franchise/page.tsx, FranchiseSelect.tsx
src/app/franchise/new/page.tsx, FranchiseCreator.tsx
src/app/franchise/hub/page.tsx, FranchiseHub.tsx and tab files
```

---

## M1: Foundation

### Task 1: Save format and league creation

**Files:**

- Create: `src/franchise/types.ts`, `src/franchise/create.ts`
- Test: `src/franchise/__tests__/create.test.ts`

**Interfaces:**

- Consumes: `generateRoster(team, seed)` and `assignJerseys(rng, players)` from `src/engine/player.ts`, `ScheduledGame` from `src/career/types.ts`, `StatLine` from `src/game/sim/stats.ts`, `Difficulty` from `src/game/sim/state.ts`.
- Produces:

```ts
export const FRANCHISE_VERSION = 1;
export type FranchisePhase = "regular" | "playIn" | "playoffs" | "offseason";
export interface FranchiseSettings {
  quarterMinutes: number;
  difficulty: Difficulty;
  closeGameMargin: number;
}
export interface SeasonLine extends StatLine {
  gp: number;
  gs: number;
}
export interface Award {
  id: string;
  label: string;
  playerId: string;
  teamId: string;
}
export interface LeagueSeason {
  year: number;
  games: ScheduledGame[];
  series: ProSeries[];
  stats: Record<string, SeasonLine>; // regular season, player id -> totals
  playoffStats: Record<string, SeasonLine>;
  awards: Award[];
  championId?: string;
}
export interface Franchise {
  id: string;
  version: number;
  seed: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  league: LeagueId;
  teamId: string;
  date: IsoDate;
  phase: FranchisePhase;
  settings: FranchiseSettings;
  players: Record<string, Player>;
  rosters: Record<string, string[]>; // team id -> player ids
  season: LeagueSeason;
}
export interface FranchiseSummary {
  id: string;
  teamName: string;
  teamId: string;
  league: LeagueId;
  primary: string;
  year: number;
  date: IsoDate;
  wins: number;
  losses: number;
  createdAt: number;
  updatedAt: number;
}
export function createFranchise(o: {
  league: LeagueId;
  team: Team;
  teams: Team[];
  seed: string;
  settings?: Partial<FranchiseSettings>;
  year?: number;
  now?: number;
}): Franchise;
export const DEFAULT_FRANCHISE_SETTINGS: FranchiseSettings; // quarterMinutes 6, difficulty "pro", closeGameMargin 8
```

- [ ] **Step 1: Write the failing test.** `createFranchise` with all 30 pro teams. Assert: 30 `rosters` entries; every roster has 13–15 players; player ids are unique across the league; every id in `rosters` exists in `players` with a matching `teamId`; `revision === 0`; `phase === "regular"`; `season.games` is empty until Task 6; two calls with the same seed give equal `players`; different seeds differ.
- [ ] **Step 2: Run it.** `npx vitest run src/franchise/__tests__/create.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** Seed each roster from `` `${seed}:${team.id}` `` and prefix player ids with the team id when ids would collide. `year` defaults to 2026. `date` is `proCalendar(year).camp`.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/franchise && git commit -m "Franchise save format and league creation"`

### Task 2: Storage

**Files:**

- Create: `src/franchise/storage.ts`
- Test: `src/franchise/__tests__/storage.test.ts` (starts with `import "fake-indexeddb/auto";`)

**Interfaces:**

- Consumes: `Franchise`, `FranchiseSummary`.
- Produces:

```ts
export class StaleFranchiseError extends Error {}
export function openFranchiseDb(name?: string): Dexie; // default "bl-franchise"
export function summarizeFranchise(f: Franchise, team: Team | undefined): FranchiseSummary;
export function listFranchises(): Promise<FranchiseSummary[]>;
export function loadFranchise(id: string): Promise<Franchise | null>;
export function createFranchiseSave(f: Franchise, team: Team | undefined): Promise<Franchise>;
export function commitFranchise(f: Franchise, team: Team | undefined, changedPlayers?: string[]): Promise<Franchise>;
export function deleteFranchise(id: string): Promise<void>;
export function migrateFranchise(f: Franchise): Franchise;
export function exportFranchise(f: Franchise): string; // kind "basketball-legends-franchise"
export function importFranchise(text: string, team: (f: Franchise) => Team | undefined): Promise<Franchise>;
```

Tables: `saves` (`&id, updatedAt`, holds the summary and everything except players and the season), `players` (`&[saveId+id], saveId`), `seasons` (`&[saveId+year], saveId`). `commitFranchise` runs one read-write transaction: it reads the stored `revision`, throws `StaleFranchiseError` if it differs from `f.revision`, then writes with `revision + 1`. With `changedPlayers`, only those rows are written.

- [ ] **Step 1: Write the failing tests.** Round trip equals the input except `revision` and `updatedAt`. `listFranchises` is newest first. `commitFranchise` with a stale copy throws `StaleFranchiseError` and leaves the stored row unchanged. `changedPlayers: ["x"]` writes only row `x`. `deleteFranchise` removes rows from all three tables. `migrateFranchise` refuses `version: FRANCHISE_VERSION + 1` with "saved by a newer version". `importFranchise` on an id that already exists stores a new id. Invalid JSON and a wrong `kind` each reject with "That file isn't a franchise save." and write nothing. A failing Dexie write (mock `table.bulkPut` to reject with `QuotaExceededError`) rejects, leaving the previous revision readable.
- [ ] **Step 2: Run it.** `npx vitest run src/franchise/__tests__/storage.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement,** following `src/career/storage.ts`.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add src/franchise && git commit -m "Franchise storage with day commits and a revision guard"`

### Task 3: Pages, store and first beta

**Files:**

- Create: `src/state/franchiseStore.ts`, `src/app/franchise/page.tsx`, `src/app/franchise/FranchiseSelect.tsx`, `src/app/franchise/new/page.tsx`, `src/app/franchise/new/FranchiseCreator.tsx`, `src/app/franchise/hub/page.tsx`, `src/app/franchise/hub/FranchiseHub.tsx`
- Modify: `src/app/MainMenu.tsx:61-68` and its item renderer, `public/sw.js:11`, `e2e/smoke.spec.ts`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `README.md`, `src/app/legal/privacy` page (Franchise saves in IndexedDB), How to Play

**Interfaces:**

- Consumes: Task 2 storage, `LEAGUES` and `loadLeague` from `src/data/leagues.ts`, `PageShell`, `Panel`, `Button`, `Select` from `src/ui/kit.tsx`, `downloadText` and `fileSlug` from `src/ui/download.ts`.
- Produces:

```ts
export const useFranchise: UseBoundStore<...>; // franchise, team, status: "idle"|"loading"|"ready"|"missing"|"error"|"stale", error, open(id), set(f), update(fn), close()
export function franchiseTeam(f: Franchise): Promise<Team | undefined>;
```

`update` applies the change and calls `commitFranchise`. On `StaleFranchiseError`, status becomes `"stale"` and the hub shows "This franchise was changed in another tab. Reload to continue." with a Reload button. On any other save failure, status becomes `"error"` and shows "Couldn't save. Your last change isn't stored." Hub pages use `robots: { index: false }`.

`/franchise/new/` picks a team with the same search as Quick Play. College and Arizona HS appear disabled with "Coming soon". The Franchise main menu card loses `soon`, gets `href: "/franchise/"`, and gains a `beta?: boolean` label rendered where "Coming soon" sits. The hub shows the team, record and date, with "Coming soon" tabs for later milestones.

- [ ] **Step 1: Write the failing e2e test** in `e2e/smoke.spec.ts`: from `/franchise/new/`, choose a pro team, reach the hub, reload, and still see that team; the list page shows it with Continue, Export and Delete; no console errors.
- [ ] **Step 2: Build and run it.** `npm run build && npx playwright test --grep-invert @gpu -g franchise`. Expected: FAIL.
- [ ] **Step 3: Implement** the store and pages, following `CareerSelect.tsx` and `careerStore.ts`. Add `/franchise/`, `/franchise/new/`, `/franchise/hub/` to `PAGES`.
- [ ] **Step 4: Run it.** Expected: PASS. Then run the Global Constraints checks.
- [ ] **Step 5: Bump to `0.4.0-beta.1`, update docs,** starting a `v0.4.0` changelog section in the same form as the v0.3.0 betas (`git show e63346d -- CHANGELOG.md`).
- [ ] **Step 6: Commit and push.** `git commit -m "0.4.0-beta.1: Franchise foundation" && git push origin prerelease`, then confirm with the `curl` check.

---

## M2: Pro season

### Task 4: Move the playoff bracket into a shared file

**Files:**

- Create: `src/career/pro/bracket.ts`
- Modify: `src/career/pro/season.ts:253-274` and `:276-340`, `src/career/types.ts` only if a type must move
- Test: existing `src/career/__tests__/pro.test.ts`, new `src/career/__tests__/bracket.test.ts`

**Interfaces:**

- Produces:

```ts
export interface BracketInput { year: number; games: ScheduledGame[]; series: ProSeries[]; seeds: (conf: "East" | "West") => string[] }
export function nextSeries(s: BracketInput): ProSeries[];
export function makeSeries(...): ProSeries;      // same parameters as today
export function seriesWins(x: ProSeries, byId: Map<string, ScheduledGame>): { high: number; low: number };
export function seriesScore(x: ProSeries, games: ScheduledGame[]): { high: number; low: number }; // season.ts re-exports it for current callers
export const roundStart: (year: number, round: number) => IsoDate;
```

- [ ] **Step 1: Write the bracket test.** With fixed seeds and scripted winners, `nextSeries` creates the 4 play-in games first, then the final play-in spot, then 1v8, 4v5, 3v6, 2v7 per conference, then the semifinals, the conference finals and `finals`. The higher win total hosts the Finals.
- [ ] **Step 2: Run `npx vitest run src/career`.** Expected: only the new file fails.
- [ ] **Step 3: Move the code** with no behavior change. `runPlayoffs` passes `{ year, games, series, seeds }`.
- [ ] **Step 4: Run `npx vitest run src/career`.** Expected: all PASS, with no edit to `pro.test.ts`.
- [ ] **Step 5: Commit.** `git commit -m "Move the pro playoff bracket into a shared file"`

### Task 5: Box-score simulator

**Files:**

- Create: `src/franchise/rotation.ts`, `src/franchise/boxsim.ts`, `scripts/franchise-baseline.ts`, `src/franchise/__tests__/engine-baseline.json`
- Test: `src/franchise/__tests__/boxsim.test.ts`

**Interfaces:**

- Consumes: `runMatchSync` from `src/career/hs/play.ts` (baseline only), `LEAGUE_RULES`, `Rng`, `playerOvr`.
- Produces:

```ts
export function defaultRotation(roster: Player[], totalMinutes: number): Record<string, number>; // healthy players, best first, sums to totalMinutes
export interface BoxSide {
  teamId: string;
  roster: Player[];
  rotation: Record<string, number>;
  starters: string[];
  tactics?: Partial<TeamTactics>;
}
export interface BoxInput {
  league: LeagueId;
  quarterMinutes: number;
  periods: number;
  home: BoxSide;
  away: BoxSide;
  neutral?: boolean;
  seed: string;
}
export interface BoxResult {
  home: number;
  away: number;
  overtimes: number;
  box: BoxScore;
  playerOfGame: string | null;
  injuries: { playerId: string; name: string; gamesOut: number }[];
}
export function simBox(i: BoxInput): BoxResult;
```

`franchise-baseline.ts` runs 60 real-engine pro games at full 12-minute quarters across varied teams and writes per-team-game means and standard deviations for points, FGA, FG%, 3PA, 3P%, FTA, OREB, DREB, AST, STL, BLK, TOV and PF, plus the top scorer's mean points and the home win rate.

Possession loop: possessions per team come from pace and game length. Each possession picks a shooter by minutes-weighted usage from ratings, picks a shot zone by archetype and `threeRate`, then resolves a make from shooter and defender ratings, with fouls, turnovers, steals, blocks, rebounds and assists rolled from ratings. Overtime repeats at 5 minutes while tied. Team minutes equal `5 × game minutes` exactly.

- [ ] **Step 1: Run the baseline** with `npx tsx scripts/franchise-baseline.ts` and commit the JSON. If mean team points fall outside 100–125, report the number to the user before tuning, because that means real-engine scoring needs its own fix.
- [ ] **Step 2: Write the failing tests.** For 300 games between two mid-strength rosters, each mean stat is within 8% of the baseline and points within 4. The top-talent roster beats the bottom one in more than 85% of 200 games. Home win rate is within 6 points of the baseline. The same seed gives the same result. Every box satisfies: points equal `2×FGM + TPM + FTM`, summed team points equal the score, team minutes equal 240 minutes in seconds (14,400) in regulation. With only 6 healthy players, `defaultRotation` caps nobody above 48 and the game still totals 14,400 seconds. With 3 healthy players, emergency call-ups are used and the total still holds. 200 games finish in under 4 seconds. Pro team tests build rosters with `generateRoster`.
- [ ] **Step 3: Run them.** `npx vitest run src/franchise/__tests__/boxsim.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement `rotation.ts` and `boxsim.ts`,** tuning named constants at the top of `boxsim.ts`.
- [ ] **Step 5: Run them.** Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "Franchise box-score simulator tuned to the real engine"`

### Task 6: Season engine

**Files:**

- Create: `src/franchise/leagues/index.ts`, `src/franchise/leagues/pro.ts`, `src/franchise/core/season.ts`, `src/franchise/simRun.ts`
- Modify: `src/franchise/create.ts` (fill `season.games`)
- Test: `src/franchise/__tests__/season.test.ts`

**Interfaces:**

- Consumes: `generateProSchedule`, `proCalendar`, `standings`, Task 4 bracket, Task 5 `simBox` and `defaultRotation`, Task 2 `commitFranchise`.
- Produces:

```ts
export interface LeagueModule {
  id: LeagueId;
  calendar(year: number): { opening: IsoDate; lastGame: IsoDate; seasonEnd: IsoDate };
  quarterMinutes: number;
  periods: number;
  schedule(teams: Team[], year: number, seed: string): ScheduledGame[];
  postseason(f: Franchise, teams: Team[]): Franchise; // creates due games and advances series
}
export function leagueModule(id: LeagueId): LeagueModule;

export type FranchiseEvent = { kind: "game"; date: IsoDate; game: ScheduledGame } | { kind: "day"; date: IsoDate } | { kind: "seasonEnd"; date: IsoDate };
export function nextFranchiseEvent(f: Franchise): FranchiseEvent;
export function applyGame(f: Franchise, gameId: string, r: BoxResult, played: boolean): Franchise; // no-op if the game already has a result
export function simDay(f: Franchise, teams: Team[], opts: { includeUser: boolean }): { franchise: Franchise; changedPlayers: string[] };
export function conferenceSeeds(f: Franchise, teams: Team[], conf: "East" | "West"): string[];

export interface SimRange {
  id: string;
  until: IsoDate | "nextUserGame" | "seasonEnd";
  includeUser: boolean;
}
export function runSim(r: SimRange, teams: Team[], onDay: (date: IsoDate) => void, cancelled: () => boolean): Promise<Franchise>;
```

`ScheduledGame.result.box` keeps only the user's team, so a season stays small. League totals live in `season.stats`. Injuries set `player.injury`; `gamesOut` drops with each team game, and hurt players are left out of `defaultRotation`. `runSim` stops before any user game unless `includeUser` is true, and commits once per simulated day.

- [ ] **Step 1: Write the failing tests.** A created franchise has 1,230 regular-season games and every team has 82. `simDay` never double-books. `nextFranchiseEvent` returns the user's next game, or `seasonEnd` when finished. A full auto-sim reaches `phase: "offseason"` with a `championId`, exactly 16 playoff teams, and every team with exactly 82 finished regular-season games, with each player at no more than 82 `gp`. `applyGame` called twice changes nothing the second time. A pro-season auto-sim finishes in under 60 seconds. Using `fake-indexeddb`: abort `runSim` mid-season by throwing from `onDay`, reload, resume to the end, and the final `gp` totals equal an uninterrupted run with the same seed.
- [ ] **Step 2: Run them.** `npx vitest run src/franchise/__tests__/season.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Daily game seeds come from `` `${f.seed}:${game.id}` `` so an interrupted run replays identically.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Franchise season engine with day commits"`

### Task 7: Stat leaders and awards

**Files:**

- Create: `src/franchise/core/awards.ts`
- Modify: `src/franchise/core/season.ts`
- Test: `src/franchise/__tests__/awards.test.ts`

**Interfaces:**

- Produces:

```ts
export type LeaderKey = "ppg" | "rpg" | "apg" | "spg" | "bpg" | "fgPct" | "tpPct" | "ftPct";
export function leaders(f: Franchise, key: LeaderKey, limit?: number): { playerId: string; teamId: string; value: number; gp: number }[];
export function seasonAwards(f: Franchise, teams: Team[]): Award[];
```

Rate leaders require 58 games at 82-game length, scaled by schedule length. Percentage leaders also need 300 FGA, 82 3PA or 125 FTA. Awards: `mvp`, `dpoy`, `sixth`, `allLeague1` to `allLeague3` (five players each), `finalsMvp`. Rookie of the Year arrives with draft classes in M5.

- [ ] **Step 1: Write the failing tests.** Leaders sort correctly and skip low-game players. A player with fewer than the required games cannot win MVP. `sixth` goes to a player with `gs < gp / 2`. No player appears on two All-League teams. `finalsMvp` is on the champion. Awards land in `season.awards` when the Finals end.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Hook `seasonAwards` to the transition into `offseason`.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Franchise stat leaders and awards"`

### Task 8: Web Worker

**Files:**

- Create: `src/franchise/worker.ts`, `src/franchise/simClient.ts`
- Test: `src/franchise/__tests__/simClient.test.ts`

**Interfaces:**

- Consumes: `runSim`.
- Produces:

```ts
export interface SimHandle {
  done: Promise<void>;
  cancel(): void;
}
export function startSim(r: SimRange, teams: Team[], onDay: (date: IsoDate) => void): SimHandle;
```

The worker calls `runSim` with Dexie opened inside the worker, and `comlink` exposes `run` and `cancel`. Create it with `new Worker(new URL("./worker.ts", import.meta.url))`. Confirm this bundling form in the Next.js docs for this version first. If the constructor is missing or throws, or the worker errors before its first day, `startSim` runs `runSim` on the main thread. The store reloads the save when `done` resolves.

- [ ] **Step 1: Write the failing test.** With `Worker` undefined under Vitest, `startSim` falls back and finishes a short range. `cancel()` stops within one day and leaves the last finished day stored.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Run franchise sims in a worker"`

### Task 9: Played games

**Files:**

- Create: `src/franchise/match.ts`
- Modify: `src/state/matchStore.ts:48-82`, `:84-101`, `src/ui/game/GameView.tsx:246`, `:502-506`, `:529`, `:1191`, `src/state/suspended.ts`
- Test: `src/franchise/__tests__/match.test.ts`, `src/state/__tests__/suspended.test.ts`

**Interfaces:**

- Consumes: `PendingMatch`, `MatchResult`, `outcomeFromMatch` shape, `uniformColors`, `applyGame`.
- Produces:

```ts
// matchStore.ts
export interface FranchiseGameRef {
  franchiseId: string;
  gameId: string;
}
// PendingMatch and MatchResult each gain: franchise?: FranchiseGameRef

// match.ts
export function franchisePending(f: Franchise, game: ScheduledGame, teams: Team[], controller: string): PendingMatch;
export function resultToBox(r: MatchResult): BoxResult;
export function applyFinishedFranchiseMatch(f: Franchise, r: MatchResult): Franchise;

// suspended.ts
export function findFranchiseSave(franchiseId: string, gameId: string): SuspendedGame | null;
export function pruneFranchiseSaves(franchiseId: string, keep: (gameId: string) => boolean): void;
```

`franchisePending` uses `mode: "franchise"`, `arena: "pro"`, no `lockPlayerId` so the user controls the whole team, `returnTo: /franchise/hub/?id=...`, and `f.settings` for quarter length and difficulty. In `GameView`, every check that today means "a career game" for Save and quit and the return path also covers `pending.franchise`, and toast text says "your franchise hub". Mid-game saves use group `franchise`.

- [ ] **Step 1: Write the failing tests.** `franchisePending` gives the home side the home team, the controller only on the user's side, and `returnTo` containing the id. `applyFinishedFranchiseMatch` records score, `played: true` and league stats scaled to the game as played. Applying the same result twice gives the same franchise as applying it once. A result for a different franchise id changes nothing. `findFranchiseSave` finds a game in any Franchise slot, and `pruneFranchiseSaves` removes only games that `keep` rejects. Slot tests still pass for the `play` and `career` groups.
- [ ] **Step 2: Run them.** `npx vitest run src/franchise/__tests__/match.test.ts src/state`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** Copy `proPending`'s team, arena and uniform choices rather than calling it, since it depends on a `Career`.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "Play franchise games in 3D and record the results"`

### Task 10: Hub and second beta

**Files:**

- Create: `src/app/franchise/hub/HomeTab.tsx`, `ScheduleTab.tsx`, `RosterTab.tsx`, `StandingsTab.tsx`, `LeadersTab.tsx`, `PlayoffsTab.tsx`, `actions.ts`
- Modify: `src/app/franchise/hub/FranchiseHub.tsx`, `e2e/smoke.spec.ts`, `package.json`, `package-lock.json`, `CHANGELOG.md`, `README.md`, How to Play, Terms and Privacy as needed
- Test: `e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: `nextFranchiseEvent`, `startSim`, `leaders`, `conferenceSeeds`, `franchisePending`, `applyFinishedFranchiseMatch`, `findFranchiseSave`, `pruneFranchiseSaves`, `useFranchise`, `BoxScore` UI, `TeamLogo`, `@tanstack/react-table`.
- Produces: the user-facing hub.

Home shows the next game with **Play**, **Sim game**, **Sim to date** and **Sim to next event**, with a progress bar and **Stop** during sims. **Resume** appears when `findFranchiseSave` finds this game. Schedule lists results and the user's box scores. Roster, Standings and Leaders use sortable tables. Playoffs shows the bracket. When `phase` is `offseason`, Home shows the champion and awards with an "Offseason arrives in a later update" panel. Hub load runs `applyFinishedFranchiseMatch`, then clears `lastResult`.

- [ ] **Step 1: Write the failing e2e test:** create a franchise, sim to the next event, see a result on Schedule and a sorted Leaders table, reload and keep them, sim the season with Stop tested once, and reach the champion panel with no console errors.
- [ ] **Step 2: Build and run it.** `npm run build && npx playwright test --grep-invert @gpu -g franchise`. Expected: FAIL.
- [ ] **Step 3: Implement the tabs,** matching `src/app/career/hub/`.
- [ ] **Step 4: Run it.** Expected: PASS. Then repeat with `E2E_BASE=/beta` on a `BL_CHANNEL=beta` build.
- [ ] **Step 5: Play one game in the browser** at 2-minute quarters with Chrome DevTools MCP: finish it, confirm the result on the hub, then pause another game, use Save and quit, and resume it.
- [ ] **Step 6: Bump to `0.4.0-beta.2`, update docs, run the Global Constraints checks.**
- [ ] **Step 7: Commit and push.** `git commit -m "0.4.0-beta.2: a full pro franchise season" && git push origin prerelease`, then confirm with the `curl` check.

---

## Later plans

Each gets its own plan when the stage before it is done, so it builds on the real code:

- M3–M4: coaching and playbooks
- M5–M7: offseason, contracts, free agency and trades
- M8–M9: running the club and the pro finish
- M10–M11: college and high school
- M12–M13: roster editor, packs and phase finish
