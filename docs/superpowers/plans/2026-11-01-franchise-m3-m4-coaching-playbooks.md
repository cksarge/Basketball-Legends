# Franchise M3–M4: Coaching and Playbooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user coaches their team through depth, tactics, matchups, practice, player plans, staff and playbooks, in simulated and played games, and can play only the 4th quarter or close games. Ships to `/beta/` as `0.4.0-beta.4` (M3) and `0.4.0-beta.5` (M4).

**Architecture:** One saved `TeamPlan` on the franchise is the source of truth. It resolves to the existing match inputs (`starters`, `rotation`, `tactics`) and the same values drive `simBox`. Playbooks are new optional fields on `TeamTactics`, read by a new `src/game/sim/plays.ts`; with no system set, the engine takes the same code path and draws the same random numbers as today.

**Tech Stack:** TypeScript, Next.js static export, Dexie, zustand, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-phase3-franchise-design.md` (Coaching, Quality of life)

## Global Constraints

- Work on `prerelease`. Never merge to `main` without the user's go-ahead.
- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code.
- Root-relative file paths go through `asset()` in `src/lib/site.ts`.
- `src/franchise/` has no React and no `window` access. `src/game/sim/` stays pure too.
- No real league marks or real player names.
- "With no playbook set, the AI behaves exactly as it does now." Road to Legend, Quick Play and the park keep their current behavior and saves. Existing tests are not edited to make them pass.
- `FRANCHISE_VERSION` rises, and `0.4.0-beta.3` saves must keep working.
- Bump versions by editing the `version` lines in `package.json` and `package-lock.json` only.
- Every push updates `CHANGELOG.md`, README, How to Play, Terms, Privacy, Credits and the sitemap as needed.
- A push is done only after `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run format:check`, `npx playwright test` on the live build and `--grep-invert @gpu` on the beta build pass, and `curl` shows the new version on `/beta/`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Each line has its test in the owning task.

1. A starter gets hurt, or minutes stop adding up: the lineup still fills, the team totals 240 minutes, and the saved plan comes back when the player returns (Task 2).
2. A `0.4.0-beta.3` franchise in mid-season: it opens with default coaching and keeps its stats (Task 2).
3. A game saved mid-play before playbooks existed: it resumes with no system and doesn't crash (Task 6).
4. A called play's focus player is off the floor, hurt or fouled out: the offense falls back to normal play with no stall (Task 6).
5. Leaving a 4th-quarter game, or simming it from the hub: the three simulated quarters aren't counted twice and the score doesn't change (Task 10).

---

## File Structure

```
src/game/sim/playbook.ts            systems and plays as data
src/game/sim/plays.ts               running a play: routes, entry passes, fallbacks
src/game/__tests__/engine-lock.test.ts, engine-lock.json   proof the default AI didn't change
src/franchise/coaching/plan.ts      TeamPlan, defaults, resolving a lineup, warnings
src/franchise/coaching/development.ts  weekly practice and player plans
src/franchise/coaching/staff.ts     staff roles, hiring pool and effects
src/franchise/partial.ts            simulated first three quarters
src/app/franchise/hub/CoachingTab.tsx and sections DepthPanel, TacticsSection, PracticePanel, StaffPanel, PlaybookPanel
```

---

## M3: Coaching

### Task 1: Lock the default engine, then add matchups

**Files:**

- Create: `src/game/__tests__/engine-lock.test.ts`, `src/game/__tests__/engine-lock.json`
- Modify: `src/engine/types.ts` (`TeamTactics`), `src/game/sim/match.ts:424-431` (`assignRoles`), `src/game/sim/ai.ts:711`
- Test: `src/game/__tests__/matchups.test.ts`

**Interfaces:**

- Produces:

```ts
// TeamTactics gains, all optional:
matchups?: Record<string, string>; // my player id -> their player id
doubleTarget?: string; // their player id; when set, it replaces the "potential > 88" check
```

- [ ] **Step 1: Write the lock.** Before any engine change, run 6 seeded games with `runMatchSync` (quarterMinutes 3, covering pro, college and hs, man and a zone) and store final scores and possession counts in `engine-lock.json`. The test re-runs them and asserts exact equality. Run it: PASS.
- [ ] **Step 2: Write the failing matchup tests.** With `tactics.matchups` mapping my PG to their C, that agent's `guarding` points at their C after `assignRoles`, and every other agent still has a distinct mark. A matchup naming a player off the floor uses the position rank. With `doubleTarget` set, help doubles that player even with `potential` below 88, and over 60 seeded possessions never doubles anyone else.
- [ ] **Step 3: Run them.** `npx vitest run src/game/__tests__/matchups.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.** Apply named matchups first in `assignRoles`, then give the remaining defenders the remaining marks in position order.
- [ ] **Step 5: Run tests.** `npx vitest run src/game`. Expected: PASS, including the lock.
- [ ] **Step 6: Commit.** `Coaching matchups and a chosen double team in the game engine`

