# Phase 3: Franchise mode design

Written 2026-11-01. Work goes on `prerelease` and ships to `/beta/` as `0.4.0-beta.N`. The scope comes from the master plan (`~/.claude/plans/i-want-you-to-distributed-flute.md`, Phase 3) and the decisions recorded here.

## Goal

The player runs any team in any league as coach and GM, for as many seasons as they like. All three leagues are in before v0.4.0 reaches `main`. Any game can be played with full-team control, as in Quick Play, or simulated.

## Decisions

| Question           | Decision                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build order        | Pro, then college, then high school. All three ship in v0.4.0.                                                                                                                             |
| College world      | Every program in the player's division has persistent players. Other divisions play on team strength, appear in standings and postseason fields, and generate rosters when viewed.         |
| Being fired        | The save continues. The player chooses from teams willing to hire them, which may be weaker clubs or another league.                                                                       |
| Roster edits       | One top-level Rosters page. An active pack changes Quick Play and new franchises and careers. Existing saves keep the rosters they started with. A franchise can also edit its own league. |
| Architecture       | A new `src/franchise/` module with one persistent league, saved in separate pieces. Road to Legend's season code stays as it is.                                                           |
| League connections | A save holds one league. Draft classes and recruits are generated, so college players do not feed a pro save's draft.                                                                      |
| Save slots         | Franchise uses its own 3 in-game save slots, already reserved in `src/state/suspended.ts`.                                                                                                 |
| Legends            | Road to Legend Legends appear in Franchise league history.                                                                                                                                 |
| Names              | Rules, leagues and teams stay original. No real league marks or player names. Brophy Prep remains the documented exception.                                                                |

## What the code provides today

- `simulateSetup` runs the real engine at about 0.8 seconds per pro game, so a 1,230-game season would take about 16 minutes.
- `src/career/hs/sim.ts` and `src/career/pro/season.ts` simulate final scores only. Stat leaders and awards need box scores.
- `rollProRoster` rebuilds other teams' rosters loosely each season. Franchise needs every player to persist.
- `Contract` exists in `src/engine/types.ts`, but only the career player uses one.
- `TeamTactics` (pace, three rate, defense, crash boards, double teams) already changes AI behavior. `rotation` and `starters` are wired through match setup. Playbooks do not exist.
- A player costs about 1 KB of save data before stats: pro about 0.5 MB, high school about 3.4 MB, college D1 about 5 MB, all 1,092 college programs about 15 MB.
- One of three test games finished 159–115, so the calibration work must check real engine scoring as well as the fast simulator.

## Architecture

### Engine

`src/franchise/` is pure TypeScript with no React, so it runs in tests and workers.

- `types.ts`: the save format.
- `core/`: calendar events, day advance, shared roster and stat handling.
- `boxsim.ts`: the fast simulator.
- `leagues/pro.ts`, `leagues/college.ts`, `leagues/hs.ts`: each league's rules behind one `LeagueModule` interface, which covers its calendar, roster limits, offseason steps, postseason and goals.
- `pro/`: cap, contracts, trades, free agency, draft.
- `college/`: recruiting, NIL, portal, eligibility.
- `hs/`: feeders, tryouts, squads.
- `coaching/`: depth, playbooks, development, staff.
- `club/`: finances, owner goals, jobs.
- `history/`: awards, records, Hall of Fame, news, power rankings.

The module reuses `src/career/calendar.ts`, the schedule generators, and the bracket and postseason code. Where that code lives inside career seasons, it moves to a shared function and career keeps calling it, with existing tests unchanged.

### Fast simulator

A per-possession stat model produces full box scores from ratings, minutes, tactics and the playbook. A test tunes it against real engine games. It runs in a Web Worker through `comlink` so long sims leave the page responsive. Results are deterministic for a given seed.

### Played games

A played game uses the existing `PendingMatch` flow with `mode: "franchise"`, a new `franchise` game reference, and `returnTo` set to the hub. `MatchResult` brings back the real box score. Depth, tactics and playbook feed the match setup. Mid-game saves use the Franchise slots.

