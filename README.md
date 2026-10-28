# Basketball Legends

A free, open-source 3D basketball game that runs in the browser. Play pro basketball, 1,092 college programs, or every Arizona high school, then build a career from freshman year to the Hall of Fame or run a franchise.

**Play it:** https://legends.carterscoding.com

## What's in the game

- **Real-time 3D 5v5** with dribble moves, a timing-based shot meter, layups, dunks, floaters, post moves, alley-oops, steals, blocks and box-out rebounding.
- **Full rules for each league:** shot clocks, fouls and the bonus, free throws, inbounds, traveling, three seconds, backcourt and 8/10-second violations, goaltending, timeouts, substitutions, fatigue and overtime.
- **Tested:** unit tests for the engine (rules, injuries, saves, input), a camera sweep that flies every camera through every venue's real geometry and fails if one clips anything, and browser smoke tests for every page and the main game flows run on every deploy.
- **Coaching:** set each team's pace, three-point emphasis, offensive rebounding, double teams and defense (man-to-man, 2-3 zone, 3-2 zone or a full-court trapping press) before the game or from the pause menu.
- **Gameplay sliders:** shot, three-point and layup success, pass accuracy, steals, blocks, fouls, game speed, injuries and CPU aggression.
- **Team AI** that spaces the floor, runs pick-and-roll, drives and kicks, posts up, cuts, and plays man or zone defense with help rotations.
- **Quick Play:** any two teams from any league (cross-league exhibitions included), instant simulation, and up to four local players with keyboard and gamepads.
- **Tutorial:** a ten-step guided session (moving, sprinting, dribble moves, shot timing, layups, threes, passing, pump fakes, replays) that checks off each skill as you do it, using your own key and button bindings.
- **Practice:** a shootaround with no clock or defense.
- **Venues built in Blender:** three small, classic and modern high school gyms (wooden or plastic bleachers, girders or open-web joists, a stage with curtains in the oldest gyms), a college fieldhouse with an arched brick-and-steel roof, a two-deck campus arena, and two pro arenas (suites ring, club level, halo video board). Each team's home is picked from its capacity and dressed in its colors: seats in team sections, painted walls and pads, LED ribbons, wordmarks, wall logos, live scoreboards, and championship and retired-number banners that match the program's history.
- **Presentation:** broadcast HUD, six cameras, commentary with optional voice, broadcast stat cards for hot scorers and free-throw shooters, a home crowd that cheers, groans, boos and chants (and jumps out of its seats on big plays), and fully synthesized sound with footsteps and squeaks matched to the animation.
- **Instant replays and highlights:** replay any moment with scrubbing, slow motion and five replay cameras; big plays replay automatically, and a highlight reel is ready at every break and after the game.
- **Officials:** a three-person crew works every game: the opening jump-ball toss, lead/trail/center floor positions that rotate on every change of possession, whistles with real signals (fouls, charges and blocks, traveling, three seconds, shot clock, goaltending, out of bounds, timeouts, substitutions, three-point attempts and makes), the visible five-second count, and handing the ball to inbounders and free-throw shooters. The scorer's table crew sits courtside.
- **Game flow:** quarter, halftime and timeout screens with line scores, team stats and leaders; team huddles; benches full of players who react to big plays; name tags; big-play banners (AND ONE, REJECTED, runs, buzzer beaters).
- **Injuries (optional):** falls, hard drives and awkward landings can hurt players, with forced substitutions and games-missed estimates.
- **Never lose a game:** games in progress save automatically every few seconds; close the tab or choose Save and quit, then pick Resume game on the main menu to continue exactly where you left off.
- **Loading screens** show real progress and gameplay tips that use your own key bindings.
- **Works offline:** after one visit the whole game is cached and playable without a connection, and it can be installed as an app.
- **Settings for everyone:** graphics presets with auto-detect, full key and button remapping, colorblind modes, subtitles, reduced motion, UI scale and tap-to-shoot.

Career mode is being built in the beta. Create a player (name, Arizona hometown and school, position, archetype, body with rating caps, look with a live 3D preview, starting skills) and play four high school seasons. Each one has tryouts that place you on FR/SO, JV or varsity, mid-season call-ups, full schedules for all 283 schools, played or simulated games, a bench prompt, AIA-style state playoffs with an Open Division, natural development and skill points, season honors, grades and academic eligibility, summer camps, AAU showcases, and star ratings with national and state rankings. Several careers save in the browser with autosave and export/import as `.blcareer` files. Franchise mode, roster editing, accounts and online play are in development.

Want to try what's coming next? The beta at https://legends.carterscoding.com/beta/ runs the version in testing. It shares saves with the main game, so a bug there can affect them.