### Task 2: Team plan and save migration

**Files:**

- Create: `src/franchise/coaching/plan.ts`
- Modify: `src/franchise/types.ts`, `src/franchise/create.ts`, `src/franchise/storage.ts`
- Test: `src/franchise/__tests__/plan.test.ts`, `src/franchise/__tests__/storage.test.ts`

**Interfaces:**

- Consumes: `defaultRotation`, `DEFAULT_TACTICS`, `TeamTactics`.
- Produces:

```ts
export const FRANCHISE_VERSION = 2;
export type PracticeFocus = "balanced" | "shooting" | "finishing" | "playmaking" | "defense" | "conditioning";
export interface PlayerPlan {
  focus: string;
  newPos?: Position;
  posWeeks?: number;
} // focus is a TRAINING id from career/pro/season.ts
export interface TeamPlan {
  autoRotation: boolean;
  starters: string[];
  minutes: Record<string, number>; // per 240-minute game
  tactics: TeamTactics;
  practice: PracticeFocus;
  playerPlans: Record<string, PlayerPlan>;
  staff: StaffMember[]; // Task 4
}
// Franchise gains: plan: TeamPlan; devDate: IsoDate

export function defaultPlan(): TeamPlan;
export interface Lineup {
  starters: string[];
  rotation: Record<string, number>;
}
export function resolveLineup(plan: TeamPlan, roster: Player[], totalMinutes: number): Lineup;
export type DepthWarning = { playerId: string; kind: "fatigue" | "position" | "hurt" | "unused" };
export function depthWarnings(plan: TeamPlan, roster: Player[]): DepthWarning[];
```

`resolveLineup` uses `defaultRotation` when `autoRotation` is on. Otherwise it drops hurt or departed players, fills empty starting spots with the best healthy player at that position, gives a hurt player's minutes to the next players, then scales to `totalMinutes` with no player above a full game. It never changes the saved plan. Warnings: `fatigue` above 38 minutes, `position` for a starter out of place (spot's position is neither `pos` nor `secondaryPos`).