"Play the 4th quarter" simulates three quarters with `boxsim`, then starts the real engine from that score and those stats. "Close games only" sims until the 4th quarter and asks only when the margin is within a setting.

### Storage

`src/franchise/storage.ts` adds a Dexie database, `bl-franchise`, with separate tables for the summary, league state, players, the current season, and history. Each simulated day or roster move writes one transaction, so an interruption never leaves a half-written league. Files export and import as `.blfranchise`. Imports never overwrite and get a new id on a clash. `migrate` upgrades older saves and refuses newer ones with a clear message.

### State and pages

- `src/state/franchiseStore.ts` wraps load, save and actions.
- `/franchise/`: save select and import.
- `/franchise/new/`: setup (league, team, rules, auto-manage defaults).
- `/franchise/hub/?id=`: the hub.
- `/rosters/`: the editor and packs.

All routes are static. The main menu's Franchise card links to `/franchise/` once M1 lands and shows a beta label until M9.

## Pro rules

All numbers live in one settings file and scale with the cap.

| Rule            | Starting value                                                         |
| --------------- | ---------------------------------------------------------------------- |
| Salary cap      | $140M, rising a little each year with league revenue                   |
| Luxury tax line | $170M, with tax rising in steps                                        |
| First apron     | $178M, limits sign-and-trades and larger exceptions                    |
| Second apron    | $189M, also limits trades that take on salary                          |
| Max contract    | 25%, 30% or 35% of cap by years of service                             |
| Minimum salary  | $1.2M                                                                  |
| Rookie scale    | By draft slot, two guaranteed years plus team options                  |
| Veteran rights  | Exceed the cap to re-sign after 3 seasons, a smaller version after 1–2 |
| Exceptions      | Mid-level, biannual and minimum deals                                  |
| Roster          | 15 standard players plus 3 two-way players                             |

Existing `MAX_SALARY` ($55M) is the reference for the top end: the 35% max starts at $49M and grows past $55M as the cap rises.

## GM systems

- **Trades:** AI valuation uses age, overall, potential, contract and team direction (contending or rebuilding). Includes picks, multi-team deals, a trade finder, a trade block, salary matching, a deadline and AI-to-AI trades.
- **Free agency:** a moratorium period, then bidding rounds. Players weigh money, role and winning. Includes negotiation with mood, waivers, buyouts and developmental contracts.
- **Draft:** weighted lottery, generated classes, two rounds, draft-day trades. Scouting shows rating ranges that narrow with scouting budget and assignments. True ratings stay uncertain until a player has played.
- **Running the club:** owner goals for winning, profit and development drive job security. Ticket prices affect attendance and revenue. Market size comes from the arena and team prestige. Coaching, scouting and facilities each have a budget.

## College

- Recruiting class battles against other programs, with a weekly points budget for calls, visits and offers.
- A yearly NIL budget. The transfer portal uses the same system.
- Eligibility years, early draft declarations and scholarship limits.
- Conference tournaments, the 68-team national tournament and the NIT-style tournament, from career postseason code.
- The athletic director sets goals.

## High school

- Each year's freshmen arrive from a generated feeder pool that matches the school's size and prestige.
- No transfers or recruiting.
- Tryouts choose varsity, JV and FR/SO squads, using `Team.levels`.
- AIA-style state playoffs, from career bracket code.
- The principal sets goals.

## Jobs

A firing keeps the save and the coaching record. Offers depend on the record. Moving leagues starts that league from its default world at the current date, and the old league stays in the player's history.

## Coaching