Release notes for every version are in [CHANGELOG.md](CHANGELOG.md), also shown in the game at [/changelog](https://legends.carterscoding.com/changelog/) (the version number in the main menu footer links there).

## Leagues and teams

| League              | In the game as            | Teams                                                          |
| ------------------- | ------------------------- | -------------------------------------------------------------- |
| Pro                 | Pro Basketball League     | 30 cities                                                      |
| College             | National Collegiate Hoops | 1,092 programs in D-I, D-II and D-III across 100 conferences   |
| Arizona high school | Arizona Prep Hoops        | 283 schools, 6A through 1A, using the 2026–28 region alignment |

Real city, school and university names are used only to identify places. Every nickname, logo, color scheme, conference name, arena and player is original and fictional, with one exception: Brophy College Preparatory appears as the Brophy Prep Broncos in its red and white colors. Basketball Legends is not affiliated with the NBA, the NCAA, the AIA, or any team or school.

## Development

Requires Node 22+.

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # engine, simulation and camera-collision tests
npm run test:e2e     # browser smoke tests against the production build (run `npm run build` first; uses your installed Chrome)
                     # CI runs the page tests only; the full-game @gpu flows need a GPU and run locally
npm run build        # static export to out/ (also regenerates sitemap.xml)
```

Useful scripts:

- `npm run data` rebuilds league data in `src/data/generated/` from the factual lists in `scripts/raw/`.
- `npm run assets:arenas` rebuilds every venue from `src/game3d/arena/variants.json` with Blender (`scripts/blender/build_arenas.py`) and compresses them into `public/models/arenas/`.
- `npm run assets:player` rebuilds the rigged player model with Blender 4.2+ (`blender` on your PATH) and compresses it.
- `npx tsx scripts/dev/headless-game.ts 10 pro` simulates full games headlessly and prints league-wide stats, which is useful for tuning (`college` and `hs` work too).
- `npx tsx scripts/dev/injury-rate.ts 30 pro` measures how often in-game injuries happen.
- `npx tsx scripts/dev/defense-compare.ts 6 pro` compares the defensive schemes; `npx tsx scripts/dev/shot-mix.ts 4 pro` shows the shot type mix.
- `npm run lint` runs ESLint (also part of the deploy workflow).
- `npm run format` formats the code with Prettier; `npm run format:check` (part of the deploy workflow) fails on unformatted files.
- `/dev/venues` (dev server only) previews every venue dressed for any team from the game's camera spots.
- `/dev/anim` (dev server only) is an animation lab: every procedural clip with a timeline, contact sheets (`?sheet=1`) and a side view (`&profile=1`).

`npm run build` also stamps `out/sw.js` (the offline service worker) with a build version and the list of hashed assets and models to precache.

### Project layout

```
src/app/        pages (static export for GitHub Pages)
src/engine/     players, ratings, generation, rules
src/game/       match simulation, ball physics, AI, input, commentary
src/game3d/     three.js / React Three Fiber scene, characters, arena
src/ui/         HUD, menus, shared components
src/data/       generated league data
scripts/        data builders, Blender build scripts, sitemap, icons
```

### Deploying

The site has two builds on one GitHub Pages site:

| Branch       | URL                                     | What it is                               |
| ------------ | --------------------------------------- | ---------------------------------------- |
| `main`       | https://legends.carterscoding.com/      | the live game                            |
| `prerelease` | https://legends.carterscoding.com/beta/ | the beta: the next version, being tested |

Pushing to either branch runs `.github/workflows/deploy.yml`. It checks out both branches, typechecks, lints, tests and builds each one (the beta with `BL_CHANNEL=beta`), runs the browser smoke tests against both, and publishes them together. If the beta fails on a push to `main`, the live game still deploys, together with the last beta that passed. If the beta fails on a push to `prerelease`, nothing deploys. The custom domain comes from `public/CNAME`.

`BL_CHANNEL=beta npm run build` builds the beta locally. It sets Next.js's `basePath` to `/beta`, so file paths go through `asset()` in `src/lib/site.ts`. It also shows a warning card on the main menu (the beta shares the browser's saves with the live game), tells search engines not to index the beta, renames the web app manifest, and gives the beta its own service worker, scoped to `/beta/`, with its own `bl-beta-*` caches. The live service worker ignores `/beta/`, and `robots.txt` disallows it. To run the smoke tests against a beta build, copy `out/` into `.e2e-beta/beta/` and run `E2E_BASE=/beta E2E_SERVE_DIR=.e2e-beta npm run test:e2e`.

Releasing a version: bump `version` in `package.json` (MAJOR.MINOR.PATCH; the main menu footer reads it at build time), add a section at the top of `CHANGELOG.md`, and paste that section into the GitHub release notes.

## Credits and license

Code: [MIT](LICENSE). Character base mesh: [MakeHuman](https://github.com/makehumancommunity/makehuman), CC0. See [CREDITS.md](CREDITS.md) for everything else.
