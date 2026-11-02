# Franchise M5–M7: Offseason, Contracts and Trades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pro franchise runs for as many seasons as the user likes: players age and retire, classes are scouted and drafted, contracts expire, free agents sign, and teams trade. Ships to `/beta/` as `0.4.0-beta.7` (M5), `.8` (M6) and `.9` (M7).

**Architecture:** Pure modules under `src/franchise/pro/` and `src/franchise/core/` take a `Franchise` and return a new one. One offseason state machine, listed per league in `LeagueModule.offseasonSteps`, drives every step. Every user roster move goes through one wrapper that records undo and prunes the coaching plan, and AI teams use the same legality checks as the user.

**Tech Stack:** TypeScript, Next.js static export, Dexie, zustand, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-phase3-franchise-design.md` (Pro rules, GM systems, League life, Quality of life)

## Global Constraints

- Work on `prerelease`. Never merge to `main` without the user's go-ahead.
- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code.
- Root-relative file paths go through `asset()` in `src/lib/site.ts`.
- `src/franchise/` has no React and no `window` access.
- No real league marks or real people's names. The rule is called "veteran rights", never the real-world name.
- All cap numbers live in `src/franchise/pro/rules.ts` and scale with the cap.
- Road to Legend, Quick Play and the park keep their behavior and saves. Existing tests are not edited to make them pass, except the two Home-tab e2e lines that this plan changes on purpose (Task 5).
- `FRANCHISE_VERSION` becomes 3, and `0.4.0-beta.6` saves keep working, in season and in the offseason.
- Bump versions by editing the `version` lines in `package.json` and `package-lock.json` only.
- Every push updates `CHANGELOG.md`, README, How to Play, Terms, Privacy, Credits and the sitemap as needed.
- A push is done only after `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run format:check`, `npx playwright test` on the live build and `--grep-invert @gpu` on the beta build pass, and `curl` shows the new version on `/beta/`. Statistical thresholds also run on x64 under Rosetta.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions this plan makes

The spec leaves these open. Each is cheap to change at this stage.

| Question            | Decision                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offseason order     | Season review, progression and retirements, lottery, draft, contracts, free agency, camp. This follows the M5 list, so players sign after their new ratings are known. |
| Contract shape      | One flat salary per year. No yearly raises.                                                                                                                            |
| Roster floor        | 13 standard players. A user team outside 13–15 can't sim or play a game. In the offseason the ceiling is 20 until camp ends.                                           |
| Bidding             | Moratorium Jul 1–6, then 5 bidding rounds two days apart. Anyone left stays on the open market all season, and their ask falls.                                        |
| Developmental deals | Up to 3 players per team, outside the roster and cap, who can't play until called up.                                                                                  |
| Two-way limit       | Up to 50 games, no playoffs, outside the cap and the 15.                                                                                                               |
| Multi-team trades   | Up to three teams.                                                                                                                                                     |
| Left out            | Cap holds, restricted free agency, pick protections, contract stretching and draft stashing. None is in the spec. Sign-and-trades are in.                              |
| Budgets             | Scouting uses the scout's rating and assignments. M8 adds the budget through one multiplier. Staff salaries and the luxury tax are shown but not charged until M8.     |
| Cap growth          | 3–6% a year, seeded. M8 ties it to league revenue.                                                                                                                     |
| Past seasons        | Each season's summary stays on the save, so it survives export. Full past season rows stay in the database for M8 and aren't exported yet.                             |

## Review Focus

Each line has its test in the owning task.

1. A retired, released or expired player still appears in this season's awards or leaders: every screen shows him, with no crash and no blank team (Tasks 2, 7).
2. A `0.4.0-beta.6` save takes a partial commit and reloads: every player still has his new fields, and retired players never come back from the database (Task 1).
3. The user trades or releases a player in the saved depth chart, in the game plan, or during a game that's partway through or suspended: the plan repairs itself, and moves wait until the game is done (Task 12).
4. A bid or trade became illegal after it was made because the cap, roster or deadline changed: it's refused with the reason, and nothing half-applies (Tasks 9, 11).
5. A team runs out of cap room, players or picks over many seasons: rosters stay legal, every team stays able to field a lineup, and league talent stays stable (Task 15).

---

## File Structure

```
src/franchise/pro/rules.ts        every cap number, scaled by year
src/franchise/pro/cap.ts          payroll, dead money, exceptions, rights, what a team can pay
src/franchise/pro/picks.ts        creating, owning and valuing draft picks
src/franchise/pro/draftClass.ts   generating a class
src/franchise/pro/scouting.ts     assignments, ranges, what the user sees
src/franchise/pro/lottery.ts      draft order
src/franchise/pro/draft.ts        running the draft, rookie deals
src/franchise/pro/contracts.ts    options, expiry, extensions, the new contract year
src/franchise/pro/rosterMoves.ts  release, waivers, buyouts, two-way and developmental deals
src/franchise/pro/market.ts       player value, mood, asks, negotiation
src/franchise/pro/freeAgency.ts   moratorium, bidding rounds, the open market, AI signings
src/franchise/pro/tradeValue.ts   what an asset is worth to a team
src/franchise/pro/trades.ts       legality and applying a deal
src/franchise/pro/tradeAi.ts      acceptance, finder, block, AI-to-AI deals
src/franchise/core/progress.ts    aging, progression, retirement
src/franchise/core/offseason.ts   the step machine and the new season
src/franchise/core/moves.ts       undo and the roster-move wrapper
src/app/franchise/hub/            OffseasonTab, DraftTab, ProgressPanel, ContractsPanel, CapPanel, FreeAgentsTab, NegotiateDialog, TradesTab, TradeBuilder
src/franchise/__tests__/          one test file per module, plus soak.test.ts
```

## Types added in Task 1

In `src/franchise/types.ts`, with `FRANCHISE_VERSION = 3`. Later tasks use these names.

```ts
export interface DraftPick {
  id: string;
  year: number;
  round: 1 | 2;
  originalTeamId: string;
  ownerId: string;
}
export interface DeadCap {
  playerId: string;
  name: string;
  salary: number;
  years: number;
}
export interface PlayerFile {
  service: number; // pro seasons played
  teamSeasons: number; // seasons in a row with this team
  draft?: { year: number; pick: number; teamId: string };
  /** The team that holds his veteran rights while he's a free agent. */
  rightsTeamId?: string;
  /** What the league believes about a rookie until he plays. */
  range?: { ovr: [number, number]; pot: [number, number] };
}
export interface CapState {
  year: number;
  salaryCap: number;
}
export interface TeamBooks {
  dead: DeadCap[];
  midLevelUsed: number;
  biannualYear?: number;
}
export type OffseasonStep = "review" | "progress" | "lottery" | "draft" | "contracts" | "freeAgency" | "camp";
export interface OffseasonState {
  step: OffseasonStep;
  report: ProgressReport | null;
}
export interface ProgressReport {
  retired: string[];
  changes: { id: string; before: number; after: number }[];
}
export interface DraftState {
  year: number;
  prospects: Player[];
  /** Scouting points per prospect. */
  scouting: Record<string, number>;
  assigned: string[];
  order?: string[]; // pick ids in draft order
  lottery?: { teamId: string; from: number; to: number }[];
  results: { pickId: string; playerId: string; teamId: string }[];
}
export interface WaiverEntry {
  playerId: string;
  fromTeamId: string;
  until: IsoDate;
}
export interface RetiredPlayer {
  id: string;
  name: string;
  pos: Position;
  year: number;
  age: number;
  peak: number;
  lastTeamId: string | null;
}
export interface SeasonSummary {
  year: number;
  championId?: string;
  record: { w: number; l: number };
  awards: (Award & { name: string })[];
}
export interface UndoRecord {
  label: string;
  before: Partial<Franchise>;
  players: Record<string, Player | null>;
}
```

`Franchise` gains `cap`, `picks`, `books: Record<string, TeamBooks>`, `freeAgents: string[]`, `devRosters: Record<string, string[]>`, `waivers`, `draft`, `offseason?`, `freeAgency?` (Task 9), `talks: Record<string, number>` (negotiation tries), `tradeBlock: string[]` and `tradeOffers` (Task 13), `undo?`, `retired: RetiredPlayer[]` and `history: SeasonSummary[]`. `Player` gains an optional `file?: PlayerFile`. `Contract` gains optional `teamOptionYears?: number`, `dev?: boolean` and `extension?: { salary: number; years: number }`.

---

## M5: Offseason

### Task 1: Save format 3, rules and picks

**Files:**

- Create: `src/franchise/pro/rules.ts`, `src/franchise/pro/picks.ts`
- Modify: `src/franchise/types.ts`, `src/engine/types.ts`, `src/franchise/create.ts`, `src/franchise/storage.ts`
- Test: `src/franchise/__tests__/rules.test.ts`, `picks.test.ts`, `storage.test.ts`

**Interfaces:**

- Produces: `capRules(cap: CapState): CapRules`, where `CapRules` has `salaryCap, taxLine, firstApron, secondApron, maxSalary(service), minSalary, midLevel, taxMidLevel, roomMidLevel, biannual, twoWaySalary, devSalary, tradeCushion`. Constants: `ROSTER_MAX = 15`, `ROSTER_MIN = 13`, `OFFSEASON_ROSTER_MAX = 20`, `TWO_WAY_MAX = 3`, `TWO_WAY_GAMES = 50`, `DEV_MAX = 3`.
- Produces: `nextCap(cap: CapState, seed: string): CapState`, `futurePicks(teamIds: string[], fromYear: number, count: number): DraftPick[]`, `rollPicks(f: Franchise, teams: Team[]): DraftPick[]`.
- Produces: `commitFranchise` with no `changedPlayers` mirrors the save exactly, deleting player rows no longer in `f.players`.

- [ ] **Step 1: Write the failing tests**

```ts
it("starts at the spec's numbers", () => {
  const r = capRules({ year: 2026, salaryCap: 140e6 });
  expect([r.taxLine, r.firstApron, r.secondApron, r.minSalary]).toEqual([170e6, 178e6, 189e6, 1.2e6]);
  expect([r.maxSalary(0), r.maxSalary(7), r.maxSalary(10)]).toEqual([35e6, 42e6, 49e6]);
});
it("scales every number with the cap", () => expect(capRules({ year: 2030, salaryCap: 168e6 }).taxLine).toBe(204e6));
it("raises the cap 3 to 6 percent a year, and the same seed repeats", ...);
it("gives every team two picks in each of the next four drafts", ...);
it("a retired player's row is gone after a full commit and reload", ...);
it("a beta.6 save opens with default books, picks, cap and a class, and keeps its stats", ...);
it("a beta.6 save in the offseason opens at the review step", ...);
it("every player has a file after a partial commit and a reload", ...); // Review Focus 2
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/rules.test.ts src/franchise/__tests__/picks.test.ts src/franchise/__tests__/storage.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the types, rules, picks, creation, migration and exact full commits**

