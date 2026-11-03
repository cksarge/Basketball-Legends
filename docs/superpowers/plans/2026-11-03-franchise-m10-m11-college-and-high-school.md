# Franchise M10–M11: College and High School Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Franchise runs a college program or an Arizona high school as fully as it runs a pro club. In college that means recruiting battles, NIL, the transfer portal, eligibility, early draft declarations and the tournaments. In high school it means feeders, tryouts, three squads and the state playoffs. A fired coach can be hired in any league. Ships to `/beta/` as `0.4.0-beta.15` and `.16` (M10), `.17` and `.18` (M11), and `.19` after the final review.

**Architecture:** `LeagueModule` grows from a calendar and postseason into the full set of league rules. Pro-only systems (cap, trades, free agency, waivers, draft, finances) run only through `proLeague`. College and high school add their own systems in `src/franchise/college/` and `src/franchise/hs/`. Both use the existing day loop, box simulator, coaching, history and auto-manage. Teams outside the user's world play on team strength, as Road to Legend already does.

**Tech Stack:** TypeScript, Next.js static export, Dexie, zustand, comlink, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-phase3-franchise-design.md` (Decisions, College, High school, Jobs, Quality of life, Testing)

## Global Constraints

- Work on `prerelease`. Never merge to `main` without the user's go-ahead.
- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code.
- Root-relative file paths go through `asset()` in `src/lib/site.ts`.
- `src/franchise/` has no React and no `window` access.
- No real league marks or real people's names. Schools keep their real names with original mascots. Tournaments and conferences use the original names already in the data and the career code.
- Road to Legend, Quick Play and the park keep their behavior and saves. Career code moved or given new optional parameters keeps its existing tests unchanged. Existing tests are not edited to make them pass, unless this plan names the edit.
- **Pro saves don't change.** A pro franchise plays out exactly as it did in `0.4.0-beta.14`: same results for the same seed, and every existing franchise test passes untouched.
- `FRANCHISE_VERSION` becomes 5, and `0.4.0-beta.14` saves keep working, in season and in the offseason.
- Anything that loops over `f.players`, recruits or teams in an order-sensitive way sorts ids first, and any cache keys on `f.players` and `f.season.games`. A reloaded save must play out like a running one.
- Every path that changes a player reports it in `changedPlayers`, or commits in full.
- Money and point values live in named constants.
- Bump versions by editing the `version` lines in `package.json` and `package-lock.json` only.
- Every push updates `CHANGELOG.md`, README, How to Play, Terms, Privacy, Credits and the sitemap as needed. How to Play avoids long blocks of text. Changelog additions go under their own headers, as in v0.3.0.
- A push is done only after these all pass:
  - `npx tsc --noEmit`
  - `npm run lint`, with every error read
  - `npx vitest run`
  - `npm run format:check`
  - `npx playwright test` on the live build
  - `npx playwright test --grep-invert @gpu` on the beta build
  - `curl` shows the new version on `/beta/`
- Statistical thresholds also run on x64 under Rosetta. Soak limits are judged across at least five values of `SOAK_SEED`.
- Each test is run and seen to fail before its code is written, in a separate step.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions this plan makes

The spec leaves these open. Each is cheap to change at this stage.

| Question                 | Decision                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| College world            | The user's division has persistent players, box scores and stats. The other two divisions get schedules, results, standings and their own tournaments from `simScore` and team strength, stored apart in `season.outside`. Their rosters are generated, the same way each time, when someone looks at them.                                                                     |
| High school world        | Every school that fields varsity keeps a persistent varsity roster. The user's school also keeps JV and FR/SO squads. Other schools' lower squads are generated when viewed. The one school with no varsity can't be picked.                                                                                                                                                    |
| College roster           | 15 at most. At least 10 to play a game and at least 13 at camp, with generated walk-ons filling the gap.                                                                                                                                                                                                                                                                        |
| Scholarships             | 13 in Division I and 10 in Division II. Division III gives no athletic scholarships, so its offers are roster spots, limited by the 15-player roster. Walk-ons never use a scholarship.                                                                                                                                                                                         |
| Recruiting class         | One class at a time, for the fall after the season. It's generated each summer at camp, about 4.2 recruits per program in the division. A new save starts with a class already eight weeks into recruiting.                                                                                                                                                                     |
| Stars                    | By rank in the class: top 2% five stars, next 18% four, next 40% three, the rest two. Ratings show as ranges until scouted, as in the pro draft.                                                                                                                                                                                                                                |
| Weekly points            | `70 + 60 × prestige`, times `1 + (assistant rating − 70) / 200`. Unused points don't carry over.                                                                                                                                                                                                                                                                                |
| Recruiting actions       | Call: 5 points, +4 interest. Scout: 10 points, narrows the range. Home visit: 25 points, +18, once per recruit. Official visit: 40 points, +35, once per recruit, and a recruit takes 5 official visits at most. Offer: no points, but needs an open scholarship or roster spot. Every interest gain is multiplied by fit (0.5–1.5) and by 1.5 from programs that have offered. |
| Fit                      | Each recruit ranks three of six things: prestige, playing time at his position, NIL, distance from home, winning and the coach's record.                                                                                                                                                                                                                                        |
| Commitments              | A recruit commits once his leader has offered, has 120 interest or more, and leads the next program by 25%. Before signing, a committed recruit has a 10% weekly chance to flip when another offering program reaches 1.5× his school's interest.                                                                                                                               |
| Signing                  | Commitments made before the early signing date (the second Wednesday of November) are binding. Everyone else signs at the offseason Signing step. Unsigned recruits with offers pick the best one with room left, in rank order. The rest leave the game.                                                                                                                       |
| NIL                      | Each program has a yearly budget: Division I `$400K + prestige² × $9.6M`, Division II 8% of that, Division III 2%. Deals last one season. Promises to recruits, transfers and returning players count against next season's budget.                                                                                                                                             |
| Transfer portal          | An offseason step after declarations. The chance a player enters rises with low minutes for his talent, ego, an unmet NIL ask and a coaching change, and falls with loyalty. Recruiting it takes three rounds with the same actions. Transfers are eligible right away.                                                                                                         |
| Eligibility              | Four seasons of play within five years. The user can redshirt a player who has played 4 or fewer games, once per career. AI programs redshirt half of their freshmen who are outside the top 11 and have room to grow. Fifth-year players show as GR.                                                                                                                           |
| Early declarations       | At the Declarations step, players with a pro projection may leave early, more often as they get older. The user gets one pitch per player, which helps more for starters and with NIL. Declared players leave at Progress, with news about where they're projected to go. No pro league is connected.                                                                           |
| College postseason       | The career code: conference tournaments of up to 8, a 68-team national tournament in Division I (64 in II and III) and a 32-team invitational in Division I. Every division runs its own.                                                                                                                                                                                       |
| High school postseason   | The career code: an Open Division for the best 16 from 6A to 4A, then a bracket per class.                                                                                                                                                                                                                                                                                      |
| Feeders                  | Each fall's freshmen come from a pool sized by classification (6A 18, 5A 15, 4A 12, 3A 10, 2A 8, 1A 6, ±2), with talent from the school's prestige.                                                                                                                                                                                                                             |
| Tryouts                  | Each player gets a score: overall plus `normal(0, 4)` plus a hustle bonus. Squads are 10 to 15 players: varsity, JV if the school fields it, and FR/SO (freshmen and sophomores only) if it fields that. Cut underclassmen stay in the program and can try out next year. Squads can be changed during the season except on a game day.                                         |
| Lower squads             | The user's JV and FR/SO play their own schedules, simulated on score against generated opponents. Their results and records show on the Schedule tab. Playing on a squad counts toward development.                                                                                                                                                                             |
| Growth                   | Age-based, with more for younger players. High school players gain about 4 overall a year, and college players about 3. Both are tuned by soak tests.                                                                                                                                                                                                                           |
| League settings          | Every league has injuries and progression speed. College game counts are 30, 26 or 22, plus conference tournaments on or off and a Division I field of 68 or 64. High school game counts are 18, 14 or 10, plus the Open Division on or off. Trade difficulty and the pro playoff format show only in pro.                                                                      |
| Goals                    | College athletic director: winning, postseason and recruiting class rank, weighted 0.4, 0.35 and 0.25. High school principal: winning, postseason and development, weighted 0.5, 0.3 and 0.2. Same security, grades and firing rules as pro.                                                                                                                                    |
| Staff                    | Salaries scale by league: pro 1×, college 0.25×, high school 0.01×. Outside pro, a staff budget from prestige caps the total. Finances, tickets and the Club tab stay pro only. College and high school get a Program tab instead.                                                                                                                                              |
| Job offers               | Up to 6 from the coach's own world, as now, plus up to 2 from each other world (pro, each college division, high school). Each world picks teams by prestige to match the coach's reputation.                                                                                                                                                                                   |
| Moving worlds            | Taking a job in another league or college division builds that world fresh at its next opening day. Every new season year is later than the old world's last one. The coach keeps job stints, reviews, settings and Road to Legend links. The old world's history, records and Hall of Fame move to `formerWorlds`, and its past season rows stay readable.                     |
| Hall of Fame             | Every league has one. College and high school scores use the player's seasons in that league, with their own bars: college 60, high school 55, pro stays 75.                                                                                                                                                                                                                    |
| New auto-manage switches | `recruiting` covers recruiting, NIL, the portal and pitches, and is off by default. `squads` covers tryouts and squad moves, and is on by default.                                                                                                                                                                                                                              |

## Review Focus

Each line has its test in the owning task.

1. A pro save from `0.4.0-beta.14`, and a new pro franchise, play out exactly as before: same scores, same offseason, same storage (Task 1).
2. A college save is reloaded mid-week, mid-portal, between the early signing date and signing day, or with a recruit flipping: points, interest, offers and commitments come back the same, and the rest of the run matches one that never reloaded (Task 5, Task 6).
3. The user's roster is short or over the limit at camp, or has more commitments than scholarships after a declaration or transfer. Everything resolves with no stuck step, whether auto is on or off (Task 7, Task 12).
4. A coach moves between worlds (pro to college, college Division III to I, high school to pro) mid-offseason with open bids, a live game, a saved game or undo. The new world opens after reload, its first season starts, and History still shows the old world (Task 14).
5. A high school with only varsity and JV, or only varsity, or a tiny feeder class gets valid squads, a schedule and a playoff spot with no gaps (Task 11, Task 12).

---

## File Structure

```
src/franchise/leagues/index.ts     LeagueModule: rules, steps, hooks, settings options
src/franchise/leagues/college.ts   college module: world, schedule, postseason, steps
src/franchise/leagues/hs.ts        high school module
src/franchise/world.ts             building a world, outside games, moving worlds
src/franchise/college/recruiting.ts  recruits, points, actions, AI programs, commitments, signing
src/franchise/college/nil.ts       budgets and deals
src/franchise/college/portal.ts    entering, rounds, resolution
src/franchise/college/eligibility.ts  class years, redshirts, graduation, declarations, walk-ons
src/franchise/hs/feeders.ts        freshman classes and AI school rollover
src/franchise/hs/squads.ts         tryouts, squads, lower-squad games
src/franchise/club/program.ts      athletic director and principal goals, staff budget
src/franchise/core/awards.ts       awards per league
src/franchise/core/progress.ts     growth by league
src/ui/BracketView.tsx             bracket rounds, shared with career
src/app/franchise/hub/             RecruitingTab, PortalPanel, ProgramTab, SquadsTab, TryoutsPanel, OutsideTeamDialog
scripts/franchise-baseline.ts      takes --league
```

## Types added in Task 1

In `src/franchise/types.ts`, with `FRANCHISE_VERSION = 5`. Later tasks use these names.

```ts
export type OffseasonStep =
  "review" | "progress" | "lottery" | "draft" | "contracts" | "freeAgency" | "camp" | "declarations" | "portal" | "signing" | "tryouts";
