# Franchise M8–M9: Running the Club and the Pro Finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user runs the whole club, from ticket prices to their own job, in a league with a real history, and the pro game is complete: every system can run itself, the league's rules can be changed, and known gaps are closed. Ships to `/beta/` as `0.4.0-beta.11` and `.12` (M8) and `.13` (M9).

**Architecture:** New pure modules in `src/franchise/club/` and `src/franchise/history/` hang off the same day and offseason steps as earlier stages. Every AI team has finances too, so league revenue can set the cap. Auto-manage reuses the AI paths the league already runs, so the user's team on auto makes the same legal moves as any other team.

**Tech Stack:** TypeScript, Next.js static export, Dexie, zustand, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-phase3-franchise-design.md` (Running the club, Jobs, League life, Quality of life, Testing)

## Global Constraints

- Work on `prerelease`. Never merge to `main` without the user's go-ahead.
- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code.
- Root-relative file paths go through `asset()` in `src/lib/site.ts`.
- `src/franchise/` has no React and no `window` access.
- No real league marks or real people's names.
- All money numbers scale with the cap and live in named constants.
- Road to Legend, Quick Play and the park keep their behavior and saves. Existing tests are not edited to make them pass, unless this plan names the edit.
- `FRANCHISE_VERSION` becomes 4, and `0.4.0-beta.10` saves keep working, in season and in the offseason.
- Anything that loops over `f.players` in an order-sensitive way sorts ids first, and any cache keys on `f.players` and `f.season.games`. A reloaded save must play out like a running one.
- Every path that changes a player reports it in `changedPlayers`, or commits in full.
- Bump versions by editing the `version` lines in `package.json` and `package-lock.json` only.
- Every push updates `CHANGELOG.md`, README, How to Play, Terms, Privacy, Credits and the sitemap as needed. How to Play avoids long blocks of text. Changelog additions go under their own headers, as in v0.3.0.
- A push is done only after `npx tsc --noEmit`, `npm run lint` with every error read, `npx vitest run`, `npm run format:check`, `npx playwright test` on the live build and `--grep-invert @gpu` on the beta build pass, and `curl` shows the new version on `/beta/`. Statistical thresholds also run on x64 under Rosetta, and soak limits are judged across at least five values of `SOAK_SEED`.
- Each test is run and seen to fail before its code is written, in a separate step.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions this plan makes

The spec leaves these open. Each is cheap to change at this stage.

| Question          | Decision                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Whose money       | Every team has books, so league revenue is real. Only the user sets prices and budgets.                                              |
| Cash              | Each season's profit or loss goes into a club balance. It matters only through the owner's profit goal, so a club can't go bankrupt. |
| Budgets           | Coaching, scouting and facilities, $4M to $40M at a $140M cap, default $15M.                                                         |
| Job security      | A 0–100 score. Starts at 60, and the owner reviews it after each season. At 0 or below the user is fired.                            |
| Firing timing     | Only at the season review, so a season is never cut off. A new owner gives at least one full season before any firing.               |
| Leaving by choice | Only offers after a firing, as the spec says. A Resign button is left out.                                                           |
| Other leagues     | Job offers are pro teams only until M10 and M11 add those leagues. The job code takes a league field so they plug in.                |
| Hall of Fame      | A score from career totals, awards and titles at retirement. Road to Legend Legends show in their own section.                       |
| Records           | Single-game for the user's team, single-season and career for the league.                                                            |
| Games per season  | 82, 70, 58 or 41.                                                                                                                    |
| Playoff formats   | Best of 7, or best of 5 in the first round, each with or without the play-in.                                                        |
| Trade difficulty  | Easy, normal or hard: margins 2%, 8% and 16%.                                                                                        |
| Progression speed | Slow, normal or fast: 0.7×, 1× and 1.3× on yearly change.                                                                            |
| Injuries          | Off, fewer, normal or more: 0×, 0.5×, 1× and 1.5×.                                                                                   |
| Settings timing   | Game count and playoff format wait for next season. The rest apply at once.                                                          |
| AI playbooks      | Each AI team picks a system from its roster each season.                                                                             |
| Past seasons      | Old season rows keep stats and awards, and drop game lists. Exports include them.                                                    |

## Review Focus

Each line has its test in the owning task.

1. The user is fired, or takes a new job, with an open bid, a trade offer, an undo, a saved game or a live partial game: all of it resolves, the hub shows the new team after a reload, and the old team runs on AI (Task 3).
2. A `0.4.0-beta.10` save at any point takes a partial commit and reloads: it has finances, a job and career totals, and seasons before the upgrade don't show as zeros or crash History (Task 1).
3. An exported franchise with several past seasons imports with its history intact, and a big save stays under the size limit (Task 1, Task 13).
4. Settings change mid-season or mid-offseason: a 41-game season still reaches playoffs with valid awards, the draft and offseason still work, and pending settings apply once (Task 9).
5. Everything is on auto for decades, or everything is off and the user does nothing but press Continue: the save never gets stuck, and nothing asks for a choice that can't be made (Task 8, Task 13).

---

## File Structure

```
src/franchise/club/finance.ts      attendance, revenue, expenses, budgets, season close
src/franchise/club/owner.ts        goals, grades, job security
src/franchise/club/jobs.ts         reputation, offers, taking a job
src/franchise/history/career.ts    career totals, season archive
src/franchise/history/records.ts   league records
src/franchise/history/hall.ts      Hall of Fame scoring
src/franchise/history/news.ts      the news feed
src/franchise/history/power.ts     power rankings
src/franchise/auto.ts              auto-manage for the user's team
src/franchise/settings.ts          league settings and when they apply
src/franchise/coaching/aiPlan.ts   AI systems and tactics
src/app/franchise/hub/             ClubTab, JobPanel, LeagueTab, NewsPanel, PowerPanel, HistoryPanel, RecordsPanel, HallPanel, SettingsTab, ComparePanel
src/ui/SortTable.tsx               a filter box for every table
```

## Types added in Task 1

In `src/franchise/types.ts`, with `FRANCHISE_VERSION = 4`. Later tasks use these names.

```ts
export type BudgetKey = "coaching" | "scouting" | "facilities";
export interface TeamFinance {
  ticketPrice: number;
  budgets: Record<BudgetKey, number>;
  /** 0..100, built slowly by the facilities budget. */
  facilities: number;
  /** 0..100, fan interest. */
  hype: number;
  balance: number;
  season: { revenue: number; expenses: number; attendance: number; homeGames: number };
  lastSeason?: { revenue: number; expenses: number; profit: number; attendance: number };
}
export interface OwnerGoal {
  key: "winning" | "profit" | "development";
  target: number;
}
export interface OwnerReview {
  year: number;
  grades: Record<OwnerGoal["key"], "A" | "B" | "C" | "D" | "F">;
  change: number;
  note: string;
}
export interface JobStint {
  teamId: string;
  league: LeagueId;
  from: number;
  to?: number;
  w: number;
  l: number;
  titles: number;
}
export interface JobState {
  security: number;
  goals: OwnerGoal[];
  /** The owner has given this many seasons so far. */
  seasons: number;
  reviews: OwnerReview[];
  stints: JobStint[];
  fired?: { year: number; teamId: string };
}
export interface CareerLine {
  seasons: number;
  gp: number;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  bestSeasonPts: number;
}
export interface NewsItem {
  id: string;
  date: IsoDate;
  kind: "trade" | "signing" | "injury" | "milestone" | "upset" | "award" | "draft" | "retirement" | "job";
  text: string;
  teamIds: string[];
}
export interface HallEntry {
  id: string;
  name: string;
  pos: Position;
  year: number;
  score: number;
  career: CareerLine;
  awards: number;
  titles: number;
  lastTeamId: string | null;
}
export interface LeagueRecord {
  key: string;
  label: string;
  value: number;
  playerId: string;
  name: string;
  year: number;
}
export type AutoKey = "tactics" | "practice" | "scouting" | "draft" | "contracts" | "freeAgency" | "trades" | "finances" | "roster";
export interface LeagueSettings {
  gamesPerSeason: 82 | 70 | 58 | 41;
  playoffFormat: { firstRoundBestOf: 5 | 7; playIn: boolean };
  tradeDifficulty: "easy" | "normal" | "hard";
  injuries: "off" | "fewer" | "normal" | "more";
  progression: "slow" | "normal" | "fast";
}
```

`Franchise` gains `finance: Record<string, TeamFinance>`, `job: JobState`, `news: NewsItem[]`, `hall: HallEntry[]`, `records: LeagueRecord[]`, `powerLast: Record<string, number>`, `aiTactics: Record<string, TeamTactics>`. `FranchiseSettings` gains `auto: Record<AutoKey, boolean>`, `league: LeagueSettings` and `pendingLeague?: LeagueSettings`. `PlayerFile` gains `career?: CareerLine`, `awards?: number`, `titles?: number`, `untouchable?: boolean`, `lastTeamId?: string`. `RetiredPlayer` gains optional `career`, `awards`, `titles`.

---

## M8: Running the club

### Task 1: Save format 4, career totals and exported history

**Files:**

- Create: `src/franchise/history/career.ts`
- Modify: `src/franchise/types.ts`, `src/engine/types.ts`, `src/franchise/pro/gmState.ts`, `src/franchise/storage.ts`, `src/franchise/core/offseason.ts`, `src/franchise/create.ts`, `src/app/franchise/FranchiseSelect.tsx`
- Test: `src/franchise/__tests__/career.test.ts`, `storage.test.ts`

**Interfaces:**

- Produces: `addSeason(p: Player, line: SeasonLine | undefined, f: Franchise): Player`, `archiveSeason(s: LeagueSeason): LeagueSeason` (no games), `pastSeasons(id: string): Promise<LeagueSeason[]>`.
- Produces: `exportFranchise(f: Franchise, past?: LeagueSeason[]): string`, and `importFranchise` restores `past`.
- `startNewSeason` adds each player's season to `file.career`, adds awards and titles, and archives the old season row.

- [ ] **Step 1: Write the failing tests**

```ts
it("a season adds up in a player's career totals", ...);
it("a traded player's totals include both teams", ...);
it("a player with no games adds no season", ...);
it("awards and titles count once each", ...);
it("an archived season keeps stats and awards and drops games", ...);
it("a beta.10 save opens with finance, a job and empty news, and keeps its stats", ...);
it("a beta.10 save in the offseason opens at its step", ...);
it("every player keeps career totals after a partial commit and a reload", ...); // Review Focus 2
it("an export with three past seasons imports with all three", ...); // Review Focus 3
it("an old export with no past seasons still imports", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/career.test.ts src/franchise/__tests__/storage.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the types, career totals, the archive and full exports**

`fillGmState` stays idempotent. Default finance per team: ticket $120 at a $140M cap, budgets $15M, facilities and hype 50 plus `(prestige - 0.5) * 40`, balance 0. `exportFranchise` writes `past`, and `FranchiseSelect` loads it through `pastSeasons`.

- [ ] **Step 4: Run them to verify they pass**

Run: the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/franchise src/engine/types.ts src/app/franchise
git commit -m "Add save format 4, career totals and full history in exports"
```

### Task 2: Finances

**Files:**

- Create: `src/franchise/club/finance.ts`
- Modify: `src/franchise/core/season.ts`, `src/franchise/core/offseason.ts`, `src/franchise/pro/rules.ts`, `src/franchise/pro/contracts.ts`, `src/franchise/pro/scouting.ts`, `src/franchise/coaching/development.ts`, `src/franchise/core/progress.ts`, `src/franchise/pro/market.ts`
- Test: `src/franchise/__tests__/finance.test.ts`, `rules.test.ts`

**Interfaces:**

- Produces: `attendance(f: Franchise, teamId: string, capacity: number): number`, `homeGameRevenue(f: Franchise, team: Team): number`, `recordHomeGame(f: Franchise, team: Team): Franchise`, `closeSeasonBooks(f: Franchise, teams: Team[]): Franchise`, `setTicketPrice(f, price: number)`, `setBudget(f, key: BudgetKey, amount: number)`, `budgetEffect(f: Franchise, key: BudgetKey): number` (1 at the default), `leagueRevenue(f: Franchise): number`.
- Changes: `nextCap(cap, seed, growth?: number)`. With `growth`, the rise is `clamp(0.045 + growth * 0.5, 0.02, 0.08)`. Without it, it stays 3–6%.

- [ ] **Step 1: Write the failing tests**

```ts
it("a higher ticket price sells fewer seats and can earn more up to a point", ...);
it("attendance never passes the arena's capacity", ...);
it("winning raises hype, and losing lowers it", ...);
it("a bigger arena and more prestige earn more", ...);
it("every home game pays its team", ...);
it("playoff home games pay more", ...);
it("payroll, staff salaries, budgets and dead money are charged across a season", ...);
it("the luxury tax is charged at the end of the season", ...);
it("a typical team makes $20M to $60M at the start", ...);
it("facilities rise with a big budget and fall with a small one", ...);
it("the scouting budget narrows ranges faster", ...);
it("the coaching budget helps development", ...);
it("better facilities improve a free agent's mood", ...);
it("the budget and price limits hold", ...);
it("the cap follows league revenue, within 2 to 8 percent", ...);
it("a season of finance adds under 3 seconds", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/finance.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Demand is `capacity * (0.55 + hype/250 + winShare * 0.3) * (reference / price) ^ 0.8`, capped by capacity, where `reference` is $120 scaled by the cap. Revenue is tickets plus a $2.5M-per-game TV share and sponsors of `prestige * $1.2M` per home game, all scaled by the cap. Each day, `simDay` records a home game for every decided game. `scoutMultiplier` multiplies in `budgetEffect("scouting")`, and development uses `budgetEffect("coaching")`. `budgetEffect` is `sqrt(amount / default)`. `closeSeasonBooks` runs when the champion is decided, inside `advancePostseason`, so the review step can show the year's books. Task 3 adds the owner's review at the same point.

- [ ] **Step 4: Run them to verify they pass**

Run: the same command, then `npx vitest run src/franchise/__tests__/rules.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/franchise
git commit -m "Add club finances: tickets, budgets, the tax and a cap tied to revenue"
```

### Task 3: Owner goals, firing and new jobs

**Files:**

- Create: `src/franchise/club/owner.ts`, `src/franchise/club/jobs.ts`
- Modify: `src/franchise/core/offseason.ts`, `src/franchise/core/season.ts`, `src/state/franchiseStore.ts`
- Test: `src/franchise/__tests__/owner.test.ts`, `jobs.test.ts`

**Interfaces:**

- Produces: `seasonGoals(f: Franchise, teams: Team[]): OwnerGoal[]`, `ownerReview(f: Franchise): OwnerReview`, `applyReview(f: Franchise, r: OwnerReview): Franchise`.
- Produces: `reputation(f: Franchise): number`, `jobOffers(f: Franchise, teams: Team[]): string[]`, `takeJob(f: Franchise, teamId: string, teams: Team[]): Franchise`.
- `canAdvance` returns `{ ok: false, reason: "Choose your next job first." }` while `job.fired` is set.
- `update()` in the store reloads `team` when `teamId` changes.

- [ ] **Step 1: Write the failing tests**

```ts
it("a good team's winning goal is higher than a bad team's", ...);
it("beating every goal raises security, and missing them lowers it", ...);
it("the owner weighs winning most, then profit and development", ...);
it("a new owner gives at least one full season", ...);
it("security stays within 0 to 100", ...);
it("three awful seasons get a coach fired, and a title buys time", ...);
it("a firing keeps the coaching record and the save", ...);
it("offers depend on the record: weak teams for a poor coach, better ones for a strong record", ...);
it("there's always at least one offer", ...);
it("offers never include the team that fired you", ...);
it("taking a job moves the user, resets the plan and clears bids, offers, block, undo and scouting choices", ...); // Review Focus 1
it("the old team runs on AI and stays legal", ...);
it("a suspended or live game for the old team is dropped", ...);
it("the save summary shows the new team after a reload", ...);
it("the offseason can't move on until the user has a job", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/owner.test.ts src/franchise/__tests__/jobs.test.ts`. Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Goals are set when a season starts. Winning: `round(expectedWinShare * games)`, from the team's top-eight rank. Profit: $0 at first, rising with prestige. Development: the summed overall gain of players 25 and under. Weights 0.6, 0.2, 0.2, grades A–F, change +12, +6, 0, -10, -20, with +15 for a title. Reputation is career win share plus titles. Offers are the 3–6 teams ranked lowest whose strength fits it, always including the worst team. `takeJob` writes a job stint, resets `plan` with `defaultPlan()`, clears `freeAgency.bids`, `tradeBlock`, `tradeOffers`, `undo`, `live` and `draft.assigned`, and sets security to 60.

- [ ] **Step 4: Run them to verify they pass**

Run: the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/franchise src/state
git commit -m "Add owner goals, job security, firing and new jobs"
```

### Task 4: The Club tab

**Files:**

- Create: `src/app/franchise/hub/ClubTab.tsx`, `src/app/franchise/hub/JobPanel.tsx`
- Modify: `src/app/franchise/hub/FranchiseHub.tsx`, `OffseasonTab.tsx`, `CapPanel.tsx`, `StaffPanel.tsx`, `e2e/smoke.spec.ts`, the release files
- Test: `e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: Tasks 2–3.

- [ ] **Step 1: Write the failing e2e test**

Add `test("run the club: set prices and budgets, read the owner's review")`: changes the ticket price and a budget, reloads and sees them, sims a season and sees revenue, expenses and the owner's grades at the review.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test -g "run the club"`. Expected: FAIL, the Club tab isn't there.

- [ ] **Step 3: Build the screens**

`ClubTab` holds the ticket price, three budget sliders, attendance, hype, facilities, the season's books, last season, goals and security. `JobPanel` appears at the review and shows grades, then the offers if fired. The Offseason tab opens it first. Add a test that sets `job.security` low through a save edit in `page.evaluate`, then takes an offer and confirms the hub shows the new team after a reload.

- [ ] **Step 4: Verify and push `0.4.0-beta.11`**

Run the full gate from Global Constraints. Expected: all pass, and `curl` shows `0.4.0-beta.11`.

```bash
git add -A
git commit -m "0.4.0-beta.11: running the club — tickets, budgets, owner goals, firing and new jobs"
git push origin prerelease
```

### Task 5: News and power rankings

**Files:**

- Create: `src/franchise/history/news.ts`, `src/franchise/history/power.ts`
- Modify: `src/franchise/core/season.ts`, `src/franchise/core/offseason.ts`, `src/franchise/pro/freeAgency.ts`, `src/franchise/pro/tradeAi.ts`, `src/franchise/pro/draft.ts`
- Test: `src/franchise/__tests__/news.test.ts`, `power.test.ts`

**Interfaces:**

- Produces: `addNews(f: Franchise, items: Omit<NewsItem, "id">[]): Franchise`, `gameNews(f: Franchise, g: ScheduledGame, r: BoxResult, teams: Team[]): Omit<NewsItem, "id">[]`, `moveNews(...)` helpers per event, `NEWS_LIMIT = 300`.
- Produces: `powerRankings(f: Franchise): { teamId: string; rank: number; last: number; score: number }[]`.

- [ ] **Step 1: Write the failing tests**

```ts
it("a long injury to a good player makes the news, and a short one to a bench player doesn't", ...);
it("an upset makes the news: a big gap in win share, or any playoff elimination", ...);
it("a 50-point game makes the news", ...);
it("career milestones appear once", ...);
it("trades, big signings, the first pick, awards, retirements and firings make the news", ...);
it("news stays under the limit, newest kept", ...);
it("news ids stay unique across seasons", ...);
it("a reload gives the same news", ...);
it("rankings cover all 30 teams with no ties", ...);
it("winners rank above losers, and recent form counts", ...);
it("before any games, roster strength sets the order", ...);
it("movement compares with last week", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/news.test.ts src/franchise/__tests__/power.test.ts`. Expected: FAIL, modules not found.

- [ ] **Step 3: Implement, run the tests, commit**

The score blends win share, point difference and top-eight strength, with roster strength counting less as games pass. `powerLast` updates on the weekly tick. Text uses team names and player names at the moment it's written, so it stays correct after trades. Expected after implementing: PASS.

```bash
git add src/franchise
git commit -m "Add the news feed and power rankings"
```

### Task 6: History, records and the Hall of Fame

**Files:**

- Create: `src/franchise/history/records.ts`, `src/franchise/history/hall.ts`
- Modify: `src/franchise/core/offseason.ts`, `src/franchise/core/season.ts`
- Test: `src/franchise/__tests__/records.test.ts`, `hall.test.ts`

**Interfaces:**

- Produces: `updateRecords(f: Franchise): Franchise`, `gameRecords(f: Franchise, g: ScheduledGame, box: BoxScore): Franchise`, `hallScore(p: Player): number`, `HALL_BAR`, `induct(f: Franchise, retired: RetiredPlayer, p: Player): Franchise`.

- [ ] **Step 1: Write the failing tests**

```ts
it("a new single-season high replaces the record", ...);
it("career records use retired players as well as active ones", ...);
it("per-game records need a minimum number of games", ...);
it("the user's single-game records come from box scores", ...);
it("a great career makes the Hall, and a long ordinary one doesn't", ...);
it("the Hall keeps a retired player's stats after his row is gone", ...);
it("about one to three players a year are inducted over 25 seasons", ...);
it("seasons from before the upgrade don't break records", ...); // Review Focus 2
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/records.test.ts src/franchise/__tests__/hall.test.ts`. Expected: FAIL, modules not found.

- [ ] **Step 3: Implement, run the tests, commit**

The score weighs points, rebounds and assists, plus 10 per major award and 6 per title, tuned so the induction test holds. Expected after implementing: PASS.

```bash
git add src/franchise
git commit -m "Add league records and the Hall of Fame"
```

### Task 7: The League tab

**Files:**

- Create: `src/app/franchise/hub/LeagueTab.tsx`, `NewsPanel.tsx`, `PowerPanel.tsx`, `HistoryPanel.tsx`, `RecordsPanel.tsx`, `HallPanel.tsx`
- Modify: `src/app/franchise/hub/FranchiseHub.tsx`, `HomeTab.tsx`, `e2e/smoke.spec.ts`, the release files
- Test: `e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: Tasks 1, 5 and 6, and `useLegends()` from `src/state/legends.ts`.

- [ ] **Step 1: Write the failing e2e test**

Add `test("the league remembers: news, rankings, history, records and the Hall")`: sims a season and an offseason, then opens each section and reloads. It seeds one Road to Legend entry with `saveLegend` through `localStorage` and expects it in the Hall under "Road to Legend".

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test -g "the league remembers"`. Expected: FAIL, the League tab isn't there.

- [ ] **Step 3: Build the screens**

`LeagueTab` uses a `Segmented` control for News, Power rankings, History, Records and Hall of Fame. News filters by kind and "my team". History lists each season's champion, awards and the user's record, using `f.history`, with full tables from `pastSeasons`. Home shows the three latest items and the user's power rank.

- [ ] **Step 4: Verify and push `0.4.0-beta.12`**

Run the full gate from Global Constraints. Expected: all pass, and `curl` shows `0.4.0-beta.12`.

```bash
git add -A
git commit -m "0.4.0-beta.12: league life — news, power rankings, history, records, the Hall of Fame and Legends"
git push origin prerelease
```

---

## M9: Pro finish

### Task 8: Auto-manage

**Files:**

- Create: `src/franchise/auto.ts`
- Modify: `src/franchise/core/season.ts`, `src/franchise/core/offseason.ts`, `src/franchise/pro/freeAgency.ts`, `src/franchise/pro/tradeAi.ts`, `src/franchise/simRun.ts`
- Test: `src/franchise/__tests__/auto.test.ts`

**Interfaces:**

- Produces: `AUTO_KEYS: { key: AutoKey; label: string; hint: string }[]`, `setAuto(f: Franchise, key: AutoKey, on: boolean): Franchise`, `autoStep(f: Franchise): Franchise`, `autoFinances(f: Franchise, teams: Team[]): Franchise`, `simOffseason(f: Franchise, teams: Team[]): Franchise`, and `aiBids` and `aiTradeDay` include the user's team when its key is on.
- Rotation stays `plan.autoRotation`, and the toggle lives with the others.

- [ ] **Step 1: Write the failing tests**

```ts
it("with auto draft on, the user's pick is made", ...);
it("with auto scouting on, twelve prospects are followed", ...);
it("with auto contracts on, options are decided and valued players re-sign", ...);
it("with auto free agency on, the user's team bids legally", ...);
it("with auto trades on, the user's team can trade, and it's in the news", ...);
it("auto trades never touch a player the user has marked as untouchable", ...);
it("with auto roster on, a short roster fills in season without blocking a sim", ...);
it("with auto finances on, the ticket price moves toward what sells out", ...);
it("with auto tactics on, a system fits the roster", ...);
it("with auto practice on, focus follows the roster's weakest area", ...);
it("with everything off, nothing changes on the user's team", ...);
it("simOffseason gets from the review to opening day with everything on", ...);
it("simOffseason stops with a clear reason when a choice is needed", ...); // Review Focus 5
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/franchise/__tests__/auto.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement, run the test, commit**

New franchises start with everything off except `roster`, so a sim is never blocked by surprise. Old saves get the same. A player is untouchable through a new `file.untouchable` flag, set on the Roster tab. Expected after implementing: PASS.

```bash
git add src/franchise
git commit -m "Add auto-manage for every system"
```

### Task 9: League settings

**Files:**

- Create: `src/franchise/settings.ts`
- Modify: `src/career/pro/bracket.ts`, `src/franchise/leagues/pro.ts`, `src/franchise/boxsim.ts`, `src/franchise/core/progress.ts`, `src/franchise/pro/tradeAi.ts`, `src/franchise/core/offseason.ts`, `src/franchise/core/awards.ts`, `src/franchise/create.ts`
- Test: `src/franchise/__tests__/settings.test.ts`

**Interfaces:**

- Produces: `DEFAULT_LEAGUE: LeagueSettings`, `setLeagueSettings(f: Franchise, patch: Partial<LeagueSettings>): Franchise`, `applyPending(f: Franchise): Franchise`, `trimSchedule(games: ScheduledGame[], teamIds: string[], perTeam: number, seed: string): ScheduledGame[]`.
- Changes: `BracketInput` gains optional `format`. With none, it behaves exactly as now, so Road to Legend is unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
it("each game count gives every team exactly that many games, about half at home", ...);
it("a 41-game season reaches a champion with valid awards", ...); // Review Focus 4
it("best of five shortens the first round only", ...);
it("with no play-in, seeds 7 and 8 go straight through", ...);
it("the career bracket is unchanged with no format", ...);
it("game count and playoff format wait for next season, and apply once", ...);
it("changing them twice keeps the last choice", ...);
it("trade difficulty changes what the AI accepts at once", ...);
it("no injuries means none, and more means more", ...);
it("progression speed scales yearly change, both ways", ...);
it("the defaults reproduce today's results exactly", ...);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/franchise/__tests__/settings.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement, run the test, commit**

`trimSchedule` removes games in seeded order only when both teams are above the target, then repairs any team left over by swapping a pair. Expected after implementing: PASS, and the engine-lock and tactics baselines pass unchanged.

```bash
git add src/franchise src/career/pro/bracket.ts
git commit -m "Add league settings: game count, playoff format, trade difficulty, injuries and progression"
```

### Task 10: AI playbooks

**Files:**

- Create: `src/franchise/coaching/aiPlan.ts`
- Modify: `src/franchise/core/season.ts`, `src/franchise/match.ts`, `src/franchise/core/offseason.ts`
- Test: `src/franchise/__tests__/aiPlan.test.ts`

**Interfaces:**

- Produces: `aiTactics(roster: Player[], seed: string): TeamTactics`.

- [ ] **Step 1: Write the failing tests**

```ts
it("a roster of shooters plays pace and space, and a great post scorer plays post-up", ...);
it("a team's system stays the same through a season", ...);
it("it picks legal plays, at most six, and they fit the system", ...);
it("AI systems reach played games and simulated games", ...);
it("league scoring stays within 3 percent of the baseline with every team coached", ...);
it("a coached AI team plays the same after a reload", ...);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/franchise/__tests__/aiPlan.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement, run the test, commit**

The result depends only on the roster at the season's start and is stored in `f.aiTactics`, so reloads match. `startNewSeason` fills it, and `fillGmState` fills it for older saves. Tune on `SOAK=1`. Expected after implementing: PASS.

```bash
git add src/franchise
git commit -m "Give AI teams playbooks and tactics"
```

### Task 11: Settings, comparison and filters

**Files:**

- Create: `src/app/franchise/hub/SettingsTab.tsx`, `src/app/franchise/hub/ComparePanel.tsx`
- Modify: `src/ui/SortTable.tsx`, `src/app/franchise/new/FranchiseCreator.tsx`, `src/app/franchise/hub/FranchiseHub.tsx`, `RosterTab.tsx`, `OffseasonTab.tsx`, `FreeAgentsTab.tsx`, `LeadersTab.tsx`, `StandingsTab.tsx`, `DraftTab.tsx`, `src/app/MainMenu.tsx`, `e2e/smoke.spec.ts`
- Test: `src/franchise/__tests__/compare.test.ts`, `e2e/smoke.spec.ts`

**Interfaces:**

- Produces: `compareRows(a: Player, b: Player, f: Franchise): { label: string; a: string; b: string; better: "a" | "b" | null }[]`, `compareTeams(f: Franchise, a: string, b: string, teams: Team[])` in `src/franchise/history/compare.ts`.
- `SortTable` gains `filter?: (row: T) => string`, which shows a search box.

- [ ] **Step 1: Write the failing tests**

```ts
it("the better value is marked on each row, and ties mark neither", ...);
it("an unknown rookie's rating doesn't leak into a comparison", ...);
it("a retired player can be compared from the Hall", ...);
it("team comparison covers record, payroll, top eight and picks", ...);
```

Add `test("change settings, turn on auto-manage and compare two players")`, which sets a 41-game league, sees it wait for next season, turns on every toggle, presses Sim the offseason after a season, filters a table and compares two players.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/compare.test.ts`, then `npx playwright test -g "change settings"`. Expected: FAIL, module and tab not found.

- [ ] **Step 3: Build the screens**

`SettingsTab` holds league settings, with a "Starts next season" note on those that wait, then the auto-manage toggles and the play settings. `FranchiseCreator` offers the same league settings. Every franchise table gets a filter box. The Roster tab gets Compare and Untouchable. The main menu's Franchise card drops its beta label, as the spec says for M9, and its detail text is updated.

- [ ] **Step 4: Run them to verify they pass, then commit**

Run: the same commands after `npm run build`. Expected: PASS.

```bash
git add -A
git commit -m "Add the Settings tab, comparison tools and table filters"
```

### Task 12: Close the known gaps

**Files:**

- Modify: `src/ui/MatchupPicker.tsx`, `src/franchise/boxsim.ts`, `src/franchise/core/season.ts`, `src/ui/game/PlaysPanel.tsx`, `src/franchise/core/awards.ts`, `src/app/franchise/hub/actions.ts`, `RosterTab.tsx`, `FreeAgentsTab.tsx`, `src/franchise/pro/freeAgency.ts`, `src/franchise/pro/trades.ts`, `src/franchise/__tests__/tradeAi.test.ts`, `e2e/smoke.spec.ts`
- Test: the files above

**Interfaces:**

- Produces: `moveProblem` reasons from `signTwoWay`, `signDev`, `callUp` and `claimWaiver` as `{ ok: false; reason }`, shown in a toast. `FreeAgencyState.notices` keeps every round.

- [ ] **Step 1: Write a failing test for each deferred item**

```ts
it("the matchup picker lists a manual starter ranked sixth", ...);
it("simulated games ignore matchups under a zone", ...);
it("a partial game finishes through finishPartial when simmed", ...);
it("the call control's label names the system's play", ...);
it("Leaders shows a player's last team in the offseason", ...);
it("a refused two-way, call-up or claim gives its reason", ...);
it("skipping to camp keeps every round's bid messages", ...);
it("a trade can't take a team past three two-way players", ...);
it("the free agents table uses a range-safe value for unknown players", ...);
it("the AI refuses a star for role players on value, with the roster limit out of the way", ...);
it("the AI's margin holds at the boundary: just under refuses, just over accepts", ...);
```

Also change the option and re-sign e2e steps to assert their outcomes, and the trade-block e2e to assert an offer.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run`, then the changed e2e tests. Expected: each new test fails on its own gap.

- [ ] **Step 3: Fix each one, run the tests, commit**

Leaders takes the last team from `file.lastTeamId`, set when a player leaves a team. Expected after fixing: PASS.

```bash
git add -A
git commit -m "Close the gaps left from earlier reviews"
```

### Task 13: Decades soak and M9 release

**Files:**

- Modify: `src/franchise/__tests__/soak.test.ts`, tuning constants in `club/finance.ts`, `club/owner.ts`, `history/hall.ts`, the release files
- Test: `src/franchise/__tests__/soak.test.ts`

**Interfaces:**

- Consumes: everything above.

- [ ] **Step 1: Write the failing tests**

With `SOAK=1`, run 50 seasons in each of three modes: everything on auto, everything off with the user pressing Continue only, and a user who is fired at least once. After each season, add to the existing limits:

```ts
expect(medianProfit(f)).toBeWithin(-30e6 * capScale, 80e6 * capScale);
expect(teamsLosingEveryYear(f)).toBe(0);
expect(capRise).toBeWithin(0.02, 0.08);
expect(hallInductions).toBeWithin(10, 150); // over 50 seasons
expect(playerRows(f)).toBeLessThan(800);
expect(canAdvanceThrough(f)).toBe(true); // Review Focus 5
```

Then add, on a save after 50 seasons: `expect(exportFranchise(f, past).length).toBeLessThan(40e6)`, a pro season under one minute, and a reload that matches. This meets the spec's Limits section. Review Focus 3.

- [ ] **Step 2: Run it to record the current state**

Run: `SOAK=1 SOAK_SEED=<seed> npx vitest run src/franchise/__tests__/soak.test.ts --testTimeout=1800000` for five seeds. Expected: FAIL on at least one measure, or PASS. Record the numbers.

- [ ] **Step 3: Tune**

Change only the listed constants, one at a time. If a failure is a bug, fix it with its own failing test first.

- [ ] **Step 4: Verify on x64, then push `0.4.0-beta.13`**

Run the soak on Arm for five seeds and on x64, then the full gate from Global Constraints. Expected: all pass, and `curl` shows `0.4.0-beta.13`.

```bash
git add -A
git commit -m "0.4.0-beta.13: the pro finish — auto-manage, league settings, AI playbooks, comparison tools and decades of soak testing"
git push origin prerelease
```
