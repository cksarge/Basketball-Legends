import type { Metadata } from "next";
import { H2, ProsePage } from "@/ui/Prose";

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
        New to the game? Choose <b>Tutorial</b> on the main menu for a guided session that walks you through every basic move and checks off each one as you do
        it.
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
      <p>
        Hold the shoot button to rise into your shot and release it at the top of your jump. The bar on the right fills while you hold; the green band is the
        ideal release, and after you let go it tells you how you timed it (perfect, good, slightly early or slightly late). A perfect release goes in nearly
        every time, a slightly early or late one barely changes it, and a badly mistimed one is far less likely to go in. Better shooters get a wider green
        window, and the band on the meter shows its real size. You can turn the meter off in Settings to use rating-based shooting, or choose tap-to-shoot under
        Accessibility.
      </p>
      <p>
        Where you shoot from matters: open catch-and-shoot threes and shots at the rim are the most efficient. Contested shots, shots off a hard dribble and
        shots late in a long stretch of minutes (fatigue) are harder.
      </p>
      <p>
        A pump fake out of a dribble ends your dribble: from there you can pivot, pass or shoot, but walking more than a step is traveling. Careless ball
        handlers can also get called for an extra step on drives.
      </p>
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
      <p>
        Stay between your man and the basket. Reaching for steals from behind or from too far away risks a foul. Jump at the right moment to block: too early
        and the shooter waits you out. A pump fake can get an eager defender off his feet.
      </p>
      <H2>Coaching and tactics</H2>
      <p>
        Before a Quick Play game, and any time from the pause menu (Tactics), you can set your team&apos;s pace, how much it hunts threes, how hard it crashes
        the offensive glass, whether it doubles the other team&apos;s best scorer, and its defense:
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
      <p>
        Press Esc (or Menu) to pause. From the pause menu you can see the box score and play-by-play, make substitutions, call a timeout, change the camera,
        simulate the rest of the game or restart. T calls a timeout when your team has the ball, and Y cycles through the cameras.
      </p>
      <H2>Saving and resuming</H2>
      <p>
        Games save themselves every few seconds. If you close the tab, or choose Save and quit from the pause menu, the main menu shows Resume game with the
        score and time left. Resumed games start paused so you can get ready. Quit game (or finishing the game) clears the save.
      </p>
      <H2>Replays and highlights</H2>
      <p>
        Press R (or the left stick click) at any time to replay the last few seconds. In a replay, Space plays and pauses, the arrow keys scrub back and forth
        and change the speed, and Y switches between the orbit, baseline, above-the-rim, courtside and broadcast cameras. Press R or Esc to go back to the game.
      </p>
      <p>
        Big baskets (dunks, threes, and-ones, clutch shots and buzzer beaters) replay automatically in slow motion once the ball is through the net, so a great
        pass or block never stops live play; press Space to skip one. Blocks, steals and ankle breakers are still saved with the best plays as highlights you
        can watch from the pause menu, at quarter breaks and after the final buzzer. In Settings under Presentation you can have every big play replay
        automatically instead, or turn automatic replays off.
      </p>
      <H2>Breaks, timeouts and injuries</H2>
      <p>
        At the end of each quarter, at halftime and during timeouts, both teams huddle at their benches and a panel shows the line score, team stats, leaders
        and any injuries. Make substitutions from there, watch highlights, or press Continue to get back to the game. When nobody is playing (CPU vs CPU) the
        game continues on its own after ten seconds.
      </p>
      <p>
        With injuries turned on in Settings, hard falls, collisions on drives and awkward landings can hurt a player. Play stops at the next safe moment and the
        coach brings in a substitute, even if you manage substitutions yourself. Tougher players (higher durability) get hurt less often and recover sooner.
      </p>
      <H2>Officials</H2>
      <p>
        Three referees work every game. Watch them for the call: a raised fist is a foul, rolling forearms is traveling, a hand behind the head is a charge,
        hands on hips is a blocking foul, a T is a timeout, and a pointed arm shows which way the ball is going. On a three-point try the nearest official
        raises one arm, and both arms go up when it falls. On inbounds the official counts the five seconds with his arm.
      </p>
      <H2>Venues</H2>
      <p>
        Every team plays in its own building. High schools play in small, classic or modern gyms depending on their size, colleges in a fieldhouse or a campus
        arena, and pro teams in one of two big arenas. Seats, walls, banners and scoreboards are dressed in the home team&apos;s colors and history. In Quick
        Play you can move any game to a pro arena, a college arena or a high school gym with the Venue option.
      </p>
      <H2>Play in the Park</H2>
      <p>
        Pickup games at five outdoor courts, against each park&apos;s regulars. There&apos;s no clock and no referees: the first side to the target wins (by
        two, unless you turn that off).
      </p>
      <ul className="list-disc pl-6">
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
          <b>Call your own fouls:</b> no free throws. The player who was fouled checks it back up; on a charge the defense gets the ball. Nobody fouls out.
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