export type AutoKey = /* existing */ "recruiting" | "squads";
export interface LeagueSettings {
  /** Options come from the league module. */
  gamesPerSeason: number;
  playoffFormat: {
    firstRoundBestOf: 5 | 7;
    playIn: boolean;
    conferenceTournaments?: boolean;
    nationalField?: 68 | 64;
    openDivision?: boolean;
  };
  tradeDifficulty: "easy" | "normal" | "hard";
  injuries: "off" | "fewer" | "normal" | "more";
  progression: "slow" | "normal" | "fast";
}
/** Games and brackets for teams outside the user's world, decided on team strength. */
export interface OutsideSeason {
  games: ScheduledGame[];
  brackets: Bracket[];
}
export interface WorldRef {
  league: LeagueId;
  division?: CollegeDivision;
}
export interface FormerWorld extends WorldRef {
  from: number;
  to: number;
  teamIds: string[];
  history: SeasonSummary[];
  hall: HallEntry[];
  records: LeagueRecord[];
}
```

- `LeagueSeason` gains `brackets: Bracket[]` (empty in pro) and `outside?: OutsideSeason`.
- `Franchise` gains these fields:
  - `world: WorldRef`, filled as `{ league: "pro" }` for older saves.
  - `college?: CollegeState`, from Task 5.
  - `hs?: HsState`, from Task 11.
  - `formerWorlds: FormerWorld[]`.
- `PlayerFile` gains these fields:
  - `eligibility?: { used: number; redshirted: boolean }`.
  - `walkOn?: boolean`.
  - `stars?: number`.
- `OwnerGoal["key"]` adds `"postseason" | "recruiting"`.
- `JobStint` gains `division?: CollegeDivision`.
- `JobState` gains `kind: "owner" | "ad" | "principal"`.

## LeagueModule after Task 1

```ts
export interface LeagueModule {
  id: LeagueId;
  calendar(year: number): { opening: IsoDate; lastGame: IsoDate; seasonEnd: IsoDate };
  quarterMinutes: number;
  periods: number;
  /** "4th quarter" or "2nd half", for the play-the-end controls. */
  lastPeriodLabel: string;
  arena: "pro" | "college" | "gym";
  roster: { min: number; max: number; campMin: number };
  /** Tabs and systems that exist in this league. */
  systems: { cap: boolean; trades: boolean; freeAgency: boolean; draft: boolean; finances: boolean; recruiting: boolean; squads: boolean };
  schedule(teams: Team[], year: number, seed: string, settings: LeagueSettings): ScheduledGame[];
  postseason(f: Franchise, teams: Team[]): Franchise;
  offseasonSteps: OffseasonStep[];
  offseasonDate(step: OffseasonStep, year: number): IsoDate | null;
  /** Arriving at a step. */
  enterStep(f: Franchise, step: OffseasonStep, teams: Team[]): Franchise;
  canAdvance(f: Franchise): { ok: true } | { ok: false; reason: string };
  /** Once a week during the season, after practice. */
  weekly(f: Franchise, teams: Team[]): { franchise: Franchise; changedPlayers: string[] };
  /** Every day, after games (waivers in pro, signing dates in college). */
  daily(f: Franchise, teams: Team[]): { franchise: Franchise; changedPlayers: string[] };
  /** The new season's league-specific state, after the shared rollover. */
  newSeason(f: Franchise, teams: Team[]): Franchise;
  awards(f: Franchise, teams: Team[]): Award[];
  goals(f: Franchise, teams: Team[]): OwnerGoal[];
  settingsOptions: { games: number[]; fields: ("playoffFormat" | "tradeDifficulty" | "conferenceTournaments" | "nationalField" | "openDivision")[] };
}
```

`leagueModule(id)` keeps its signature. `teams` passed through the engine means the teams of the user's world only. Outside teams go to `world.ts` functions, which take them as a separate argument.

---

## M10: College

### Task 1: League modules carry the rules, and save format 5

Pro behavior moves behind `proLeague` with no change in results. This is the refactor every later task builds on.

**Files:**

- Modify:
  - `src/franchise/leagues/index.ts`, `src/franchise/leagues/pro.ts`, `src/franchise/types.ts`
  - `src/franchise/core/season.ts`, `src/franchise/core/offseason.ts`, `src/franchise/core/awards.ts`
  - `src/franchise/create.ts`, `src/franchise/pro/gmState.ts`, `src/franchise/storage.ts`
  - `src/franchise/settings.ts`, `src/franchise/auto.ts`, `src/franchise/match.ts`
  - `src/franchise/coaching/plan.ts`, `src/franchise/rotation.ts`, `src/franchise/club/owner.ts`
- Test: `src/franchise/__tests__/leagues.test.ts`, `storage.test.ts`

**Interfaces:**

- Produces: the `LeagueModule` above, and `totalMinutes(f: Franchise): number`, which is quarter minutes × periods × 5. Every "per 240 minutes" constant scales by `totalMinutes / 240`.
- Produces: `fillWorld(f: BareFranchise): Franchise`, which sets `world`, `formerWorlds`, `season.brackets` and `job.kind` on older saves.
- Changes:
  - `simDay` calls `module.weekly` and `module.daily` in place of its direct pro calls.
  - `advanceOffseason` calls `module.enterStep` and `module.canAdvance`.
  - `startNewSeason` calls `module.newSeason` after the shared rollover.
  - `advancePostseason` calls `module.awards`.
  - `seasonGoals` calls `module.goals`.
  - The pro module holds every existing call, in the same order.
- Changes: `match.ts` takes the arena, periods and `LEAGUE_RULES` from the module. `trimSchedule` runs inside `proLeague.schedule`.

- [ ] **Step 1: Write the failing tests**

```ts
it("a pro season with seed X has the same results as the beta.14 snapshot", ...); // Review Focus 1, snapshot recorded first from beta.14
it("a pro offseason with seed X ends with the same rosters, picks and cap as the beta.14 snapshot", ...); // Review Focus 1
it("a beta.14 save opens as version 5 with world pro and empty brackets", ...);
it("a beta.14 save in the offseason opens at its step", ...);
it("total minutes are 240 in pro, 200 in college and 160 in high school", ...);
it("starter minimums scale with the game's length", ...);
it("leagueModule throws a clear message for an unknown league", ...);
```

Record the two snapshots on the unchanged code first, with a scratch script, and commit them with the tests. The snapshot tests pass at this point, and the other tests fail.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/leagues.test.ts src/franchise/__tests__/storage.test.ts`
Expected: FAIL, `fillWorld` and `totalMinutes` not found.