- [ ] **Step 1: Write the failing tests.** `resolveLineup`: auto equals `defaultRotation`; a saved plan returns its starters; a hurt starter is replaced by a healthy player of that position and totals stay 240; minutes summing to 0, 100 or 400 still total 240 with nobody above 48; a traded-away id is ignored; the plan object is deep-equal before and after, so the player returns to it when healed. `depthWarnings`: one test per kind. Storage: a stored version 1 save, built by removing `plan` and `devDate`, loads with `defaultPlan()` values, the same `season.stats` and `version: 2`; export and import of a version 1 file also upgrades.
- [ ] **Step 2: Run them.** `npx vitest run src/franchise/__tests__/plan.test.ts src/franchise/__tests__/storage.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement,** with `migrateFranchise` filling `plan` and `devDate` for version 1.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `Franchise team plans with lineups that survive injuries`

### Task 3: The plan drives every game

**Files:**

- Modify: `src/franchise/boxsim.ts`, `src/franchise/core/season.ts:boxSide`, `src/franchise/match.ts`, `src/franchise/__tests__/engine-baseline.json` only if `scripts/franchise-baseline.ts` is extended
- Create: `scripts/franchise-tactics-baseline.ts`, `src/franchise/__tests__/tactics-baseline.json`
- Test: `src/franchise/__tests__/boxsim-tactics.test.ts`, `src/franchise/__tests__/match.test.ts`

**Interfaces:**

- Consumes: `resolveLineup`, `TeamTactics.matchups`, `TeamTactics.doubleTarget`.
- Produces: `boxSide` and `dressed`/`startersOf` both call `resolveLineup` for the user's team. `franchisePending` passes `tactics`, `starters` and `rotation` on the user's side. `simBox` honors `pace`, `threeRate`, `defense`, `crashBoards`, `doubleTeamStars`, `doubleTarget` and `matchups`.

The baseline script runs 20 real-engine pro games per setting (default, each `defense`, pace 0.1 and 0.9, threeRate 0.1 and 0.9, crashBoards 0.1 and 0.9) and records the change in team stats against the default.

- [ ] **Step 1: Run the baseline and commit its JSON.**
- [ ] **Step 2: Write the failing tests.** For every setting, the `simBox` change over 300 games has the same sign as the baseline where the baseline's change exceeds 3%. A doubled star takes fewer shots and gets more assists. An elite defender assigned to a star lowers that star's FG%. `simBox` with default tactics still passes `boxsim.test.ts`. `franchisePending` carries the plan's tactics, starters and rotation on the user's side only, and a simmed game uses the saved starters.
- [ ] **Step 3: Run them.** `npx vitest run src/franchise`. Expected: new tests FAIL.
- [ ] **Step 4: Implement,** adding named constants at the top of `boxsim.ts`.
- [ ] **Step 5: Run them.** Expected: PASS.
- [ ] **Step 6: Commit.** `Team plans and tactics drive simulated and played games`

### Task 4: Practice, player plans and staff

**Files:**

- Create: `src/franchise/coaching/development.ts`, `src/franchise/coaching/staff.ts`
- Modify: `src/franchise/core/season.ts` (`simDay`, injuries), `src/franchise/boxsim.ts`
- Test: `src/franchise/__tests__/development.test.ts`, `src/franchise/__tests__/staff.test.ts`

**Interfaces:**

- Consumes: `TRAINING` from `src/career/pro/season.ts`, `TeamPlan`, `Rng`.
- Produces:

```ts
export type StaffRole = "assistant" | "development" | "scout" | "trainer";
export interface StaffMember {
  id: string;
  role: StaffRole;
  name: string;
  rating: number;
  salary: number;
} // rating 40..95
export function staffPool(f: Franchise, role: StaffRole): StaffMember[]; // 6 candidates, same for a seed and year
export function hireStaff(f: Franchise, who: StaffMember): Franchise; // replaces that role
export const staffRating: (f: Franchise, role: StaffRole) => number; // 50 if the role is empty
export function weeklyDevelopment(f: Franchise): { franchise: Franchise; changedPlayers: string[] };
```

`weeklyDevelopment` runs from `simDay` each time `f.date` passes `devDate + 7`, for the user's team only. League-wide growth arrives in M5. Gain chance per focus rating depends on age (youth curve from `develop` in `src/career/hs/season.ts`), `traits.workEthic` and the development coach, and stops once `playerOvr` reaches `potential`. A player plan's keys count double the team focus. `newPos` sets `secondaryPos` after 12 weeks. Names come from `src/engine/names.ts`. The trainer's rating cuts `gamesOut` on the user's team: rating 90 removes about a quarter. The assistant adds to the user team's make chance in `simBox`: 0 at rating 50, 0.004 at rating 95. The scout is stored for M5.

- [ ] **Step 1: Write the failing tests.** Over 20 weeks, a young worker on a shooting focus gains in `three` more than an old low-effort player, and nobody passes `potential`. A better development coach gains more on average over 30 seeded players. `conditioning` raises `stamina`. `newPos` sets `secondaryPos` after 12 weeks and not at 11. A week with no date change does nothing, and an interrupted run replays to the same ratings. `staffPool` repeats for a seed, and `hireStaff` replaces the role. A rating 90 trainer gives fewer total games out over a season than rating 40. An empty role is treated as 50.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, then `npx vitest run src/franchise`.** Expected: PASS.
- [ ] **Step 5: Commit.** `Weekly practice, player plans and coaching staff`

### Task 5: Coaching tab and `0.4.0-beta.4`

**Files:**

- Create: `src/app/franchise/hub/CoachingTab.tsx`, `DepthPanel.tsx`, `PracticePanel.tsx`, `StaffPanel.tsx`
- Modify: `src/app/franchise/hub/FranchiseHub.tsx`, `src/ui/TacticsPanel.tsx`, `e2e/smoke.spec.ts`, docs and version files
- Test: `e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: `resolveLineup`, `depthWarnings`, `TacticsPanel`, `staffPool`, `hireStaff`, `useFranchise.update`.
- Produces: a Coaching tab with Depth, Tactics, Practice and Staff sections. Depth has an Auto rotation toggle, five starter slots that accept dragged players and also have a `Select` for keyboard and touch use, a minutes `Slider` per player, a running total, warnings and Reset to auto. `TacticsPanel` gains an optional `opponents` prop: with it, it shows a double-target `Select`. Matchups are set per game in the pause menu Tactics tab and on Home's next-game card, and clear after that game. Saving is disabled while a sim is running.

