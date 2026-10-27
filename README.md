# Basketball Legends

A free, open-source 3D basketball game that runs in the browser. Play pro basketball, 1,092 college programs, or every Arizona high school, then build a career from freshman year to the Hall of Fame or run a franchise.

**Play it:** https://legends.carterscoding.com

## What's in the game

- **Real-time 3D 5v5** with dribble moves, a timing-based shot meter, layups, dunks, floaters, post moves, alley-oops, steals, blocks and box-out rebounding.
- **Full rules for each league:** shot clocks, fouls and the bonus, free throws, inbounds, traveling, three seconds, backcourt and 8/10-second violations, goaltending, timeouts, substitutions, fatigue and overtime.
- **Coaching:** set each team's pace, three-point emphasis, offensive rebounding, double teams and defense (man-to-man, 2-3 zone, 3-2 zone or a full-court trapping press) before the game or from the pause menu.
- **Gameplay sliders:** shot, three-point and layup success, pass accuracy, steals, blocks, fouls, game speed, injuries and CPU aggression.
- **Team AI** that spaces the floor, runs pick-and-roll, drives and kicks, posts up, cuts, and plays man or zone defense with help rotations.
- **Quick Play:** any two teams from any league (cross-league exhibitions included), instant simulation, and up to four local players with keyboard and gamepads.
- **Practice:** a shootaround with no clock or defense.
- **Presentation:** broadcast HUD, six cameras, commentary with optional voice, a crowd that reacts to the game, and synthesized sound.
- **Instant replays and highlights:** replay any moment with scrubbing, slow motion and five replay cameras; big plays replay automatically, and a highlight reel is ready at every break and after the game.
- **Officials:** a three-person crew works every game: the opening jump-ball toss, lead/trail/center floor positions that rotate on every change of possession, whistles with real signals (fouls, charges and blocks, traveling, three seconds, shot clock, goaltending, out of bounds, timeouts, substitutions, three-point attempts and makes), the visible five-second count, and handing the ball to inbounders and free-throw shooters. The scorer's table crew sits courtside.
- **Game flow:** quarter, halftime and timeout screens with line scores, team stats and leaders; team huddles; benches full of players who react to big plays; name tags; big-play banners (AND ONE, REJECTED, runs, buzzer beaters).
- **Injuries (optional):** falls, hard drives and awkward landings can hurt players, with forced substitutions and games-missed estimates.
- **Never lose a game:** games in progress save automatically every few seconds; close the tab or choose Save and quit, then pick Resume game on the main menu to continue exactly where you left off.
- **Loading screens** show real progress and gameplay tips that use your own key bindings.
- **Works offline:** after one visit the whole game is cached and playable without a connection, and it can be installed as an app.
- **Settings for everyone:** graphics presets with auto-detect, full key and button remapping, colorblind modes, subtitles, reduced motion, UI scale and tap-to-shoot.

Career mode, Franchise mode, roster editing, accounts and online play are in development.

## Leagues and teams

| League | In the game as | Teams |
| --- | --- | --- |
| Pro | Pro Basketball League | 30 cities |
| College | National Collegiate Hoops | 1,092 programs in D-I, D-II and D-III across 100 conferences |
| Arizona high school | Arizona Prep Hoops | 283 schools, 6A through 1A, using the 2026–28 region alignment |

Real city, school and university names are used only to identify places. Every nickname, logo, color scheme, conference name, arena and player is original and fictional, with one exception: Brophy College Preparatory appears as the Brophy Prep Broncos in its red and white colors. Basketball Legends is not affiliated with the NBA, the NCAA, the AIA, or any team or school.

## Development

Requires Node 22+.

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # engine and simulation tests
npm run build        # static export to out/ (also regenerates sitemap.xml)
```

Useful scripts:

- `npm run data` rebuilds league data in `src/data/generated/` from the factual lists in `scripts/raw/`.
- `npm run assets:player` rebuilds the rigged player model with Blender 4.2+ (`blender` on your PATH) and compresses it.
- `npx tsx scripts/dev/headless-game.ts 10 pro` simulates full games headlessly and prints league-wide stats, which is useful for tuning (`college` and `hs` work too).
- `npx tsx scripts/dev/injury-rate.ts 30 pro` measures how often in-game injuries happen.
- `npx tsx scripts/dev/defense-compare.ts 6 pro` compares the defensive schemes; `npx tsx scripts/dev/shot-mix.ts 4 pro` shows the shot type mix.
- `npm run lint` runs ESLint (also part of the deploy workflow).
- `/dev/anim` (dev server only) is an animation lab: every procedural clip with a timeline, contact sheets (`?sheet=1`) and a side view (`&profile=1`).

`npm run build` also stamps `out/sw.js` (the offline service worker) with a build version and the list of hashed assets to precache.

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

Pushing to `main` runs `.github/workflows/deploy.yml`, which typechecks, tests, builds and publishes `out/` to GitHub Pages. The custom domain comes from `public/CNAME`.

## Credits and license

Code: [MIT](LICENSE). Character base mesh: [MakeHuman](https://github.com/makehumancommunity/makehuman), CC0. See [CREDITS.md](CREDITS.md) for everything else.
