import type { Metadata } from "next";
import { H2, H3, ProsePage } from "@/ui/Prose";

export const metadata: Metadata = {
  title: "How to play",
  description: "Controls, shot timing, dribble moves, defense and league rules in Basketball Legends.",
};

const row = (action: string, keys: string, pad: string) => (
  <tr key={action} className="border-t border-line/60">
    <td className="py-2 pr-4">{action}</td>
    <td className="pr-4">
      <kbd className="rounded border border-line bg-deck px-1.5 py-0.5 text-sm">{keys}</kbd>
    </td>
    <td>
      <kbd className="rounded border border-line bg-deck px-1.5 py-0.5 text-sm">{pad}</kbd>
    </td>
  </tr>
);

export default function HowToPlay() {
  return (
    <ProsePage title="How to play">
      <p>
        Basketball Legends plays like a broadcast basketball game: you control one player at a time, and the rest of your team runs plays around you. You can
        change every binding in Settings, and a controller works as soon as you press a button.
      </p>
      <p>
        New to the game? Choose <b>Practice and Tutorial</b> on the main menu, then <b>Start the tutorial</b>, for a guided session that checks off each basic
        move as you do it.
      </p>
      <p>
        On a phone or tablet, you&apos;ll need a controller or a keyboard to play: there are no touch controls. Menus, your career hub and simming games all
        work by touch.
      </p>
      <H2>Offense</H2>
      <table className="w-full text-left">
        <thead className="text-sm text-steel">
          <tr>
            <th className="py-2">Action</th>
            <th>Keyboard</th>
            <th>Controller</th>
          </tr>
        </thead>
        <tbody>
          {row("Move", "W A S D", "Left stick")}
          {row("Sprint", "Shift", "RT / R2")}
          {row("Shoot (hold, then release)", "Space or J", "X / □")}
          {row("Pass to the teammate you point at", "K", "A / ✕")}
          {row("Icon pass to a specific teammate", "Tab + 1-5", "LB + face button")}
          {row("Lob or alley-oop", "L", "Y / △")}
          {row("Bounce pass", "O", "B / ○")}
          {row("Crossover", "← / →", "Right stick left/right")}
          {row("Stepback (hold Shift: hesitation)", "↓", "Right stick down")}
          {row("Spin move", "↑", "Right stick up")}
          {row("Pump fake", "U", "Right stick click")}
          {row("Post up (hold)", "C", "LT / L2")}
          {row("Call pick and roll", "V", "RB / R1")}
          {row("Call for the ball (off the ball)", "K", "A / ✕")}
        </tbody>
      </table>
      <H2>The shot meter</H2>
      <ul className="list-disc pl-6">
        <li>
          <b>Shooting:</b> hold the shoot button to rise, and release at the top of your jump.
        </li>
        <li>
          <b>The green band:</b> this is the ideal release. Its size on the meter is its real size, and better shooters get a wider one.
        </li>
        <li>
          <b>Timing:</b> a perfect release goes in nearly every time, slightly early or late barely hurts, and badly mistimed is far less likely to fall.
        </li>
        <li>
          <b>Options:</b> turn the meter off in Settings for rating-based shooting, or choose tap-to-shoot under Accessibility.
        </li>
      </ul>
      <H3>Good shots and bad shots</H3>
      <ul className="list-disc pl-6">
        <li>Open catch-and-shoot threes and shots at the rim are the most efficient.</li>
        <li>Contested shots, shots off a hard dribble and shots when you&apos;re tired are harder.</li>
        <li>A pump fake out of a dribble ends your dribble: pivot, pass or shoot, because walking more than a step is traveling.</li>
        <li>Careless ball handlers can get called for an extra step on drives.</li>
      </ul>
      <H2>Defense</H2>
      <table className="w-full text-left">
        <thead className="text-sm text-steel">
          <tr>
            <th className="py-2">Action</th>
            <th>Keyboard</th>
            <th>Controller</th>
          </tr>
        </thead>
        <tbody>
          {row("Steal", "K", "X / □")}
          {row("Block, contest or rebound", "Space or J", "Y / △")}
          {row("Intense defense stance (hold)", "C", "LT / L2")}
          {row("Switch to the defender nearest the ball", "Q", "A / ✕")}
          {row("Take a charge", "F", "B / ○")}
        </tbody>
      </table>
      <ul className="list-disc pl-6">
        <li>Stay between your man and the basket.</li>
        <li>Reaching for steals from behind or from too far away risks a foul.</li>
        <li>Jump at the right moment to block: too early and the shooter waits you out.</li>
        <li>A pump fake can get an eager defender off his feet.</li>
      </ul>
      <H2>Coaching and tactics</H2>
      <p>
        Set these before a Quick Play game, or any time from Tactics in the pause menu: pace, how much you hunt threes, how hard you crash the glass, doubling
        the other team&apos;s best scorer, and your defense.
      </p>
      <ul className="list-disc pl-6">
        <li>
          <b>Man-to-man:</b> every defender takes a man. The best all-around choice.
        </li>
        <li>
          <b>2-3 zone:</b> packs the paint, so drives and post-ups get much harder, but it gives up more threes and offensive rebounds.
        </li>
        <li>
          <b>3-2 zone:</b> takes away the perimeter; drives and the short corner open up.
        </li>
        <li>
          <b>Full-court press:</b> picks up the ball in the backcourt and traps before half court. More steals and turnovers, but a broken press gives up easy
          baskets.
        </li>
      </ul>
      <p>Gameplay sliders in Settings change the balance of the whole game (shooting, steals, blocks, fouls, speed and more).</p>
      <H2>Game controls</H2>
      <ul className="list-disc pl-6">
        <li>
          <b>Pause:</b> Esc or Menu. From there: box score, play-by-play, substitutions, timeouts, cameras, sim to end or restart.
        </li>
        <li>
          <b>Timeout:</b> T, when your team has the ball.
        </li>
        <li>
          <b>Camera:</b> Y cycles through the cameras.
        </li>
      </ul>
      <H2>Road to Legend</H2>
      <p>
        Every career chases one thing: becoming a Basketball Legend. Very few get there. Play each game in 3D, controlling only your player, or sim from your
        career hub.
      </p>
      <H3>Creating your player</H3>
      <ul className="list-disc pl-6">
        <li>
          <b>Where you start:</b> high school, college or the pros. Starting later is quicker, but leaves less time to build a legacy.
        </li>
        <li>
          <b>Play style badges:</b> pick up to two. Each lifts two skills and how high they can grow.
        </li>
        <li>
          <b>School:</b> pick one or let the game assign one from your hometown.
        </li>
      </ul>
      <H3>Your career hub</H3>
      <ul className="list-disc pl-6">
        <li>
          <b>Next up:</b> play your next game, sim it, or use Sim to next event to run until something needs you.
        </li>
        <li>
          <b>Schedule:</b> a list or a month-by-month calendar.
        </li>
        <li>
          <b>Stats:</b> season averages, honors and charts of your career.
        </li>
        <li>
          <b>Legends:</b> the Hall of Legends, your rival, goals and milestones, and your scrapbook.
        </li>
      </ul>
      <H3>The Legend rank</H3>
      <ul className="list-disc pl-6">
        <li>
          <b>Ranks:</b> Local Hero, State Star, National Name, Pro, All-Star, Superstar, Icon, Legend.
        </li>
        <li>
          <b>Legend points:</b> honors and records (Greatness), titles (Winning), big games you played yourself (Moments) and community work (Impact).
        </li>
        <li>
          <b>Becoming a Legend:</b> decided only at retirement, for an Icon with 2,400 points. Once you&apos;re an Icon, the game shows your chances.
        </li>
      </ul>
      <H3>High school</H3>
      <ul className="list-disc pl-6">
        <li>
          <b>Tryouts:</b> November drills help place you on freshman/sophomore, JV or varsity. Play well and you&apos;re called up; struggle and you may be sent
          down.
        </li>
        <li>
          <b>The bench:</b> when the coach sits you, watch, fast-forward until you check back in, or sim to the end.
        </li>
        <li>
          <b>Growth:</b> ratings rise on their own, and skill points from XP push the skills you choose, up to the caps your body allows.
        </li>
        <li>
          <b>Grades:</b> finals are a short timed exam, and a fall GPA under 2.0 sits you for the rest of the season.
        </li>
        <li>
          <b>Summers:</b> a camp of your choice and AAU showcase games raise your exposure and your ranking.
        </li>
      </ul>
      <H3>Recruiting</H3>
      <ul className="list-disc pl-6">
        <li>Programs start recruiting you on June 15 after sophomore year.</li>
        <li>The Recruiting tab shows interest, offers and the role each coach pitches.</li>
        <li>Take up to five official visits, then commit or decommit. Division I needs a 2.3 core GPA.</li>
        <li>Before you graduate, sign with an offer or walk on somewhere.</li>
      </ul>
      <H3>College</H3>
      <ul className="list-disc pl-6">
        <li>
          <b>Coach trust:</b> it decides your role and minutes. Beat what the coach expects and both grow.
        </li>
        <li>
          <b>The season:</b> non-conference games, conference play and your conference tournament, then the National Tournament or National Invitational if you
          earn it.
        </li>
        <li>
          <b>Off the court:</b> NIL deals pay you, and you can redshirt once.
        </li>
        <li>
          <b>After each season:</b> come back, enter the transfer portal or declare for the draft.
        </li>
      </ul>
      <H3>The draft</H3>
      <ul className="list-disc pl-6">
        <li>Choose an agent, then the combine, team workouts and GM interviews all move your draft stock.</li>
        <li>Draft night is two rounds. If nobody calls, a two-way deal or the development league is your way in.</li>
      </ul>
      <H3>The pros</H3>
      <ul className="list-disc pl-6">
        <li>
          <b>Each year:</b> pick a training focus, earn your minutes and chase the playoffs. Great seasons earn badges and an All-Star spot.
        </li>
        <li>
          <b>Contracts:</b> when your deal ends, weigh offers in free agency. Ask for more, but they may walk away.
        </li>
        <li>
          <b>Trades:</b> ask for one before the deadline, but your coach and teammates will notice.
        </li>
        <li>
          <b>All-Star weekend:</b> if you&apos;re voted in, play the All-Star Game. Top shooters can also play the 3-point contest.
        </li>
        <li>
          <b>Practice drills:</b> run them before training camp. A sharp session makes the summer&apos;s work go further.
        </li>
        <li>
          <b>Two-way deals:</b> mostly development league games, with some games on the league roster.
        </li>
      </ul>
      <H3>Your story</H3>
      <ul className="list-disc pl-6">
        <li>
          <b>Press and decisions:</b> answers appear at the top of your hub. They shape your personality and how fans, media, teammates and coaches see you.
        </li>
        <li>
          <b>Why it matters:</b> coaches and teammates affect your minutes and chemistry, fans bring endorsements, and the media moves your draft stock.
        </li>
        <li>
          <b>Phone tab:</b> texts from family and your mentor, your social feed and your reputation.
        </li>
        <li>
          <b>Your rival:</b> rival games are flagged, and the Legends tab keeps your head-to-head record.
        </li>
        <li>
          <b>How often:</b> change how many story moments you get in Settings.
        </li>
      </ul>
      <H3>The park</H3>
      <ul className="list-disc pl-6">
        <li>
          <b>Runs:</b> the Park tab gives you three pickup runs every off-season. They earn street reputation and XP.
        </li>
        <li>
          <b>New parks:</b> reputation opens tougher parks, which pay more. Once a career earns a park, it&apos;s also open in Play in the Park on the main
          menu.
        </li>
        <li>
          <b>Surprises:</b> known pros sometimes drop in, and your rival may call you out to one-on-one.
        </li>
      </ul>
      <H3>Retirement</H3>
      <p>From age 30 you can hang it up. Jerseys are retired where you earned it, the Hall of Fame votes, you give your speech, and the verdict comes in.</p>
      <H3>Legend rewards</H3>
      <ul className="list-disc pl-6">
        <li>A Legend&apos;s name goes on the hometown courts in Play in the Park.</li>
        <li>Play as your Legend at their peak in Quick Play and the park.</li>
        <li>Start a new career as your Legend&apos;s kid, from the Road to Legend screen.</li>
      </ul>
      <H2>Saving and resuming</H2>
      <ul className="list-disc pl-6">
        <li>
          <b>Autosave:</b> games save every few seconds. Pick up from Resume game on the main menu.
        </li>
        <li>
          <b>Save slots:</b> choose Save game in the pause menu. Quick Play and the park share three slots, and Road to Legend has three of its own. A game in a
          slot keeps saving itself there.
        </li>
        <li>
          <b>Resume game:</b> lists the autosave and every slot to resume or delete. Your career hub picks up a saved career game too. Games resume paused.
        </li>
        <li>
          <b>When saves go:</b> finishing a game clears its save, and quitting a game that isn&apos;t in a slot discards it.
        </li>
      </ul>
      <H2>Replays and highlights</H2>
      <ul className="list-disc pl-6">
        <li>
          <b>Replay:</b> R or the left stick click replays the last few seconds. R or Esc goes back to the game.
        </li>
        <li>
          <b>In a replay:</b> Space plays and pauses, arrow keys scrub and change speed, and Y switches cameras.
        </li>
        <li>
          <b>Big baskets:</b> dunks, threes, and-ones and clutch shots replay in slow motion after the ball goes through. Space skips one.
        </li>
        <li>
          <b>Highlights:</b> blocks, steals and ankle breakers are saved to watch from the pause menu, at breaks and after the game.
        </li>
        <li>
          <b>Settings:</b> under Presentation, replay every big play or turn automatic replays off.
        </li>
      </ul>
      <H2>Breaks, timeouts and injuries</H2>
      <ul className="list-disc pl-6">
        <li>At quarter ends, halftime and timeouts, a panel shows the line score, stats, leaders and injuries.</li>
        <li>Make substitutions there, watch highlights or press Continue.</li>
        <li>CPU vs CPU games continue on their own after ten seconds.</li>
        <li>With injuries on, falls, collisions and awkward landings can hurt a player. Play stops at the next safe moment and a substitute comes in.</li>
        <li>Players with higher durability get hurt less often and recover sooner.</li>
      </ul>
      <H2>Officials</H2>
      <p>Three referees work every game. Watch them for the call:</p>
      <ul className="list-disc pl-6">
        <li>Raised fist: foul</li>
        <li>Rolling forearms: traveling</li>
        <li>Hand behind the head: charge</li>
        <li>Hands on hips: blocking foul</li>
        <li>A T: timeout</li>
        <li>Pointed arm: which way the ball is going</li>
        <li>One arm up: three-point try. Both arms up: it went in.</li>
      </ul>
      <H2>Venues</H2>
      <ul className="list-disc pl-6">
        <li>High schools play in small, classic or modern gyms depending on their size.</li>
        <li>Colleges play in a fieldhouse or a campus arena, and pro teams in one of two big arenas.</li>
        <li>Seats, walls, banners and scoreboards wear the home team&apos;s colors and history.</li>
        <li>In Quick Play, the Venue option moves any game to a different building.</li>
      </ul>
      <H2>Play in the Park</H2>
      <p>
        Pickup games at five outdoor courts, against each park&apos;s regulars. Two are open from the start, and street reputation in Road to Legend opens the
        rest. There&apos;s no clock and no referees: the first side to the target wins (by two, unless you turn that off).
      </p>
      <ul className="list-disc pl-6">
        <li>
          <b>Players:</b> pick regulars, league players or your own career players. Extra controllers can join either side in team games.
        </li>
        <li>
          <b>Scoring:</b> 1s and 2s (1 inside the arc, 2 beyond it) or 2s and 3s.
        </li>
        <li>
          <b>Check ball:</b> half court, every possession starts with the ball checked at the top of the key: after a basket, a foul or the ball going out. With
          make it, take it on, the team that scores keeps the ball; otherwise the other team gets it.
        </li>
        <li>
          <b>Take it back:</b> half court, after a miss, a steal or a rebound, the ball has to go back behind the arc (by dribble or pass) before you can score.
          A basket that wasn&apos;t taken back doesn&apos;t count and the other side gets the ball.
        </li>
        <li>
          <b>Call your own fouls:</b> no free throws. The player who was fouled checks it back up; on a charge the defense gets the ball. Nobody fouls out. Turn
          it off to play straight through with no fouls.
        </li>
        <li>
          <b>Full court:</b> after a basket the other team inbounds from under the basket (the scoring team, with make it, take it). One-on-one, you just step
          in with it.
        </li>
        <li>
          <b>Next game up:</b> winners stay on the court and the losers go to the back of the line. The games ahead of you are played out while you wait.
        </li>
        <li>
          <b>21:</b> everyone plays for themselves. Score and you shoot free throws (1 point each) until you miss, three at most; make all three and you check
          it again. Hit the target exactly: go over and you drop back (to 13 in a game to 21).
        </li>
        <li>
          <b>HORSE:</b> make a shot from anywhere and everyone has to make the same shot from the same spot, or take a letter. Miss your own shot and the next
          player sets one. Spell HORSE (or PIG) and you&apos;re out.
        </li>
        <li>
          <b>3-point contest:</b> 25 balls on five racks around the arc in 60 seconds. Walk to the rack and the next ball comes to you. The last ball on each
          rack (gold) is worth 2. Your rivals&apos; rounds are played out alongside yours.
        </li>
      </ul>
      <H2>League rules</H2>
      <ul className="list-disc pl-6">
        <li>
          <b>Pro:</b> four 12-minute quarters, 24-second shot clock (resets to 14 on an offensive rebound off the rim), 23 ft 9 in three-point line, six fouls
          to foul out, bonus on the fifth team foul per quarter.
        </li>
        <li>
          <b>College:</b> two 20-minute halves, 30-second shot clock (20 on offensive rebounds), 22 ft 1¾ in three-point line, five fouls, one-and-one from the
          seventh team foul and two shots from the tenth.
        </li>
        <li>
          <b>Arizona high school:</b> four 8-minute quarters, 35-second shot clock, 19 ft 9 in three-point line, five fouls, bonus on the fifth team foul per
          quarter.
        </li>
      </ul>
      <p>Quick Play lets you shorten periods. Stats scale with the time played.</p>
    </ProsePage>
  );
}