- **Depth and rotation:** a starting lineup and minutes, fed through `starters` and `rotation`, with fatigue and out-of-position warnings.
- **Playbooks:** new game AI. A system (motion, pick-and-roll heavy, post-up, pace and space, iso-star) plus specific plays changes who gets touches, where players move and which shots they take, in the 3D game and in `boxsim`. Plays can be called during a game. With no playbook set, the AI behaves exactly as it does now.
- **Tactics:** existing `TeamTactics`, using `TacticsPanel`. New matchups set who guards whom and who gets doubled.
- **Development:** a team practice focus plus a plan per player, with results depending on age, work ethic and staff.
- **Staff:** assistants, a development coach, scouts and a trainer. Each has ratings and a salary, and affects development, scouting or injury recovery.

## League life

- All players age, progress, regress and retire. An offseason screen walks through each step.
- Each season keeps league history, records, awards and a Hall of Fame.
- A news feed covers trades, injuries, milestones and upsets, next to power rankings.

## Quality of life

- Play, sim, sim to a date, sim to the next event, play only the 4th quarter, or get asked only for close games.
- A separate auto-manage toggle for rotation, tactics, trades, free agency, scouting, the draft, finances, recruiting and other systems.
- Sortable, filterable tables and side-by-side comparison of players and teams.
- Undo for the last roster move, available until the next simulated game.
- League settings for games per season, playoff format, trade difficulty, injuries and progression speed. Game count and playoff format changes take effect the following season.

## Roster editor and packs

`/rosters/` edits any player, team, color or logo from a preset library. Packs are versioned JSON validated with `zod`, imported and exported locally, and stored in the browser. A new franchise or career copies the active pack into its save. Inside a franchise, the same editor changes only that save.

## Milestones

Each is pushed to `/beta/` as it works, with unfinished areas showing "Coming soon".

1. **Foundation:** create, save, load, export and import a pro franchise; hub shell; persistent league.
2. **Pro season:** `boxsim` and calibration, schedule, standings, stat leaders, playoffs, awards, play and sim controls.
3. **Coaching:** depth, rotations, tactics, matchups, practice, player plans, staff.
4. **Playbooks:** game AI, play calling, 4th-quarter and close-game modes.
5. **Offseason:** aging, progression, retirements, lottery, generated classes, scouting, the draft.
6. **Contracts and free agency:** cap rules, negotiation, bidding, waivers, buyouts, two-way and developmental deals.
7. **Trades:** valuation, multi-team deals, finder, block, deadline, draft-day trades, undo.
8. **Running the club:** finances, owner goals, firing and hiring, news, power rankings, history, Hall of Fame, Legends.
9. **Pro finish:** every auto-manage toggle, league settings, comparison tools, decades-long soak tests.
10. **College:** division world, recruiting battles, NIL, portal, eligibility, postseason.
11. **High school:** feeders, tryouts, squads, state playoffs.
12. **Roster editor and packs.**
13. **Phase finish:** full audit, performance, page check, docs and legal, then wait for the user's go-ahead to merge to `main`.

## Testing

- **Unit tests:** cap and trade legality, trade valuation, lottery odds, contract edge cases, schedule validity, progression bounds, recruiting, save round trips and migrations.
- **Calibration:** `boxsim` scoring and stat lines stay within set tolerances of real engine games.
- **Soak tests:** full franchises run for decades in each league on auto-manage, checking legal rosters, stable league talent, and no permanently broken teams.
- **Limits:** tests cap save size and speed. A pro season simulates in under a minute.
- **Browser tests:** Playwright covers create, sim, trade, save, reload and resume on both builds.
- **End of phase:** every page clicked through and 60 fps on the High preset.

## Failure handling

- An interrupted sim or failed save leaves the last complete state, because each day writes one transaction.
- A failed import changes nothing and explains why.
- A save from a newer version is refused with a clear message.

## Existing modes

Road to Legend, Quick Play and the park keep their current behavior and saves. Shared code moved for Franchise keeps its existing tests.

## Release

Each push updates `CHANGELOG.md`, the README, How to Play, Terms, Privacy, Credits and the sitemap as needed, bumps the version in `package.json`, runs `format:check`, and confirms the version live on `/beta/`.