Ratios of the cap: tax 170/140, first apron 178/140, second 189/140, minimum 1.2/140, max 25/30/35% for service 0–6, 7–9, 10+, mid-level 9.2%, taxpayer mid-level 3.7%, room mid-level 5.6%, biannual 3.4%, two-way 0.43%, developmental 0.03%, trade cushion 0.18%. Round to $10,000.

Migration stays idempotent and doesn't depend on `version`, because partial commits leave old player rows behind. Fill `file` from a `Rng` seeded by `${f.seed}:file:${p.id}`: `service = clamp(age - 20, 0, 18)`, `teamSeasons = int(0, min(service, 6))`. Existing salaries stay, even above the max. `createFranchise` builds the same fields. The first class comes from `newDraftState` (Task 3): until that exists, an empty state.

- [ ] **Step 4: Run them to verify they pass**

Run: the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/franchise src/engine/types.ts
git commit -m "Add save format 3 with cap rules and draft picks"
```

### Task 2: Aging, progression and retirement

**Files:**

- Create: `src/franchise/core/progress.ts`
- Modify: `src/app/franchise/hub/LeadersTab.tsx`
- Test: `src/franchise/__tests__/progress.test.ts`

**Interfaces:**

- Produces: `progressPlayer(p: Player, rng: Rng, bonus?: number): Player`, `retires(p: Player, rng: Rng, signed: boolean): boolean`, `leagueProgress(f: Franchise): { franchise: Franchise; report: ProgressReport }`.
- Retiring players leave rosters and get `teamId: null`, but stay in `f.players` until the new season, because this season's awards and stats still point at them. `core/offseason.ts` moves them to `f.retired`.

- [ ] **Step 1: Write the failing tests**

```ts
it("adds a year to everyone", ...);
it("young players with room grow on average, and those past 32 decline", ...); // 2,000 samples per age band
it("never leaves ratings outside 25..99 or overall above potential for under-29s", ...);
it("work ethic and a good development coach help the user's young players", ...);
it("a 38-year-old without a deal almost always retires, and a 27-year-old never does", ...);
it("a 28-or-older player's potential falls to his overall", ...);
it("the Leaders table still renders a retired player's row", ...); // Review Focus 1: pure helper leaderRow(f, teams, id)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/progress.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement progression**