- [ ] **Step 1: Write the failing e2e test:** turn off Auto rotation, choose a starter, set a focus and hire a development coach, reload and see them kept, then Sim game and find the chosen starter with a start on Roster's new GS column; no console errors.
- [ ] **Step 2: Build and run it.** `npm run build && npx playwright test --grep-invert @gpu -g coaching`. Expected: FAIL.
- [ ] **Step 3: Implement.** Follow the hub's tab pattern.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Bump to `0.4.0-beta.4`, update docs, run the Global Constraints checks.**
- [ ] **Step 6: Commit and push.** `0.4.0-beta.4: coach your team`, then confirm on `/beta/`.

---

## M4: Playbooks

### Task 6: Systems and plays in the game AI

**Files:**

- Create: `src/game/sim/playbook.ts`, `src/game/sim/plays.ts`
- Modify: `src/engine/types.ts`, `src/game/sim/ai.ts:398-408`, `:250` (`offenseAI`), `:484` (`offBall`)
- Test: `src/game/__tests__/playbook.test.ts`, `src/game/__tests__/engine-lock.test.ts`

**Interfaces:**

- Produces:

```ts
export type SystemId = "motion" | "pickRoll" | "postUp" | "paceSpace" | "isoStar";
export type PlayId = "horns" | "floppy" | "clearout" | "postEntry" | "backdoor" | "drag" | "spainPnr" | "elbow";
export interface SystemDef {
  id: SystemId;
  label: string;
  hint: string;
  plans: Partial<Record<"drive" | "iso" | "pnr" | "post" | "hold", number>>;
  threeBias: number;
  cutRate: number;
  passFirst: number;
  plays: PlayId[];
}
export interface PlayDef {
  id: PlayId;
  label: string;
  focus: "star" | "shooter" | "big" | "handler";
  plan: "drive" | "iso" | "pnr" | "post";
  route: (side: 1 | -1) => V2 | null;
  seconds: number;
}
export const SYSTEMS: Record<SystemId, SystemDef>;
export const PLAYS: Record<PlayId, PlayDef>;
// TeamTactics gains: system?: SystemId; plays?: PlayId[] (at most 6)

export function focusAgent(match: Match, team: TeamIdx, play: PlayDef): Agent | null; // null if nobody on the floor fits
export function pickPlay(match: Match, team: TeamIdx): void; // sets playCall at the start of a half-court possession
export function runPlay(match: Match, a: Agent, decide: boolean): boolean; // handler: entry pass to the focus when open
export function playRoute(match: Match, a: Agent): V2 | null; // off-ball route for the focus player
```

