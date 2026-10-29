# Changelog

Every release of Basketball Legends is listed here, newest first. Each version's section doubles as its release notes on GitHub.

## v0.2.2 — October 29, 2026

### Saving

- **Resume game shows your save slots:** Resume game on the main menu now always lists the autosave (when there is one) and all three slots, with the score, the mode and where each game stands, so you can pick which game to resume or delete one. Empty slots are listed too. Before, a single save resumed right away, and the list only appeared as "Saved games" once you had two or more.

## v0.2.1 — October 29, 2026

Bigger, livelier parks, a real check up top, save slots and a new look for the logo.

### Play in the Park

- **Real worlds around every court:** each park is now built in Blender and runs all the way to the horizon.
  - **Copper Flats Courts:** a shade ramada with picnic tables, a second court, a playground, a parking lot, saguaros, palo verdes and boulders, with desert ranges in the distance.
  - **Ironside Cage:** brick walk-ups with stoops, fire escapes and water towers, an elevated train, a mural wall, parked cabs and a downtown skyline.
  - **Boardwalk Courts:** a boardwalk lined with stalls under striped awnings, rows of palms with string lights, a DJ booth, a lifeguard tower, animated ocean waves, and a pier with a Ferris wheel.
  - **Maple Street Park:** two-flats and bungalows with lit windows and porches, a corner store with a neon sign, street lamps, parked cars, bikes on the fence and big oaks.
  - **Rooftop on Ninth:** a lounge with couches, a bar, a DJ table and string lights hung from a steel pergola, planters, and a skyline of lit towers with the city's streets glowing below.
- **Crowds:** real 3D spectators (standing around, arms crossed, filming on their phones, leaning on the fence, sitting in bleachers and on porches) in their own clothes. They jump up cheering or clap on big plays. Boardwalk Courts has a packed showtime crowd, Ironside Cage is three deep against the fence, and the quieter parks have a few friends and neighbors watching.
- **Sound of the place:** surf at the beach, traffic and the odd horn in the city, crickets at night, wind and birds in the desert, and a crowd as loud as the park's.
- **Night looks like night:** the court lights carry the scene and windows glow, instead of everything being evenly lit.
- **No edge of the world:** the ground reaches past what any camera can see, the sky travels with the camera, and the far distance fades into the horizon, so no camera angle shows the end of the map. A new test checks every camera at every park.
- **Cameras stay out of the fences and the crowd:** a camera that would end up in the wire steps back and looks through it.
- **Checking it up:** the ball handler and their defender square up at the top of the key, the handler bounces it to the defender, the defender holds it a beat and bounces it back, and then it's live. Before, the ball just appeared in the handler's hands.

### Saving

- **Three save slots:** choose Save game in the pause menu and pick a slot, so a Quick Play game and a park game no longer overwrite each other. A game in a slot keeps saving itself there as you play.
- **Saved games on the main menu:** with more than one save, the main menu lists the autosave and every slot, with what's in it, to resume or delete.

### Look and settings

- **New logo:** a badge with BASKETBALL LEGENDS around a ring and the ball in the middle, now the app icon, browser tab icon, home screen icon and link preview.
- **Main menu title:** Basketball in white and Legends in amber over faint court lines (three-point arc, lane and free-throw circle). It follows the colorblind themes too.
- **Player lock is the default camera** for new players. If you've already picked a camera, nothing changes; it's under Settings, Camera.

## v0.2.0 — October 28, 2026

Play in the Park: pickup basketball on outdoor courts, from the main menu.

### Parks

- **Five original courts:** Copper Flats Courts in Phoenix (a desert park with a shade ramada, saguaros and mountains), Ironside Cage in New York (a fenced court between brick buildings at sunset), Boardwalk Courts in Los Angeles (a beach court with palms and the ocean at sunset), Maple Street Park in Chicago (a neighborhood blacktop under the lights) and Rooftop on Ninth in Kansas City (a court on a parking garage with the skyline lit up all around).
- **Outdoor courts:** worn asphalt with cracks and patches, or painted sport surfaces; chain-link fences; light poles that come on at night; poles with steel or acrylic backboards and chain or nylon nets; daylight, sunset and night skies with shadows to match.
- **Park regulars:** each park has 18 regulars with nicknames, reputations ("Never misses from the corner", "Calls next every game") and street clothes, the same people every time you show up. Some parks are friendly runs, others are high-level. Older regulars have lost a step but know every trick.
- **Anyone can play:** pick your player and every spot from the park's regulars or from any team in the three leagues, or shuffle the regulars.