Mean overall change by age after the birthday: ≤21 +2.4, 22–24 +1.5, 25–27 +0.5, 28–29 0, 30–31 −0.7, 32–33 −1.5, 34+ −2.5. Scale gains by remaining room (`potential - ovr`), add `(workEthic - 0.5) * 1.2`, and add noise with sd `2.2 - consistency`. Apply it as a shared rating shift searched to the target overall, as `generatePlayer` does, with leg ratings (`speed, accel, vertical, stamina`) taking 1.6× the loss. Only the user's team gets `bonus = (staffRating("development") - 50) / 45`. Retirement chance: 0 under 32, then rising with age and falling with overall; unsigned players at 2.5× that, and certain at 41.

Move the Leaders row logic into exported `leaderRow(f, teams, id)`, with an empty team for a free agent or retired player.

- [ ] **Step 4: Run the tests, then commit**

Run: the same command. Expected: PASS.

```bash
git add src/franchise src/app/franchise
git commit -m "Age, grow and retire the whole league each offseason"
```

### Task 3: Draft classes and scouting

**Files:**

- Create: `src/franchise/pro/draftClass.ts`, `src/franchise/pro/scouting.ts`
- Modify: `src/franchise/core/season.ts`, `src/franchise/create.ts`, `src/franchise/storage.ts`
- Test: `src/franchise/__tests__/draftClass.test.ts`, `scouting.test.ts`

**Interfaces:**

- Produces: `newDraftState(seed: string, year: number): DraftState`, with 70 prospects, ids `draft-<year>-<n>`, ages 19–22, no contract, `teamId: null`.
- Produces: `MAX_ASSIGNED = 12`, `assignScout(f: Franchise, id: string, on: boolean): Franchise`, `weeklyScouting(f: Franchise): Franchise`, `prospectRange(f: Franchise, p: Player): { ovr: [number, number]; pot: [number, number] }`, `scoutMultiplier(f: Franchise): number` (rating only, M8 adds budget).
- Produces: `shownOvr(p: Player): string` and `isUnknown(p: Player): boolean`, which read `file.range`. Every UI overall from here on goes through `shownOvr`.
- `record` in `core/season.ts` clears `file.range` the first time a player logs minutes.

- [ ] **Step 1: Write the failing tests**

```ts
it("the top prospect averages 76-80 and the last 58-64", ...);
it("younger prospects carry more potential", ...);
it("the same seed and year give the same class, and the next year differs", ...);
it("the true rating is always inside the range", ...); // every prospect, every point level
it("ranges narrow with points and with a better scout", ...);
it("a prospect's range doesn't jump around as points are added", ...); // the old range contains the new one
it("assignments stop at twelve", ...);
it("simDay adds scouting points weekly to assigned prospects, and fewer to the rest", ...);
it("a rookie shows a range until he plays, then his overall", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/draftClass.test.ts src/franchise/__tests__/scouting.test.ts`. Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Target overall `79 - i * 0.26 + normal(0, 2)` for rank `i`, potential `ovr + youth * range(3, 9) + normal(0, 2.5)`, with one prospect in 12 classes a generational talent at 84–86 and potential 97+. These numbers are calibrated in Task 15.

The half-width of a range is `10 / sqrt(1 + points * scoutMultiplier / 6)`, minimum 1. The center's offset comes from a fixed seeded value in −0.7..0.7 multiplied by the half-width, so truth stays inside and ranges nest. Each week assigned prospects gain 3 points, and everyone else gains 0.4.

- [ ] **Step 4: Run the tests, then commit**

Run: the same command. Expected: PASS.

```bash
git add src/franchise
git commit -m "Generate draft classes and scout them through the season"
```

### Task 4: Lottery and draft

**Files:**

- Create: `src/franchise/pro/lottery.ts`, `src/franchise/pro/draft.ts`
- Test: `src/franchise/__tests__/lottery.test.ts`, `draft.test.ts`