- [ ] **Step 3: Implement the module interface, move pro calls behind it, add save format 5**

`fillWorld` is idempotent and runs inside `fillGmState`.

- [ ] **Step 4: Run them, then the whole franchise suite**

Run: `npx vitest run src/franchise`
Expected: PASS, with every existing test untouched.

- [ ] **Step 5: Commit**

```bash
git add src/franchise
git commit -m "Move league rules into league modules and add save format 5"
```

### Task 2: Box score calibration for college and high school

**Files:**

- Modify: `scripts/franchise-baseline.ts`, `src/franchise/boxsim.ts`
- Create: `src/franchise/__tests__/engine-baseline-college.json`, `engine-baseline-hs.json`
- Test: `src/franchise/__tests__/boxsim.test.ts`

**Interfaces:**

- Produces: `npx tsx scripts/franchise-baseline.ts --league college|hs|pro`. It uses `generateRoster` for the league's teams, and `LEAGUE_RULES` for quarter length and periods. The default stays pro, and so does the output file.
- Produces: `LEAGUE_STYLE: Record<LeagueId, { possessionsPer48: number; avg: typeof AVG; threeShare: number }>` in `boxsim.ts`. Pro keeps today's values exactly.

- [ ] **Step 1: Generate both baselines**

Run: `npx tsx scripts/franchise-baseline.ts --league college`, then `--league hs`.
Expected: two JSON files with 60 games each.

- [ ] **Step 2: Write the failing tests**