### Pickup rules

- **1-on-1 up to 5-on-5**, on a half court or a full court.
- **Scoring:** 1s and 2s or 2s and 3s, games to 11, 15 or 21, win by 2 (or not).
- **Make it, take it** or losers' ball after every basket.
- **Check ball:** half court, the ball is checked at the top of the key after every basket, foul and turnover.
- **Take it back:** half court, after a miss, a steal or a rebound, the ball has to go back past the arc before you can score. A basket that wasn't taken back doesn't count.
- **Call your own fouls:** no referees and no free throws. The fouled player checks it back up, a charge goes the other way, and nobody fouls out.
- **No clock:** no game clock, shot clock or timeouts. The AI still moves the ball and looks for its shot.
- **Street sounds:** no whistles, buzzers or announcer, and a few onlookers instead of an arena crowd.

### More ways to play

- **Next game up:** your crew calls next against the crew holding the court, with up to four crews waiting. Winners stay on, losers go to the back of the line, and the games ahead of you are played out while you wait. The line tracks your winning streak and every result.
- **21:** three to six players, each on their own: whoever has the ball plays against everyone else. Score and you shoot free throws until you miss (make three and you check it again). Hit the target exactly: go over and you drop back to 13.
- **HORSE:** against up to three regulars. Make a shot and everyone has to match it from the same spot, or take a letter. Play HORSE or PIG.
- **3-point contest:** 25 balls on five racks in 60 seconds, with a gold money ball worth 2 on every rack, against up to five rivals.

## v0.1.1 — October 28, 2026

A patch for shooting and the main menu.

### Shooting

- **Perfect releases go in:** a green release now goes in about 97% of the time for any shooter, and still about 85% with a hand in your face. Before, the meter's green band and the game's green window didn't match, so many releases that showed "Perfect release" were scored as merely good. Even a true green on a contested three only went in about half the time.
- **Fairer green windows:** the window is wider (about 15 ms either side of perfect for poor shooters, 22 ms for average and 40 ms for great ones), and the green band on the meter is drawn at exactly that size, so a better shooter visibly gets a bigger target.
- **Smoother meter:** the bar now updates every frame while you hold the shot instead of 20 times a second, so where you see it is where it really is.

### Main menu

- **Same spacing on every screen:** the menu no longer squeezes together in short windows; if it doesn't fit, it scrolls, and the arena backdrop stays fixed behind it.
- **Only the menu scrolls on wide screens:** the title, the info card and the footer links stay in place while the menu column scrolls, with soft fades at its top and bottom edges.

## v0.1.0 — October 28, 2026

The first public version: a full 5v5 basketball game in the browser. You can play any pro, college or Arizona high school team in Quick Play, practice, or learn the controls in the tutorial. Career, Franchise and online play come in later versions.

### Leagues and teams

- **Three leagues, 1,405 teams:** the Pro Basketball League (30 cities), National Collegiate Hoops (1,092 programs in D-I, D-II and D-III across 100 conferences), and Arizona Prep Hoops (283 high schools, 6A through 1A, using the 2026–28 region alignment).
- Real city, school and university names identify places. Every nickname, logo, color scheme, conference, arena and player is original and fictional.
- The Brophy Prep Broncos appear in their real red and white with the school's official logo on the court, the jerseys and the menus.
- Full generated rosters with ratings, positions, heights and bench depth for every team.

### Gameplay

- **Real-time 3D 5v5** with dribble moves, a timing-based shot meter, layups, dunks, floaters, hooks, stepback fadeaways, post moves, pump fakes, alley-oops, steals, blocks and box-out rebounding.
- **Full rules for each league:** shot clocks, personal and hand-check fouls, the bonus, free throws, inbounds, traveling, three seconds, backcourt and 8/10-second violations, goaltending, timeouts, substitutions, fatigue and overtime.
- **Team AI** that spaces the floor, runs pick-and-roll, drives and kicks, posts up and cuts, and plays man or zone defense with help rotations.
- **Coaching tactics:** pace, three-point emphasis, offensive rebounding, double teams, and man-to-man, 2-3 zone, 3-2 zone or a full-court trapping press. Set them before the game or from the pause menu.
- **Gameplay sliders:** shot, three-point and layup success, pass accuracy, steals, blocks, fouls, game speed, injuries and CPU aggression.
- **Injuries (optional):** falls, hard drives and awkward landings can hurt players, with forced substitutions and estimates of games missed.
- Stat tuning per league so pro, college and high school box scores look like the real thing.