`pickPlay` runs only when `tactics.system` is set, and `TeamGameState.playCall` keeps holding the id, cleared on change of possession as today. `"pnr"` from the existing call button stays valid. A play expires after its `seconds`, or if `focusAgent` is null, and normal offense resumes. All new `rng` draws sit behind the `system` check.

- [ ] **Step 1: Write the failing tests.** Over 12 seeded real-engine pro games per system at 6-minute quarters, against a default team: `postUp` raises the C and PF share of shots; `paceSpace` raises 3PA; `isoStar` raises the top player's shot share and lowers assists; `motion` raises assists; `pickRoll` raises the plan's `pnr` count, from a test counter on `AIMemo`. Each `PlayDef.route` returns a spot in bounds on both sides. A called play with its focus player removed from `onCourt` clears within `seconds` and the possession still ends in a shot or turnover. Restoring a `serialize()` string whose `tactics` lack `system` and `plays` gives a running game for 500 steps. `engine-lock.test.ts` still passes.
- [ ] **Step 2: Run them.** `npx vitest run src/game/__tests__/playbook.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement,** tuning the numbers in `playbook.ts`.
- [ ] **Step 4: Run them.** `npx vitest run src/game src/career`. Expected: PASS.
- [ ] **Step 5: Commit.** `Playbook systems and plays in the game AI`

### Task 7: Calling plays and the Playbook section

**Files:**

- Create: `src/app/franchise/hub/PlaybookPanel.tsx`, `src/ui/game/PlaysPanel.tsx`
- Modify: `src/game/sim/match.ts:980-982`, `src/ui/game/GameView.tsx`, `src/ui/hud/Hud.tsx`, `src/franchise/coaching/plan.ts`
- Test: `src/game/__tests__/playbook.test.ts`, `e2e/smoke.spec.ts`

**Interfaces:**

- Produces:

```ts
callPlay(team: TeamIdx, play: PlayId): boolean; // Match method; false if the play isn't in the team's active list
```

The existing `callScreen` input cycles through the team's active plays when `tactics.system` is set, and calls `"pnr"` otherwise. A banner shows the play's name through `showBanner`. The pause menu gets a Plays tab, shown only with a system set. The Coaching tab gets a Playbook section: pick a system, then up to 6 of its plays, with its hint text. AI opponents have no system in Franchise until M9 lets AI coaches differ.

- [ ] **Step 1: Write the failing tests.** `callPlay` sets `playCall` for an active play and refuses others. `callScreen` cycles in order and wraps; with no system it still sets `"pnr"`. Picking a 7th play is refused by a `setPlays` helper in `plan.ts`, and changing system drops plays it doesn't include. @gpu e2e: pick a system, Play, press the call key, see the banner, open the Plays tab.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, on a fresh `npm run build` for e2e.** Expected: PASS.
- [ ] **Step 5: Commit.** `Call plays in the game and build a playbook in the hub`

### Task 8: Playbooks in the simulator

**Files:**

- Modify: `src/franchise/boxsim.ts`, `scripts/franchise-tactics-baseline.ts`, `src/franchise/__tests__/tactics-baseline.json`
- Test: `src/franchise/__tests__/boxsim-tactics.test.ts`

**Interfaces:**

- Consumes: `SYSTEMS` from `src/game/sim/playbook.ts`.
- Produces: `simBox` reads `tactics.system` to set position usage, three share and assist rate.

- [ ] **Step 1: Extend the baseline to each system and commit its JSON.**
- [ ] **Step 2: Write the failing test.** For each system, the `simBox` change over 300 games in 3PA, AST, big-man shot share and top-player shot share has the same sign as the baseline where the baseline's change exceeds 3%.
- [ ] **Step 3: Run it.** Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run `npx vitest run src/franchise`.** Expected: PASS.
- [ ] **Step 6: Commit.** `Playbooks shape simulated games`

### Task 9: Three simulated quarters

**Files:**

- Create: `src/franchise/partial.ts`
- Modify: `src/franchise/boxsim.ts`, `src/game/sim/match.ts` (`MatchSetup`, constructor, `startNextPeriod`), `src/state/matchStore.ts`
- Test: `src/franchise/__tests__/partial.test.ts`, `src/game/__tests__/resume-quarter.test.ts`

**Interfaces:**

- Produces:

```ts
export interface PartialGame { home: number; away: number; box: BoxScore; seconds: number }
export function simQuarters(i: BoxInput, quarters: number): PartialGame;
// MatchSetup and PendingMatch gain:
startFrom?: { period: number; homeScore: number; awayScore: number; box: BoxScore };
export function finishPartial(f: Franchise, gameId: string, teams: Team[]): Franchise; // sims the last quarter from the saved partial
// Franchise gains: live?: { gameId: string; partial: PartialGame }
```

`startFrom` starts the match at that period through `startNextPeriod`'s setup, with scores, `periodScores`, `box` and per-player `minutes` filled, team fouls at zero, and players at the foul limit benched. The stored `live` keeps the partial stable across reloads.

- [ ] **Step 1: Write the failing tests.** `simQuarters(i, 3)` has team minutes of three quarters, and totals equal the score. It repeats for a seed. `finishPartial` keeps the partial's score as the floor, gives a final with a winner, and records the box once. A match with `startFrom` opens in period 4 with those scores and box, with no jump ball, finishes under `runMatchSync`, and a player with 6 fouls in the box never checks in. Without `startFrom`, `engine-lock.test.ts` passes.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npx vitest run src/franchise src/game`.** Expected: PASS.
- [ ] **Step 5: Commit.** `Start a game from the 4th quarter`