Add `describe.each(["college", "hs"])` to `boxsim.test.ts`. Each league gets the existing calibration checks with the same tolerances: points within 4, other stats within 8%, the best roster wins more than 85%, and home wins within 0.06. Each also gets "every box score adds up to 200 (college) or 160 (high school) minutes per team".

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/boxsim.test.ts`
Expected: FAIL on college and high school points.

- [ ] **Step 4: Fit `LEAGUE_STYLE` for college and high school**

- [ ] **Step 5: Run them to verify they pass, on Arm and under x64**

Run: the same command, then the scratchpad `x64.sh` with the same file.
Expected: PASS on both. The pro rows are unchanged.

- [ ] **Step 6: Commit**

```bash
git add scripts src/franchise
git commit -m "Calibrate the box simulator for college and high school"
```

### Task 3: The college world

**Files:**

- Create: `src/franchise/leagues/college.ts`, `src/franchise/world.ts`
- Modify:
  - `src/career/college/schedule.ts`: an optional `target` parameter, default `COLLEGE_TARGET`
  - `src/franchise/create.ts`, `src/franchise/settings.ts`, `src/franchise/core/season.ts`
- Test: `src/franchise/__tests__/collegeWorld.test.ts`

**Interfaces:**

- Produces from `world.ts`:
  - `worldTeams(all: Team[], world: WorldRef): Team[]`
  - `outsideTeams(all: Team[], world: WorldRef): Team[]`
  - `outsideSchedule(teams: Team[], world: WorldRef, year: number, seed: string, settings: LeagueSettings): ScheduledGame[]`, covering every other division
  - `simOutsideDay(f: Franchise, outside: Team[], date: IsoDate): Franchise`, which uses `simScore` with `outsideStrength`
  - `outsideStrength(t: Team, year: number, seed: string): number`
  - `outsideRoster(t: Team, year: number, seed: string): Player[]`, the same each call
- Produces: `createFranchise({ league: "college", team, teams, seed, ... })`. `teams` is every college team, and the world is the team's division.
- Produces: `collegeLeague`:
  - Calendar from `collegeCalendar`: opening is `firstGame`, `lastGame` is `lastRegular`, `seasonEnd` as in career.
  - Quarter minutes 20, 2 periods, `lastPeriodLabel: "2nd half"`, arena `"college"`.
  - Roster `{ min: 10, max: 15, campMin: 13 }`.
  - Game options `[30, 26, 22]`. The conference game limit is `min(20, games − 6)`.
- Changes: `simDay` sims the outside games for the day once the user's world is done. The hub's `teams` comes from `worldTeams`.

- [ ] **Step 1: Write the failing tests**

```ts
it("a Division I franchise has 365 teams of players and none from other divisions", ...);
it("each program's roster has 13 to 15 players with class years and eligibility", ...);
it("every program plays 26 to 31 regular-season games, with conference games from January", ...);
it("a 22-game setting gives every program 20 to 23 games", ...);
it("Divisions II and III get a full outside schedule, and their results land on the right days", ...);
it("an outside roster is the same every time it's viewed", ...);
it("outside strength follows prestige", ...);
it("a new Division I save is under 12 MB", ...);
it("a Division I regular season sims in under 60 seconds", ...);
it("a Division III world builds and sims a week", ...);
it("a reloaded college save sims the same week as one that kept running", ...); // Review Focus 2
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/collegeWorld.test.ts`
Expected: FAIL, `Franchise doesn't support the college league yet.`

- [ ] **Step 3: Implement the college world**

Rosters use `generateRoster`. Eligibility `used` comes from the class year, and nobody has redshirted. AI tactics come from `leagueTactics`.

- [ ] **Step 4: Run them to verify they pass**