**Interfaces:**

- Produces: `LOTTERY_ODDS = [140,140,140,125,105,90,75,60,45,30,20,15,10,5]`, `runLottery(f: Franchise, teams: Team[]): Franchise`, which sets `draft.order` and `draft.lottery`.
- Produces: `rookieDeal(pick: number, rules: CapRules): Contract`, `makePick(f: Franchise, prospectId: string): Franchise`, `simToUserPick(f: Franchise): Franchise`, `simDraftToEnd(f: Franchise): Franchise`, `aiChoice(f: Franchise, teamId: string): string`, `currentPick(f: Franchise): DraftPick | null`, `trimRoster(f: Franchise, teamId: string): Franchise`.

- [ ] **Step 1: Write the failing tests**

```ts
it("over 20,000 lotteries the worst team gets the first pick 14% of the time", ...); // 12.5%..15.5%
it("only the top four picks move, and no team falls more than four places", ...);
it("only teams that missed the playoffs enter, including play-in losers", ...);
it("the second round runs in reverse record order, unshuffled", ...);
it("a traded pick is made by its owner", ...);
it("each first-rounder signs two guaranteed years plus two team options on the scale", ...); // #1 $12.5M at a $140M cap
it("each second-rounder signs two guaranteed years plus one team option", ...);
it("scale pay rises with the cap", ...);
it("an AI team passes a better player only for a clear need", ...);
it("a drafted player's file records the year, pick and team", ...);
it("the user can't pick out of turn or take a player twice", ...);
it("simToUserPick stops at the user's next pick and simDraftToEnd finishes it", ...);
it("after the draft, undrafted prospects are free agents and keep their ranges until they play", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/lottery.test.ts src/franchise/__tests__/draft.test.ts`. Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Draw four winners without replacement by odds, then the rest by record. Non-playoff teams are those with no series of `round >= 1`. Playoff teams then follow by record. Ties break by a seeded shuffle. AI board score is the midpoint of its own `prospectRange` read at a flat 12 points, plus 2 for a position it has fewer than two of. `rookieDeal`: first round `round(12.5e6 * 0.937^(pick-1) * cap/140e6)`, `years: 4, teamOptionYears: 2`; second round `(1.3e6 - (pick-31) * 4000) * cap/140e6`, `years: 3, teamOptionYears: 1`. Both `rookie: true`. A drafted player keeps a `file.range` read from his team's scouting: the user's own read for the user, the flat AI read for others.

`trimRoster` releases the lowest-value players down to the offseason ceiling with no waivers. M6 replaces it for the user's team.

- [ ] **Step 4: Run the tests, then commit**

Run: the same command. Expected: PASS.

```bash
git add src/franchise
git commit -m "Run the draft lottery and a two-round draft"
```

### Task 5: The offseason and the next season

**Files:**