### Modes

- **Quick Play:** any two teams from any league (cross-league exhibitions included), instant simulation, and up to four local players on keyboard and gamepads.
- **Tutorial:** a ten-step guided session (moving, sprinting, dribble moves, shot timing, layups, threes, passing, pump fakes, replays) that checks off each skill as you do it, using your own bindings, and keeps your progress through pauses.
- **Practice:** a shootaround with no clock and no defense, with live shooting stats.
- **Resume game:** games save automatically every few seconds. Close the tab or choose Save and quit, then pick Resume game on the main menu to continue exactly where you left off.

### Venues

- **Seven venues built in Blender:** three high school gyms (small, classic and modern, with wooden or plastic bleachers, girders or open-web joists, and a stage with curtains in the oldest ones), a college fieldhouse with an arched brick-and-steel roof, a two-deck campus arena, and two pro arenas with a suites ring, a club level and a halo video board.
- Each team's home is picked from its capacity and dressed in its colors: seats in team sections, painted walls and pads, LED ribbons, wordmarks, wall logos, live scoreboards, and championship and retired-number banners that match the program's history.
- Solid hoop bases, and rims that shake on hard hits by hinging at the backboard.

### Presentation

- Broadcast HUD, six cameras (including a courtside low camera), and commentary with optional voice.
- **Instant replays and highlights:** replay any moment with scrubbing, slow motion and five replay cameras. Big plays replay automatically (setting: after baskets, all big plays, or off), and a highlight reel is ready at every break and after the game.
- **Officials:** a three-person crew works every game. They toss the opening jump ball, take lead, trail and center positions that rotate on every change of possession, blow whistles with real signals, show the five-second count, and hand the ball to inbounders and free-throw shooters. The scorer's table crew sits courtside.
- **Game flow:** quarter, halftime and timeout screens with line scores, team stats and leaders; team huddles; benches full of players who react to big plays; name tags; big-play banners (AND ONE, REJECTED, runs, buzzer beaters); broadcast stat cards for hot scorers and free-throw shooters.
- **Crowd:** a synthesized home crowd with arena reverb that murmurs, roars, applauds, oohs, awws, boos and chants DE-FENSE, reacts differently to home and away plays, and jumps up with arms raised on big plays.
- **Sound:** every sound is generated by the game, including footsteps on real foot contacts, sneaker squeaks on hard cuts, and one dribble sound per bounce.
- **Animation:** running with knee drive and arm pump, defensive slides that never cross the feet, natural falls, winded hands-on-knees, catches, steal lunges, chinned post-ups, and one-handed dribbling on the correct side.
- Cameras never clip through a venue's walls, seats or roof.

### Menus, settings and accessibility

- Main menu with keyboard and gamepad navigation; menu games use the last-used controller.
- Loading screens with real progress and gameplay tips that use your own key bindings.
- Graphics presets with auto-detect, full key and button remapping, colorblind modes, subtitles, reduced motion, UI scale and tap-to-shoot.
- How to Play, Credits, Terms of Service, Privacy Policy and this changelog. The version number in the main menu footer links here.

### Works anywhere

- Runs in any modern browser with no download or account.
- **Offline play:** after one visit the whole game is cached and playable without a connection, and it can be installed as an app.
- Settings and saved games stay in your browser. No accounts, ads, analytics or cookies.
- **The beta:** legends.carterscoding.com/beta/ runs the next version while it's being tested. A card on its main menu explains that it shares saves with the main game and links back to the main game. It has its own offline copy and is kept out of search results.

### Under the hood

- Static Next.js site on GitHub Pages at legends.carterscoding.com, open source under the MIT License. The `main` branch is the live game and the `prerelease` branch is the beta; one workflow builds, tests and publishes both.
- Every deploy typechecks, lints, checks formatting with Prettier, and runs the unit tests (rules, injuries, saves, input, deterministic save and resume), a camera sweep that flies every camera through every venue and fails if any clip, and browser smoke tests for every page.