Run: the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/career/college/schedule.ts src/franchise
git commit -m "Build the college world: a full division, plus outside divisions on team strength"
```

### Task 4: College postseason and awards

**Files:**

- Modify:
  - `src/franchise/leagues/college.ts`, `src/franchise/world.ts`, `src/franchise/core/awards.ts`
  - `src/career/college/postseason.ts`: optional `field` and `conferenceTournaments` parameters, with defaults matching today
- Test: `src/franchise/__tests__/collegePostseason.test.ts`

**Interfaces:**

- Produces: `collegeLeague.postseason`:
  1. After the last regular day, it builds `conferenceBrackets`. With tournaments off, each conference's regular-season leader takes the automatic bid.
  2. On selection day, it runs `selectFields`.
  3. Games come from `advanceCollegeBracket`.
  4. The phase moves to `"playoffs"` once the conference tournaments start, and to `"offseason"` when the user's division has its national champion.
- Outside divisions run the same steps in `simOutsideDay`.
- Produces: `collegeLeague.awards`:
  - Player of the Year, Defensive Player of the Year and Freshman of the Year.
  - An All-American first team of 5.
  - A Player of the Year for each conference in the division.
- Leader minimums use the share of the user's scheduled games, as now.

- [ ] **Step 1: Write the failing tests**

```ts
it("every conference with 2 or more teams holds a tournament of up to 8", ...);
it("tournament champions get automatic bids, and the field is 68 with four opening-round games", ...);
it("a 64-team field has no opening round", ...);
it("with conference tournaments off, regular-season leaders get the automatic bids", ...);
it("the invitational takes the next 32 in Division I only", ...);
it("the season ends when the national final is played, with one champion", ...);
it("outside divisions crown their own champions on the same calendar", ...);
it("college awards name real players in the division, once each", ...);
it("a full Division I season reaches the offseason with no open games", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/collegePostseason.test.ts`
Expected: FAIL, the season never leaves `"regular"`.

- [ ] **Step 3: Implement the postseason and awards**

- [ ] **Step 4: Run them, then `src/career/__tests__/college.test.ts` and `bracket.test.ts`**

Expected: PASS, with the career tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/career/college/postseason.ts src/franchise
git commit -m "Add conference tournaments, the national tournament and college awards to Franchise"
```

### Task 5: Recruiting

**Files:**

- Create: `src/franchise/college/recruiting.ts`
- Modify: `src/franchise/types.ts`, `src/franchise/leagues/college.ts`, `src/franchise/pro/scouting.ts`, so `shownOvr` reads recruit ranges
- Test: `src/franchise/__tests__/recruiting.test.ts`

**Interfaces:**

```ts
export type RecruitNeed = "prestige" | "playingTime" | "nil" | "distance" | "winning" | "coach";
export interface Recruit {
  /** A player in f.players with teamId null. */
  id: string;
  kind: "hs" | "transfer";
  from?: string;
  stars: 2 | 3 | 4 | 5;
  rank: number;
  wants: RecruitNeed[];
  nilAsk: number;
  interest: Record<string, number>;
  offers: Record<string, number>; // team id -> NIL offered
  homeVisits: string[];
  officialVisits: string[];
  committed?: string;
  signed?: boolean;
}
export interface CollegeState {
  division: CollegeDivision;
  /** The season the class arrives for. */
  classYear: number;
  recruits: Recruit[];
  /** Points left this week, by team. */
  points: Record<string, number>;
  nil: Record<string, NilBook>; // Task 6
  portal: PortalState | null; // Task 6
  declared: { id: string; projection: string }[]; // Task 7
  pitched: string[]; // Task 7
}
```

- Produces:
  - `newClass(f: Franchise, teams: Team[], classYear: number, headStartWeeks: number): Franchise`
  - `weeklyPoints(f: Franchise, teamId: string, team: Team): number`
  - `fit(f: Franchise, r: Recruit, team: Team): number`
  - `recruitAction(f: Franchise, recruitId: string, action: "call" | "scout" | "homeVisit" | "officialVisit" | "offer" | "pullOffer", teams: Team[], nil?: number): Franchise | { error: string }`
  - `openScholarships(f: Franchise, teamId: string): number`
  - `aiRecruiting(f: Franchise, teams: Team[]): Franchise`
  - `resolveWeek(f: Franchise, rng: Rng): Franchise`, which handles commitments and flips
  - `earlySigning(f: Franchise): Franchise`
  - `signingDay(f: Franchise, teams: Team[]): Franchise`
  - `classRank(f: Franchise, teamId: string): number`
- `collegeLeague.weekly` runs AI recruiting, then resolves the week, then refills points. `collegeLeague.daily` runs early signing on its date.
- AI programs go after recruits whose stars fit their prestige, in rank order. They offer up to 1.5× their open scholarships, and spread points over their top 8 targets.

- [ ] **Step 1: Write the failing tests**

```ts
it("a class has about 4.2 recruits per program with the star bands by rank", ...);
it("five-star recruits are the best by true potential, give or take", ...);
it("points follow prestige and the assistant, and don't carry over", ...);
it("each action costs its points and is refused with a reason when points run out", ...);
it("home and official visits happen once per recruit, and a recruit takes 5 official visits at most", ...);
it("an offer needs an open scholarship, and Division III offers need a roster spot", ...);
it("fit rewards what the recruit wants most", ...);
it("a recruit commits only to a program that offered, at 120 interest with a 25% lead", ...);
it("a commitment can flip before signing, but not after the early signing date", ...);
it("signing day puts every commitment on its team, and leftovers take their best offer with room", ...);
it("no program signs more than its scholarships", ...);
it("AI programs land classes that match their prestige over a season", ...);
it("scouting narrows a recruit's range, and the true rating shows once he plays", ...);
it("the class rank orders programs by their signed and committed stars", ...);
it("recruiting state survives a partial commit and reload, and the next week matches", ...); // Review Focus 2
it("a week of Division I recruiting adds under 2 seconds", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/recruiting.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement recruiting**

New saves call `newClass` with `headStartWeeks = 8`. Recruits are generated by `generatePlayer`: age 17–18, class year SR, hometown pool `"us"`, with 8% from `"intl"`. Talent is scaled so the division's average overall holds steady, which the soak in Task 10 checks.

- [ ] **Step 4: Run them to verify they pass**

Run: the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/franchise
git commit -m "Add college recruiting: weekly points, visits, offers, commitments and signing day"
```

### Task 6: NIL and the transfer portal

**Files:**

- Create: `src/franchise/college/nil.ts`, `src/franchise/college/portal.ts`
- Modify: `src/franchise/college/recruiting.ts`, `src/franchise/leagues/college.ts`
- Test: `src/franchise/__tests__/nil.test.ts`, `portal.test.ts`

**Interfaces:**

```ts
export interface NilBook {
  /** This season's budget and deals. */
  now: { budget: number; deals: Record<string, number> };
  /** Next season's budget, and what's promised against it. */
  next: { budget: number; deals: Record<string, number> };
}
export interface PortalState {
  round: number; // 1..3
  entered: string[]; // player ids
}
```

- Produces:
  - `nilBudget(team: Team, division: CollegeDivision): number`
  - `nilAsk(p: Player, stars?: number): number`
  - `nilRoom(f: Franchise, teamId: string): number`, which is next season's budget minus promises
  - `promiseNil(f: Franchise, teamId: string, playerId: string, amount: number): Franchise | { error: string }`
  - `rollNil(f: Franchise, teams: Team[]): Franchise`, run at camp, which moves `next` into `now`
- An offer's NIL is promised against `next` and released when the offer is pulled or the recruit signs elsewhere.
- Produces:
  - `portalChance(f: Franchise, p: Player): number`
  - `openPortal(f: Franchise, teams: Team[], rng: Rng): Franchise`
  - `portalRound(f: Franchise, teams: Team[], rng: Rng): Franchise`
  - `closePortal(f: Franchise, teams: Team[]): Franchise`
- Portal players become `kind: "transfer"` recruits in `college.recruits`, with `teamId` null, so every recruiting action works on them.
- Produces: `retain(f: Franchise, playerId: string, nil: number): Franchise | { error: string }`. This is the user's NIL to keep a player who's thinking about leaving. The chance shown before the portal opens drops when his ask is met.

- [ ] **Step 1: Write the failing tests**

```ts
it("NIL budgets follow prestige and division", ...);
it("promises can't pass next season's budget, and pulling an offer frees its money", ...);
it("camp rolls next season's deals into this season and opens a fresh budget", ...);
it("bench players with talent, big egos and unmet asks enter the portal more often", ...);
it("loyal players and those whose ask is met stay more often", ...);
it("a coaching change sends more players into the portal", ...);
it("portal players can be called, visited and offered like recruits", ...);
it("after three rounds every portal player signs or leaves", ...);
it("a transfer keeps his eligibility and plays right away", ...);
it("the portal survives a reload mid-round and finishes the same way", ...); // Review Focus 2
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/nil.test.ts src/franchise/__tests__/portal.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement NIL and the portal**

- [ ] **Step 4: Run them to verify they pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/franchise
git commit -m "Add NIL budgets and the transfer portal"
```

### Task 7: The college offseason, eligibility and declarations

**Files:**

- Create: `src/franchise/college/eligibility.ts`
- Modify:
  - `src/franchise/leagues/college.ts`, `src/franchise/core/progress.ts`, `src/franchise/core/offseason.ts`
  - `src/franchise/history/hall.ts`, `src/franchise/history/career.ts`, `src/franchise/auto.ts`
- Test: `src/franchise/__tests__/collegeOffseason.test.ts`, `progress.test.ts`

**Interfaces:**

- College offseason steps, in order, with their dates for a season starting in `year`:
  - `review`: the season's end.
  - `declarations`: April 20 of `year + 1`.
  - `portal`: April 22 of `year + 1`.
  - `signing`: May 1 of `year + 1`.
  - `progress`: June 1 of `year + 1`.
  - `camp`: October 1 of `year + 1`.
- Produces:
  - `canRedshirt(f: Franchise, playerId: string): boolean`
  - `setRedshirt(f: Franchise, playerId: string, on: boolean): Franchise`
  - `aiRedshirts(f: Franchise, rng: Rng): Franchise`, run at camp
  - `projection(p: Player): "lottery" | "first round" | "second round" | null`
  - `declareChance(p: Player, f: Franchise): number`
  - `pitch(f: Franchise, playerId: string): Franchise`, once per player
  - `graduate(f: Franchise): { franchise: Franchise; left: string[] }`
  - `fillWalkOns(f: Franchise, teamId: string, rng: Rng): Franchise`
- The `progress` step does four things:
  1. Seniors with no eligibility left, and declared players, leave. They become `RetiredPlayer` rows, with `file.service` counting college seasons.
  2. Everyone else ages and grows.
  3. Signed recruits join as FR, with `eligibility.used = 0`.
  4. Class years move up by eligibility used.
- `canAdvance`:
  - At `portal`, the user's offers must fit their scholarships.
  - At `camp`, the user needs 13 to 15 players. Walk-ons fill the gap automatically when auto `roster` is on.
- Changes: `progressPlayer` takes a league:
  - College ages 18–20 gain about 3, and 21–23 about 2.4.
  - High school ages 14–16 gain about 4.5, and 17–18 about 3.8.
  - Pro is unchanged.
- Changes: the Hall bar is per league: pro 75, college 60, high school 55.

- [ ] **Step 1: Write the failing tests**

```ts
it("the college offseason walks review, declarations, portal, signing, progress and camp", ...);
it("a redshirt keeps a year of eligibility, once per career, and only with 4 or fewer games played", ...);
it("players leave after four seasons played, and a redshirted player can play a fifth as GR", ...);
it("projected players declare more often as they get older, and a pitch helps starters most", ...);
it("declared players leave at progress with news of their projection", ...);
it("signed recruits arrive as freshmen with no eligibility used", ...);
it("college players grow about 3 a year, and pro growth is unchanged", ...); // progress.test.ts
it("camp fills short rosters with walk-ons, who use no scholarship", ...);
it("a declaration or transfer that leaves more commitments than scholarships is caught at the portal step", ...); // Review Focus 3
it("with everything off and only Continue pressed, the offseason finishes", ...); // Review Focus 3
it("with auto recruiting on, the user's program recruits, pitches and signs like an AI program", ...);
it("college greats reach the Hall at a bar of 60", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/collegeOffseason.test.ts src/franchise/__tests__/progress.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the offseason, eligibility and growth by league**

- [ ] **Step 4: Run them, then the whole franchise suite**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/franchise
git commit -m "Add the college offseason: declarations, portal, signing, eligibility and walk-ons"
```

### Task 8: Athletic director goals, staff budgets and the Program tab engine

**Files:**

- Create: `src/franchise/club/program.ts`
- Modify:
  - `src/franchise/club/owner.ts`: grades read the goal keys present
  - `src/franchise/coaching/staff.ts`, `src/franchise/leagues/college.ts`
- Test: `src/franchise/__tests__/program.test.ts`

**Interfaces:**

- Produces:
  - `adGoals(f: Franchise, teams: Team[]): OwnerGoal[]`. Winning is a share of games from prestige. Postseason is a round index: 0 is the conference tournament, 1 the national tournament, 2 the second weekend and 3 the final four. Recruiting is a class rank.
  - `postseasonReached(f: Franchise, teamId: string): number`
- Grade bands, from A down to D:
  - Postseason: `[1, 0, -1, -2]` rounds.
  - Recruiting: `[-15, 0, 20, 45]` places, where lower is better.
- Produces:
  - `staffBudget(team: Team, league: LeagueId): number`. College: `$600K + prestige × $2.4M` in Division I, ×0.25 in II and ×0.1 in III. High school: `$20K + prestige × $40K`.
  - `STAFF_PAY: Record<LeagueId, number>`, with values 1, 0.25 and 0.01.
- `hireStaff` refuses with a reason when the budget is passed outside pro.
- Review notes say "The athletic director …" or "The principal …".

- [ ] **Step 1: Write the failing tests**

```ts
it("a top program is expected to reach the second weekend and sign a top-15 class", ...);
it("a small program is expected to make its conference tournament", ...);
it("reaching further than the goal grades higher", ...);
it("a college review moves security like an owner's, and can fire after a full season", ...);
it("college staff cost a quarter of pro staff and must fit the staff budget", ...);
it("pro goals and reviews are unchanged", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/program.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run them, then `owner.test.ts`, `jobs.test.ts` and `staff.test.ts`**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/franchise
git commit -m "Add athletic director goals and staff budgets"
```

### Task 9: College hub, creation and season screens

**Files:**

- Create: `src/ui/BracketView.tsx`, moved from `src/app/career/hub/CollegeTabs.tsx` (`BracketRounds`), and `src/app/franchise/hub/OutsideTeamDialog.tsx`
- Modify:
  - `src/app/career/hub/CollegeTabs.tsx`: imports the moved view
  - `src/app/franchise/new/FranchiseCreator.tsx`, `src/app/franchise/hub/FranchiseHub.tsx`
  - `StandingsTab.tsx`, `PlayoffsTab.tsx`, `RosterTab.tsx`, `HomeTab.tsx`, `ScheduleTab.tsx`, `LeadersTab.tsx`, `SettingsTab.tsx`, `src/app/franchise/hub/actions.ts`
- Test: `e2e/smoke.spec.ts`

**Interfaces:**

- Produces: `tabsFor(m: LeagueModule)`.
  - Pro keeps today's tabs.
  - College has Home, Offseason, Schedule, Roster, Coaching, Recruiting, Program, League, Standings, Leaders, Postseason and Settings.
  - Recruiting and Program are built in Task 10. Until then they show "Coming soon".
- The creator:
  - Enables College with a division picker and a conference filter, and keeps the search box.
  - Shows only the settings in `settingsOptions`.
- Standings:
  - A conference picker and a Top 25 from `ranked`.
  - An "Other divisions" switch that reads `season.outside`.
- Postseason shows each bracket with `BracketView`.
- Roster:
  - Shows class year and eligibility, with a Redshirt button where `canRedshirt`.
  - Drops pro-only actions when `systems.cap` is false.
- Home says "Play the 2nd half" from `lastPeriodLabel`.
- Until Task 10 ships the Recruiting tab, a college save keeps auto `recruiting` on and the tab says your staff is recruiting for you, so the user's program still signs classes in `0.4.0-beta.15`.
- Clicking any team opens its roster. Outside teams use `outsideRoster`.

- [ ] **Step 1: Write the failing browser tests**

```ts
test("create a Division II franchise, sim to the next event, and reload", ...);
test("the college hub hides trades, free agents, the draft and the club", ...);
test("standings switch conferences and show other divisions", ...);
test("an outside team's roster opens from the standings", ...);
test("the play controls say 2nd half", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx playwright test e2e/smoke.spec.ts -g "college|Division|2nd half"`
Expected: FAIL, College shows "Coming soon".

- [ ] **Step 3: Implement the screens**

- [ ] **Step 4: Run them, then the full live and beta browser suites**

Expected: PASS. Career bracket tests are unchanged.

- [ ] **Step 5: Ship `0.4.0-beta.15`**

1. Add a changelog section, "College franchises", with a header for each area.
2. Update How to Play with short college bullets.
3. Bump the version, run the full gate, push, and confirm `/beta/` serves the new version.

```bash
git add -A
git commit -m "0.4.0-beta.15: college franchises — a full division, the tournaments and college screens"
```

### Task 10: Recruiting, portal and Program screens

**Files:**

- Create: `src/app/franchise/hub/RecruitingTab.tsx`, `PortalPanel.tsx`, `ProgramTab.tsx`
- Modify:
  - `src/app/franchise/hub/OffseasonTab.tsx`: declarations with Pitch, portal rounds, signing day, camp walk-ons
  - `src/app/franchise/hub/SettingsTab.tsx`, `src/app/franchise/hub/RosterTab.tsx`: NIL column, Retain
  - `src/franchise/auto.ts`
- Test: `e2e/smoke.spec.ts`, `src/franchise/__tests__/auto.test.ts`, `soak.test.ts`

**Interfaces:**

- The Recruiting tab:
  - Points left this week.
  - Open scholarships and NIL room.
  - A sortable, filterable board of recruits: stars, rank, position, range, home state, top three wants, interest bar against the leader, status.
  - A "My targets" filter, and actions with their costs.
  - The class rank.
- Program shows the athletic director's goals and reviews, the job panel, NIL budgets, the staff budget and history at this school.
- `AUTO_KEYS` adds:
  - `recruiting`: "Your staff recruits, offers NIL and handles the portal".
  - `squads`: "Your staff runs tryouts and sets squads".
- The soak test gains `SOAK_LEAGUE=college` with `SOAK_DIVISION`. With it, the soak checks:
  - Every roster is 10 to 15 all season and 13 to 15 after camp.
  - No program is over its scholarships.
  - The division's average overall stays within 2.5 of the start.
  - Every program signs a class each year.
  - The worst program stays within 10 of the start.
  - Over 30 seasons, the national title goes to at least 8 programs.
  - A 30-season save exports under 40 MB.

- [ ] **Step 1: Write the failing tests**

```ts
test("call, scout and offer a recruit, then reload and see the offer", ...);
test("the portal step runs three rounds and then lets you continue", ...);
test("Program shows the athletic director's goals", ...);
it("auto recruiting spends the week's points and fills the class", ...); // auto.test.ts
it("college soak: 30 seasons on auto stay legal and stable", ...); // soak.test.ts, SOAK=1
```

- [ ] **Step 2: Run them to verify they fail**

Expected: FAIL, the tabs say "Coming soon", and `auto.recruiting` is missing.

- [ ] **Step 3: Implement the screens and auto recruiting**

- [ ] **Step 4: Run the soak across five seeds and three modes, on Arm and x64**

Run: `SOAK=1 SOAK_LEAGUE=college SOAK_SEED=<n> SOAK_MODE=<auto|off|fired> npx vitest run src/franchise/__tests__/soak.test.ts`, for Division I and Division III.
Expected: PASS for every seed. Tune recruit talent, growth and the AI's spread, then record the floors as rulings.

- [ ] **Step 5: Ship `0.4.0-beta.16`**

1. Add changelog headers for Recruiting, NIL and the portal, and Eligibility.
2. Update How to Play with recruiting bullets.
3. Run the full gate, push, and confirm the version on `/beta/`.

```bash
git commit -m "0.4.0-beta.16: recruiting, NIL, the transfer portal and the Program tab"
```

---

## M11: High school

### Task 11: The high school world and the state playoffs

**Files:**

- Create: `src/franchise/leagues/hs.ts`
- Modify:
  - `src/career/hs/schedule.ts`: an optional `target` parameter, default `REGULAR_TARGET`
  - `src/career/hs/playoffs.ts`: an optional `open` parameter, default true
  - `src/franchise/create.ts`, `src/franchise/core/awards.ts`, `src/franchise/types.ts`
- Test: `src/franchise/__tests__/hsWorld.test.ts`

**Interfaces:**

```ts
export type Squad = "varsity" | "jv" | "frso";
export interface HsState {
  /** The user's lower squads. Varsity is f.rosters[school]. */
  jv: string[];
  frso: string[];
  /** Students cut or not yet placed, who can try out again. */
  pool: string[];
  tryout?: { year: number; scores: Record<string, number> };
  /** The user's JV and FR/SO games, decided on score. */
  levelGames: ScheduledGame[];
}
```

- Produces: `hsLeague`:
  - Calendar from `hsCalendar`: opening is `firstGame`, `lastGame` is `lastRegular`, and `seasonEnd` as in career.
  - Quarter minutes 8, 4 periods, `lastPeriodLabel: "4th quarter"`, arena `"gym"`.
  - Roster `{ min: 8, max: 15, campMin: 10 }`.
  - Game options `[18, 14, 10]`.
  - Postseason from `createBrackets` and `advanceBracket`, with the Open Division per the setting. The season ends when every bracket has a champion.
- Awards:
  - State Player of the Year and Freshman of the Year.
  - Player of the Year for each class.
  - An All-State first team of 5.
- Produces: `principalGoals(f: Franchise, teams: Team[]): OwnerGoal[]` in `src/franchise/club/program.ts`, as `hsLeague.goals`. Development counts the overall gained by returning varsity and JV players.
- Produces: `createFranchise({ league: "hs", ... })`:
  - Varsity for every school that fields one comes from `levelRoster(team, "varsity", year)`.
  - The user's JV and FR/SO come from `levelRoster` for each level the school fields.
- Produces: `levelSchedule(f: Franchise, team: Team, squad: "jv" | "frso", year: number): ScheduledGame[]`, which mirrors the varsity dates against the same opponents' generated squads. Also `simLevelDay(f: Franchise, teams: Team[], date: IsoDate): Franchise`, which uses `simScore` with `rosterStrength` on the user's side and `estimatedStrength` on the other.

- [ ] **Step 1: Write the failing tests**

```ts
it("a high school franchise has a varsity for every school that fields one", ...);
it("the school with no varsity can't be picked", ...);
it("every school plays its region round robin and reaches its game target, with a holiday tournament", ...);
it("the 10-game setting still keeps every region game", ...);
it("the state playoffs seed the Open Division and each class from the power rankings", ...);
it("with the Open Division off, 6A to 4A brackets take their best teams back", ...);
it("2A and 1A brackets with 24 teams have a play-in", ...);
it("the season ends with a champion in every bracket", ...);
it("high school awards name real players, once each, with a winner per class", ...);
it("the user's JV and FR/SO play their own games and keep records", ...);
it("a school with only varsity and JV has no FR/SO games", ...); // Review Focus 5
it("a principal expects more from a strong school", ...);
it("a high school save is under 6 MB and a season sims in under 30 seconds", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/hsWorld.test.ts`
Expected: FAIL, `Franchise doesn't support the hs league yet.`

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run them, then `src/career/__tests__/hs.test.ts` and `bracket.test.ts`**

Expected: PASS, with the career tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/career/hs src/franchise
git commit -m "Build the high school world, lower squads and the state playoffs"
```

### Task 12: Feeders, tryouts and squads

**Files:**

- Create: `src/franchise/hs/feeders.ts`, `src/franchise/hs/squads.ts`
- Modify: `src/franchise/leagues/hs.ts`, `src/franchise/core/progress.ts`, `src/franchise/coaching/development.ts`, `src/franchise/auto.ts`
- Test: `src/franchise/__tests__/hsSquads.test.ts`

**Interfaces:**

- High school offseason steps:
  - `review`: the season's end.
  - `progress`: June 1 of `year + 1`.
  - `tryouts`: `hsCalendar(year + 1).tryouts`.
- Produces:
  - `FEEDER_SIZE: Record<HsClass, number>`, which is `{ "6A": 18, "5A": 15, "4A": 12, "3A": 10, "2A": 8, "1A": 6 }`.
  - `feederClass(team: Team, year: number, seed: string): Player[]`. It has `FEEDER_SIZE ± 2` freshmen, with talent at `teamTalentTarget + LEVEL_OFFSET.frso − 4 + normal(0, 5)`.
  - `rollSchool(f: Franchise, team: Team, rng: Rng): Franchise`. For an AI school, seniors leave, the rest grow, and varsity is refilled to 12 from the best of `levelRoster(team, "jv", year)` and the feeder class.
- Produces:
  - `tryoutScores(f: Franchise, rng: Rng): Record<string, number>`
  - `squadLimits(team: Team): Partial<Record<Squad, [number, number]>>`
  - `moveToSquad(f: Franchise, playerId: string, squad: Squad | "cut", teams: Team[]): Franchise | { error: string }`, refused on a game day or when a squad would break its limits
  - `autoSquads(f: Franchise, teams: Team[]): Franchise`
  - `squadProblem(f: Franchise, teams: Team[]): string | null`
- `moveToSquad` is a roster move, so it goes through `useRosterMove` and can be undone until the next game.
- `canAdvance` at `tryouts` requires `squadProblem` to be null. With auto `squads` on, `autoSquads` runs first.
- At progress, the user's school and every AI school roll over. Seniors become `RetiredPlayer` rows, with `service` counting varsity seasons.
- Weekly development counts JV and FR/SO players, at 0.6 and 0.4 of the varsity bonus.

- [ ] **Step 1: Write the failing tests**

```ts
it("feeder classes follow classification and prestige", ...);
it("tryouts score every player in the program, freshmen included", ...);
it("FR/SO takes only freshmen and sophomores", ...);
it("squads must be 10 to 15, and moves are refused on game days", ...);
it("cut seniors leave, and cut underclassmen stay in the pool for next year", ...);
it("auto squads put the best on varsity and fill every level the school fields", ...);
it("a school with only varsity gets one valid squad", ...); // Review Focus 5
it("a tiny feeder class still fills every squad to its minimum", ...); // Review Focus 5
it("AI schools stay near their talent level over 20 seasons", ...);
it("high school players grow about 4 a year", ...);
it("with everything off and only Continue pressed, tryouts stop and ask, and auto squads fixes it", ...); // Review Focus 3
it("squads survive a partial commit and reload", ...);
it("undo puts a moved player back on his old squad", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/hsSquads.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run them to verify they pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/franchise
git commit -m "Add feeders, tryouts and squads"
```

### Task 13: High school screens

**Files:**

- Create: `src/app/franchise/hub/SquadsTab.tsx`, `TryoutsPanel.tsx`
- Modify: `FranchiseCreator.tsx` (adds a class filter), `FranchiseHub.tsx`, `ProgramTab.tsx` (principal), `StandingsTab.tsx` (region and class pickers), `ScheduleTab.tsx` (JV and FR/SO results), `OffseasonTab.tsx`
- Test: `e2e/smoke.spec.ts`

**Interfaces:**

- High school tabs: Home, Offseason, Schedule, Squads (in place of Roster), Coaching, Program, League, Standings, Leaders, Postseason, Settings.
- Squads shows three lists with move buttons, each list's limits, and the pool.
- Tryouts shows scores, Auto set squads, and Cut.
- Program says "The principal".

- [ ] **Step 1: Write the failing browser tests**

```ts
test("create a high school franchise, move a player to JV, and reload", ...);
test("standings filter by region and class", ...);
test("the schedule shows JV and FR/SO results after a week", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Expected: FAIL, High school shows "Coming soon".

- [ ] **Step 3: Implement the screens**

- [ ] **Step 4: Run them, then the full browser suites**

Expected: PASS.

- [ ] **Step 5: Ship `0.4.0-beta.17`**

1. Add a changelog section, "High school franchises".
2. Update How to Play with short high school bullets.
3. Run the full gate, push, and confirm the version on `/beta/`.

```bash
git commit -m "0.4.0-beta.17: high school franchises — feeders, tryouts, three squads and the state playoffs"
```

### Task 14: Jobs in any league

**Files:**

- Modify:
  - `src/franchise/club/program.ts`, `src/franchise/club/jobs.ts`, `src/franchise/world.ts`
  - `src/franchise/storage.ts`: season rows gain `league`
  - `src/app/franchise/hub/JobPanel.tsx`, `HistoryPanel.tsx`, `HallPanel.tsx`, `RecordsPanel.tsx`
- Test: `src/franchise/__tests__/jobs.test.ts`, `worldMove.test.ts`

**Interfaces:**

- Changes: `jobOffers(f: Franchise, teams: Team[], others: Partial<Record<LeagueId, Team[]>>): JobOffer[]`, with `JobOffer = WorldRef & { teamId: string }`. Pro offers and their order don't change when `others` is empty.
- Produces: `moveWorld(f: Franchise, offer: JobOffer, allTeams: Team[], now: number): Franchise`.
  - The new world comes from `createFranchise` at that league's next opening after `f.date`.
  - The franchise keeps its `id`, `revision`, `settings.auto`, difficulty, close-game settings and `job`. The job's stints are closed, and the new stint carries `league` and `division`.
  - The old world goes into `formerWorlds`.
  - Undo, `live` and open bids are cleared.
- The hub:
  - Loads every league when the coach is fired.
  - Commits a move in full.
  - Deletes saved games from the old world.
- History, Records and Hall get a world picker that includes former worlds. Past season rows are filtered by `league`.

- [ ] **Step 1: Write the failing tests**

```ts
it("a fired coach gets offers from other worlds that fit his reputation", ...);
it("pro offers are unchanged when no other leagues are passed", ...);
it("pro to college: the new world starts at the next college opening, later than any old season", ...); // Review Focus 4
it("college Division III to Division I builds the new division", ...); // Review Focus 4
it("high school to pro keeps the coaching record and the Road to Legend links", ...); // Review Focus 4
it("a move clears undo, a live game and open bids, and the old world's saved games go", ...); // Review Focus 4
it("after a move and reload, History shows the former world's seasons and Hall", ...); // Review Focus 4
it("the moved world's first season sims to its offseason", ...);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/franchise/__tests__/jobs.test.ts src/franchise/__tests__/worldMove.test.ts`
Expected: FAIL, `moveWorld` not found.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run them, then the whole suite**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/franchise src/app/franchise
git commit -m "Let a fired coach take a job in any league"
```

### Task 15: High school and cross-league soak, docs and release

**Files:**

- Modify: `src/franchise/__tests__/soak.test.ts`, `e2e/smoke.spec.ts`, `CHANGELOG.md`, `README.md`, the How to Play page, Terms, Privacy, Credits, `package.json`, `package-lock.json`

**Interfaces:**

- `SOAK_LEAGUE=hs` runs 30 seasons and checks:
  - Squads stay legal all season.
  - Every school has 8 to 15 varsity players.
  - Average varsity overall stays within 2.5 of the start.
  - Every class has a state champion every year.
  - A 30-season save exports under 40 MB.
- `SOAK_MODE=fired` with `SOAK_LEAGUE=any` takes the first offer from another world at each firing. It checks that every move reaches a playable season.

- [ ] **Step 1: Write the failing tests**

```ts
it("high school soak: 30 seasons on auto stay legal and stable", ...);
it("fired across worlds: every move starts a playable season", ...);
test("a fired coach can take a job in another league from the browser", ...); // e2e with a seeded save near firing
```

- [ ] **Step 2: Run them to verify they fail**

Expected: FAIL, `SOAK_LEAGUE` is ignored, and the job panel shows only pro teams.

- [ ] **Step 3: Implement, then run the soaks**

Run each soak across five seeds and three modes, on Arm and x64. Tune growth and feeder talent until all pass, and record the floors as rulings.

- [ ] **Step 4: Ship `0.4.0-beta.18`**

1. Add changelog headers for Jobs in any league, and Fixes.
2. Update How to Play with job moves.
3. Update the README's mode list. Check Terms, Privacy and Credits; none of them should need changes.
4. Run the full gate, push, and confirm the version on `/beta/`.

```bash
git commit -m "0.4.0-beta.18: jobs in any league, and decades of college and high school soak testing"
```

### Final review

A fresh reviewer on `fable` reads the whole branch from `40f74c2`, weighing the rulings in the ledger and the Review Focus list. Critical and Important findings get one fix pass, each fix shown failing and then passing. The result ships as `0.4.0-beta.19`, and the workspace is deleted.