- Create: `src/franchise/core/offseason.ts`, `src/app/franchise/hub/OffseasonTab.tsx`, `src/app/franchise/hub/DraftTab.tsx`, `src/app/franchise/hub/ProgressPanel.tsx`
- Modify: `src/franchise/leagues/index.ts`, `src/franchise/leagues/pro.ts`, `src/franchise/core/season.ts`, `src/app/franchise/hub/FranchiseHub.tsx`, `src/app/franchise/hub/HomeTab.tsx`, `src/app/franchise/hub/RosterTab.tsx`, `e2e/smoke.spec.ts`, the release files
- Test: `src/franchise/__tests__/offseason.test.ts`, `e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: Tasks 1–4.
- Produces: `LeagueModule.offseasonSteps: OffseasonStep[]`, `canAdvance(f: Franchise): { ok: true } | { ok: false; reason: string }`, `advanceOffseason(f: Franchise, teams: Team[]): Franchise`, `startNewSeason(f: Franchise, teams: Team[]): Franchise`.
- In M5 the `contracts` and `freeAgency` steps pass straight through, with each contract losing a year and expired AI deals rolling one more year at the same salary. Task 7 replaces this.

- [ ] **Step 1: Write the failing tests**

```ts
it("walks every step in order, on the right dates", ...);
it("won't leave the draft until it's finished", ...);
it("a second season has a valid 82-game schedule with fresh game ids", ...);
it("a new season clears stats, sets devDate to opening day and creates next year's class and picks", ...);
it("retired players move to f.retired and leave f.players only when the new season starts", ...);
it("the season summary keeps the champion, record and award names", ...);
it("the current season loads after the year changes, and the old row stays", ...);
it("three full seasons run with 15 on every roster and no missing player ids", ...);
it("a saved offseason step survives a reload", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/offseason.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement the engine**

Step dates: `review` at the finals date, `lottery` Jun 18, `draft` from `draftCalendar`, `contracts` Jun 29, `freeAgency` Jul 1, `camp` from `proCalendar`. The date never moves backward. `nextFranchiseEvent` keeps returning `seasonEnd` in the offseason. Every offseason commit is a full commit.

- [ ] **Step 4: Run the tests to verify they pass**

Run: the same command. Expected: PASS.

- [ ] **Step 5: Build the screens**

Read the Next docs first. `OffseasonTab` shows a stepper with one panel per step and one Continue button, and says why it's disabled from `canAdvance`. The review panel moves here from `HomeTab`, and Home links to it. `DraftTab` works all year: the prospect table with ranges and an assign toggle, then during the draft the order, lottery reveal, Pick, Sim to my pick and Sim the draft. `ProgressPanel` lists the user's players who changed and the league's notable retirements. `RosterTab` uses `shownOvr`. Replace the old "arrives in a later update" text.

- [ ] **Step 6: Extend the e2e test**

Extend the season test: after the champion and awards, press Continue through the steps, make one draft pick, reach the next season's opening day, and see the rookie on the roster with a range. Change only the two assertions that read the old offseason text.

- [ ] **Step 7: Verify and push `0.4.0-beta.7`**

Run the full gate from Global Constraints. Expected: all pass, and `curl -s https://legends.carterscoding.com/beta/ | grep -o '0\.4\.0-beta\.7' | head -1` prints the version.

```bash
git add -A
git commit -m "0.4.0-beta.7: the offseason — aging, retirements, scouting, the lottery, the draft and season after season"
git push origin prerelease
```

---

## M6: Contracts and free agency

### Task 6: Cap math

**Files:**

- Create: `src/franchise/pro/cap.ts`
- Test: `src/franchise/__tests__/cap.test.ts`

**Interfaces:**

- Produces: `payroll(f: Franchise, teamId: string): number` (standard contracts plus dead money, without two-way and developmental deals), `taxBill(payroll: number, rules: CapRules): number`, `veteranRights(p: Player, teamId: string): "full" | "early" | "none"`, `rightsLimit(f: Franchise, p: Player, teamId: string): number`, `signingRoom(f: Franchise, teamId: string, p: Player): SigningRoom`, where `SigningRoom = { limit: number; via: "cap" | "rights" | "midLevel" | "taxMidLevel" | "roomMidLevel" | "biannual" | "minimum" }`, `canSign(f: Franchise, teamId: string, p: Player, salary: number): { ok: true; via: SigningRoom["via"] } | { ok: false; reason: string }`, `useException(f: Franchise, teamId: string, via: SigningRoom["via"], salary: number): Franchise`.

- [ ] **Step 1: Write the failing tests**

```ts
it("counts dead money and skips two-way and developmental deals", ...);
it("taxes $5M over the line at the first step and $25M over at higher steps", ...); // rates 1.5, 1.75, 2.5, 3.25, then +0.5 per $5M bracket, scaled
it("full rights after 3 seasons exceed the cap up to the max", ...);
it("1-2 seasons allow the greater of 175% of salary or 105% of the league average", ...);
it("no rights: a capped team can only offer the minimum", ...);
it("the mid-level splits across signings until it's used up", ...);
it("the full mid-level isn't available over the first apron, and the taxpayer one isn't over the second", ...);
it("a team under the cap by less than the deal uses its room mid-level instead", ...);
it("the biannual can't be used two years in a row", ...);
it("the max depends on years of service", ...);
it("canSign gives a reason a person can read", ...);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/franchise/__tests__/cap.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement, run the test, commit**

`signingRoom` picks the largest available path: rights, then cap room, then exceptions, then the minimum. Expected after implementing: PASS.

```bash
git add src/franchise
git commit -m "Add cap math, veteran rights and exceptions"
```

### Task 7: Contract years, options and roster moves

**Files:**

- Create: `src/franchise/pro/contracts.ts`, `src/franchise/pro/rosterMoves.ts`
- Modify: `src/franchise/core/offseason.ts`, `src/franchise/core/season.ts`, `src/franchise/rotation.ts`, `src/franchise/match.ts`
- Test: `src/franchise/__tests__/contracts.test.ts`, `rosterMoves.test.ts`

**Interfaces:**

- Produces in `contracts.ts`: `pendingOptions(f: Franchise, teamId: string): Player[]`, `setTeamOption(f: Franchise, playerId: string, exercise: boolean): Franchise`, `playerOptionChoice(f: Franchise, p: Player): boolean`, `rollContracts(f: Franchise): Franchise`, `extendContract(f: Franchise, playerId: string, salary: number, years: number): Franchise`, `expiring(f: Franchise, teamId: string): Player[]`.
- Produces in `rosterMoves.ts`: `guaranteed(c: Contract): number`, `releasePlayer(f: Franchise, playerId: string): Franchise`, `processWaivers(f: Franchise): { franchise: Franchise; changedPlayers: string[] }`, `buyoutAsk(f: Franchise, playerId: string): number`, `buyOut(f: Franchise, playerId: string, amount: number): Franchise`, `signTwoWay(f: Franchise, teamId: string, playerId: string): Franchise`, `signDev(f: Franchise, teamId: string, playerId: string): Franchise`, `callUp(f: Franchise, playerId: string): Franchise`, `activeRoster(f: Franchise, teamId: string, g: ScheduledGame): Player[]`, `rosterProblem(f: Franchise): string | null`.

- [ ] **Step 1: Write the failing tests**

```ts
it("a declined team option ends the deal after the guaranteed years", ...);
it("a rookie deal asks for one option at a time", ...);
it("a player opts out when he's worth more, and in when he isn't", ...);
it("an expired player keeps his rights and stays listed until he signs elsewhere", ...);
it("an extension starts when the old deal ends and doesn't change this year's pay", ...);
it("release leaves the guaranteed money as dead cap, without team option years", ...);
it("an unclaimed player reaches free agency after two days", ...);
it("a claiming team takes the whole contract and the dead money goes away", ...);
it("a team that can't fit the contract can't claim", ...);
it("a buyout below the player's ask is refused, and an accepted one becomes dead cap", ...);
it("three two-way slots outside the cap and the 15", ...);
it("a two-way player sits out the playoffs and stops at 50 games", ...);
it("developmental players stay outside the roster until called up", ...);
it("simDay won't run while the user's roster is outside 13-15 in season", ...);
it("an expired free agent with this season's stats still renders in Leaders and awards", ...); // Review Focus 1
it("a game played with 18 under contract builds a valid match", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/contracts.test.ts src/franchise/__tests__/rosterMoves.test.ts`. Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`rollContracts` runs on leaving `contracts`: every deal loses a year, extensions take over, service and team seasons rise, and expired players move to `freeAgents` with `teamId: null` and a kept `rightsTeamId` on the file. AI teams decide options by value against salary. Replace the M5 pass-through. `boxSide` and `franchisePending` use `activeRoster`. `runSim` and `simDay` stop with `blocked` when `rosterProblem` returns text, and `HomeTab` shows it. `processWaivers` runs from `simDay` and each offseason step, and AI claims go lowest record first. `canAdvance` holds the `camp` step until the user's roster is 13–15. This replaces `trimRoster` for the user's team, whose extra players stay until the user releases them.

- [ ] **Step 4: Run the tests, then commit**

Run: the same command. Expected: PASS.

```bash
git add src/franchise
git commit -m "Add contract years, options, waivers, buyouts, two-way and developmental deals"
```

### Task 8: Player value, mood and negotiation

**Files:**

- Create: `src/franchise/pro/market.ts`
- Test: `src/franchise/__tests__/market.test.ts`

**Interfaces:**

- Produces: `marketValue(f: Franchise, p: Player): number`, `mood(f: Franchise, p: Player, teamId: string): Mood`, where `Mood = { score: number; parts: { money: number; role: number; winning: number; loyalty: number } }`, `askingPrice(f: Franchise, p: Player, teamId: string): { salary: number; years: number }`, `offerScore(f: Franchise, p: Player, offer: Offer): number`, `negotiate(f: Franchise, p: Player, offer: Offer): NegotiationReply`, `Offer = { teamId: string; salary: number; years: number; playerOption?: boolean; teamOption?: boolean }`, `NegotiationReply = { kind: "accept" } | { kind: "counter"; salary: number; years: number; note: string } | { kind: "walk"; note: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
it("value rises steeply with overall and never tops the player's max", ...);
it("a 34-year-old gets less than a 27-year-old of the same overall", ...);
it("mood rises with winning and with a starting role", ...);
it("high ego weighs role more, and high loyalty favors his current team", ...);
it("a contender can pay less than a loser for the same player", ...);
it("an offer at the ask is accepted, far below it walks after three tries", ...);
it("a counter sits between the offer and the ask", ...);
it("a player option costs less salary, and a team option costs more", ...);
it("older players won't take long deals, and young stars prefer them", ...);
it("the same inputs give the same answer", ...);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/franchise/__tests__/market.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement, run the test, commit**

Value follows the shape of `career/pro/season.ts`'s `marketValue`, scaled by the cap and capped by `maxSalary(service)`. Blend in last season's production at 15%. A negotiation's tries live on `f.talks[playerId]` and reset each offseason. Expected after implementing: PASS.

```bash
git add src/franchise
git commit -m "Add player value, mood and contract negotiation"
```

### Task 9: Free agency

**Files:**

- Create: `src/franchise/pro/freeAgency.ts`
- Modify: `src/franchise/types.ts`, `src/franchise/core/offseason.ts`, `src/franchise/core/season.ts`
- Test: `src/franchise/__tests__/freeAgency.test.ts`

**Interfaces:**

- Consumes: Tasks 6–8.
- Produces: `FreeAgencyState = { stage: "moratorium" | "bidding" | "open"; round: number; bids: (Offer & { playerId: string })[]; signed: { playerId: string; teamId: string; salary: number; years: number; round: number }[] }`.
- Produces: `openFreeAgency(f): Franchise`, `placeBid(f, playerId: string, offer: Offer): { ok: true; franchise: Franchise } | { ok: false; reason: string }`, `withdrawBid(f, playerId: string): Franchise`, `nextRound(f): Franchise`, `signNow(f, playerId: string, offer: Offer): { ok: true; franchise: Franchise } | { ok: false; reason: string }`, `aiResign(f): Franchise`, `aiFillRosters(f): Franchise`, `weeklyMarket(f): { franchise: Franchise; changedPlayers: string[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
it("nothing signs during the moratorium", ...);
it("five rounds run on their dates, then the market stays open", ...);
it("players take the best mix of money, role and winning, not only the most money", ...);
it("a player gets less picky each round", ...);
it("the user's pending bids can't add up past what the team can pay", ...);
it("a bid made illegal by an earlier signing is dropped with a reason", ...); // Review Focus 4
it("the user's team keeps veteran rights through the rounds", ...);
it("the user wins a player only by winning his decision", ...);
it("AI teams re-sign most of the players they value before the market opens", ...);
it("every AI team ends camp with 13 to 15 players and stays legal", ...);
it("an unsigned player's ask falls through the season, and AI teams fill injury gaps", ...);
it("nobody signs twice, and every signing uses the cap path it reported", ...);
it("a whole season of weekly market work adds under 5 seconds", ...);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/franchise/__tests__/freeAgency.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

The moratorium runs Jul 1–6, then rounds fall on Jul 6, 8, 10, 12 and 14. A round: AI teams bid on their top needs within `canSign`, each player scores all bids with `offerScore`, and he signs if the best clears `0.62 + (5 - round) * 0.07`, in value order so each signing updates the cap before the next. The user's bids are checked again at that moment. Leaving `freeAgency` runs the remaining rounds, then `aiFillRosters`. `weeklyMarket` runs from `simDay` in season, on the same weekly check as practice. Ask decay is computed from the date.

- [ ] **Step 4: Run the tests, then commit**

Run: the same command. Expected: PASS.

```bash
git add src/franchise
git commit -m "Run free agency: the moratorium, bidding rounds and open market"
```

### Task 10: Contract screens

**Files:**

- Create: `src/app/franchise/hub/CapPanel.tsx`, `ContractsPanel.tsx`, `FreeAgentsTab.tsx`, `NegotiateDialog.tsx`
- Modify: `src/app/franchise/hub/RosterTab.tsx`, `OffseasonTab.tsx`, `FranchiseHub.tsx`, `HomeTab.tsx`, `e2e/smoke.spec.ts`, the release files
- Test: `e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: Tasks 6–9.

- [ ] **Step 1: Write the failing e2e test**

Add `test("run a franchise offseason: option, re-sign, bid, release, two-way")`, with a 480-second timeout. It sims a full season as the existing test does, then re-signs a player, bids on a free agent, runs the rounds, sees the result, releases someone and signs a two-way player.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test -g "run a franchise offseason"`. Expected: FAIL, the Free agents tab isn't there.

- [ ] **Step 3: Build the screens**

`CapPanel` shows payroll against the cap, tax line and aprons, available exceptions, dead money and the tax bill. `RosterTab` adds years, option markers and row actions (Extend, Release, Buy out, Call up). `ContractsPanel` lists options and expiring players in the `contracts` step. `FreeAgentsTab` is a sortable, position-filtered market with ask, mood, your bid and a Sign button once open. `NegotiateDialog` uses `<dialog>` and shows mood parts, salary and years inputs and the reply. Offers that fail show `canSign`'s reason.

- [ ] **Step 4: Run it, then verify and push `0.4.0-beta.8`**

Run the full gate from Global Constraints. Expected: all pass, and `curl` shows `0.4.0-beta.8`.

```bash
git add -A
git commit -m "0.4.0-beta.8: contracts and free agency — the cap, negotiation, bidding rounds, waivers, buyouts, two-way and developmental deals"
git push origin prerelease
```

---

## M7: Trades

### Task 11: Trade values and legality

**Files:**

- Create: `src/franchise/pro/tradeValue.ts`, `src/franchise/pro/trades.ts`
- Test: `src/franchise/__tests__/tradeValue.test.ts`, `trades.test.ts`

**Interfaces:**

- Produces: `teamDirection(f: Franchise, teamId: string): "contending" | "neutral" | "rebuilding"`, `playerTradeValue(f: Franchise, p: Player, teamId: string): number`, `pickTradeValue(f: Franchise, pick: DraftPick, teamId: string): number`.
- Produces: `TradeAsset = { kind: "player"; id: string; from: string; to: string; signAndTrade?: { salary: number; years: number } } | { kind: "pick"; id: string; from: string; to: string }`, `Trade = { teams: string[]; assets: TradeAsset[] }`.
- Produces: `tradeProblems(f: Franchise, t: Trade): string[]`, `applyTrade(f: Franchise, t: Trade): Franchise`, `tradeOpen(f: Franchise): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
it("a star is worth far more than two good players", ...);
it("a contending team pays more for veterans and a rebuilding one for youth and picks", ...);
it("a bad contract has negative value, and a bargain adds value", ...);
it("a bad team's pick is worth more than a good team's", ...);
it("under the cap after the trade, a team takes back any salary", ...);
it("over the cap, incoming salary can be 125% of outgoing plus the cushion", ...);
it("over the first apron, 110%, and it can't take a sign-and-trade", ...);
it("over the second apron, it can't take on salary", ...);
it("two-team and three-team deals check each team on its own", ...);
it("refuses a deal that leaves an in-season roster above 15, or a player on the wrong team", ...);
it("refuses anything after the deadline, and reopens when the finals end", ...);
it("refuses a player in free agency unless the deal is a sign-and-trade by his rights team", ...);
it("applyTrade moves players and picks, resets team seasons and keeps this season's stats", ...);
it("a refused deal changes nothing", ...); // Review Focus 4
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/tradeValue.test.ts src/franchise/__tests__/trades.test.ts`. Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Value blends current and future overall by direction, raised through a steep curve (`1.16 ^ (rating - 60)`), so stars can't be bought with quantity. Add `surplus = (marketValue - salary) * guaranteed years`, scaled to the same units. Pick value uses the original team's projected slot, then discounts 10% per future year. Direction comes from win percentage to date, or last season's in the offseason, and the average age of the top eight. The trade window is closed from `tradeDeadline` until the phase becomes `offseason`.

- [ ] **Step 4: Run the tests, then commit**

Run: the same command. Expected: PASS.

```bash
git add src/franchise
git commit -m "Value trade assets and check trades against the cap rules"
```

### Task 12: Undo and safe roster moves

**Files:**

- Create: `src/franchise/core/moves.ts`
- Modify: `src/franchise/core/season.ts`, `src/franchise/core/offseason.ts`, `src/franchise/coaching/plan.ts`, `src/app/franchise/hub/actions.ts`
- Test: `src/franchise/__tests__/moves.test.ts`

**Interfaces:**

- Produces: `moveLock(f: Franchise, suspendedGameId?: string): string | null`, `applyMove(f: Franchise, label: string, move: (f: Franchise) => Franchise): Franchise`, `undoMove(f: Franchise): Franchise`, `prunePlan(f: Franchise): Franchise`.
- Produces in `actions.ts`: `useRosterMove()`, which checks `moveLock` with `findFranchiseSave`, runs `applyMove` through `update`, and shows a toast with Undo.

- [ ] **Step 1: Write the failing tests**

```ts
it("undo restores players, rosters, picks, books, free agents and cap use", ...);
it("only the last move can be undone", ...);
it("a simulated day or an offseason step clears undo", ...);
it("trading a starter drops him from starters, minutes, player plans and game plan", ...); // Review Focus 3
it("resolveLineup still fills after that trade", ...);
it("moves wait while a game is partway through or suspended", ...); // Review Focus 3
it("undo brings back the plan the move changed", ...);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/franchise/__tests__/moves.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement, run the test, commit**

`applyMove` keeps the top-level fields that changed in `before`, and every changed player by comparing references. Route signing, extending, releasing, buying out, two-way, developmental, call-up and option actions through `useRosterMove`. Draft picks and bids aren't undoable. Expected after implementing: PASS.

```bash
git add src/franchise src/app/franchise
git commit -m "Add undo for roster moves and keep the coaching plan in step"
```

### Task 13: Trade AI

**Files:**

- Create: `src/franchise/pro/tradeAi.ts`
- Modify: `src/franchise/types.ts`, `src/franchise/core/season.ts`, `src/franchise/pro/draft.ts`
- Test: `src/franchise/__tests__/tradeAi.test.ts`

**Interfaces:**

- Produces: `tradeReply(f: Franchise, t: Trade): { accepted: boolean; note: string; gap: number }`, `askFor(f: Franchise, wanted: TradeAsset[]): Trade[]` (the finder), `blockOffers(f: Franchise): TradeOffer[]`, `TradeOffer = { id: string; trade: Trade; date: IsoDate }`, `toggleBlock(f: Franchise, playerId: string): Franchise`, `aiTradeDay(f: Franchise, rng: Rng): { franchise: Franchise; changedPlayers: string[] }`, `draftDayOffers(f: Franchise): TradeOffer[]`.

- [ ] **Step 1: Write the failing tests**

```ts
it("each AI team must gain value by the margin to accept", ...);
it("the same deal can't be flipped back at a profit", ...);
it("the AI won't take a star for many role players", ...);
it("the finder only returns deals that are legal and accepted", ...);
it("players on the block draw legal offers, and offers expire after 7 days or when illegal", ...);
it("AI teams trade with each other 3 to 12 times a season", ...);
it("AI trades stop at the deadline and never touch the user's team", ...);
it("draft-day offers trade picks and hand the user's pick to the new owner", ...);
it("a sign-and-trade works for an expired player with the rights team only", ...);
it("the finder answers in under a second", ...);
it("a full season still sims in under a minute", ...);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/franchise/__tests__/tradeAi.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement, run the test, commit**

Margin is 8% in a constant that becomes the trade difficulty setting in M9. AI-to-AI search runs once a week on two teams with opposite directions, and tries a veteran for youth or picks. Each team's move is judged by `tradeReply`, so its rules are shared with the user. Expected after implementing: PASS.

```bash
git add src/franchise
git commit -m "Add trade AI: the finder, the block, draft-day offers and league trades"
```

### Task 14: Trade screens

**Files:**

- Create: `src/app/franchise/hub/TradesTab.tsx`, `TradeBuilder.tsx`
- Modify: `src/app/franchise/hub/DraftTab.tsx`, `FranchiseHub.tsx`, `RosterTab.tsx`, `e2e/smoke.spec.ts`
- Test: `e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: Tasks 11–13.

- [ ] **Step 1: Write the failing e2e test**

Add `test("make a franchise trade, undo it and make it again")`: open Trades, build a deal, see a refusal with a reason, change it until accepted, confirm the roster changed, press Undo, repeat, reload and confirm it held. It also opens the finder and block.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test -g "make a franchise trade"`. Expected: FAIL, the Trades tab isn't there.

- [ ] **Step 3: Build the screens**

`TradeBuilder` has one column per team (up to three), players and picks to toggle, salary totals against matching limits, live `tradeProblems`, the AI's reply and Propose. `TradesTab` holds the builder, the finder ("I want…"), the block with its offers, and a deadline notice. `DraftTab` shows draft-day offers and pick trades. `RosterTab` gets a Trade block toggle.

- [ ] **Step 4: Run it to verify it passes, then commit**

Run: `npx playwright test -g "make a franchise trade"`. Expected: PASS.

```bash
git add -A
git commit -m "Add the Trades tab and draft-day trades"
```

### Task 15: Multi-season soak and M7 release

**Files:**

- Create: `src/franchise/__tests__/soak.test.ts`
- Modify: tuning constants in `core/progress.ts`, `pro/draftClass.ts`, `pro/market.ts`, `pro/freeAgency.ts`, the release files
- Test: `src/franchise/__tests__/soak.test.ts`

**Interfaces:**

- Consumes: everything above, with the user's team run through the same AI paths as other teams.

- [ ] **Step 1: Write the failing test**

Three seasons run on every test run, and 25 with `SOAK=1`. After each season:

```ts
expect(rosterProblems(f)).toEqual([]); // all 30 teams: 13-15, 3 two-way at most, no missing ids, nobody on two teams
expect(mean(topEights(f))).toBeWithin(baseline, 2);
expect(playersAtLeast(f, 90)).toBeWithin(4, 30);
expect(median(payrolls)).toBeWithin(0.9 * cap, 1.3 * cap);
expect(teamsOverSecondApron(f)).toBeLessThan(6);
expect(worstTeamBest8(f)).toBeGreaterThan(baseline - 8); // no team stays broken
expect(medianAge(f)).toBeWithin(25, 29);
```

- [ ] **Step 2: Run it to verify the current state**

Run: `SOAK=1 npx vitest run src/franchise/__tests__/soak.test.ts --testTimeout=1800000`. Expected: FAIL on at least one measure, or PASS if earlier values held. Record the numbers.

- [ ] **Step 3: Tune**

Change only the constants listed above, one at a time, re-running the soak. If a failure is a bug, fix it with its own test first.

- [ ] **Step 4: Verify on x64, then push `0.4.0-beta.9`**

Run the soak on Arm and x64, then the full gate from Global Constraints. Expected: all pass, and `curl` shows `0.4.0-beta.9`.

```bash
git add -A
git commit -m "0.4.0-beta.9: trades — value, cap-legal deals, the finder, the block, the deadline, league trades, draft-day trades and undo"
git push origin prerelease
```