### Task 10: 4th-quarter and close-game modes, and `0.4.0-beta.5`

**Files:**

- Modify: `src/franchise/match.ts`, `src/franchise/types.ts`, `src/franchise/core/season.ts`, `src/franchise/simRun.ts`, `src/app/franchise/hub/HomeTab.tsx`, `e2e/smoke.spec.ts`, docs and version files
- Test: `src/franchise/__tests__/fourth.test.ts`, `e2e/smoke.spec.ts`

**Interfaces:**

- Consumes: `simQuarters`, `finishPartial`, `applyFinishedFranchiseMatch`, `FranchiseSettings.closeGameMargin`.
- Produces:

```ts
// FranchiseSettings gains: closeGamesOnly: boolean
export function startFourth(f: Franchise, game: ScheduledGame): Franchise; // sets f.live, reusing it if it's already this game
export function fourthPending(f: Franchise, game: ScheduledGame, teams: Team[], controller: string): PendingMatch;
```

Home adds **Play the 4th quarter**. Settings add **Close games only**: `runSim` sims a user game's first three quarters. If the margin is within `closeGameMargin`, it stops with `f.live` set and Home shows the score with **Play the 4th** and **Sim the rest**. Otherwise it finishes the game. Stats count the three simulated quarters as they are, and only the played quarter is scaled to full length. `Sim game` on a game with `f.live` uses `finishPartial`, never a fresh sim.

- [ ] **Step 1: Write the failing tests.** The played quarter's stats scale and the three simulated quarters don't. Applying the result twice changes nothing and clears `live`. `Sim game` after quitting a 4th-quarter game keeps the same three-quarter score. Reopening keeps the same partial. Close games only stops on a margin of 8 and not 9, and never stops with the setting off. A saved 4th-quarter game resumes from the hub. @gpu e2e: Play the 4th quarter opens at Q4 with a non-zero score, then Sim to end records one result.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, on a fresh build for e2e.** Expected: PASS.
- [ ] **Step 5: Bump to `0.4.0-beta.5`, update docs, run the Global Constraints checks.**
- [ ] **Step 6: Commit and push.** `0.4.0-beta.5: playbooks, play calling and 4th-quarter games`, then confirm on `/beta/`.
