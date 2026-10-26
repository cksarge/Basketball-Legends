// Event-driven play-by-play commentary (text, optionally spoken via Web Speech).
import type { GameEvent } from "./sim/events";
import type { Match } from "./sim/match";
import { Rng } from "@/engine/rng";

const rng = new Rng("commentary");
const pick = (arr: string[]) => arr[Math.floor(rng.next() * arr.length)];

export function commentFor(match: Match, e: GameEvent): string | null {
  const s = match.state;
  const nm = (i: number) => s.agents[i]?.player.lastName ?? "";
  const late = s.period >= s.cfg.rules.periods && s.clock < 60;
  const margin = Math.abs(s.teams[0].score - s.teams[1].score);
  switch (e.t) {
    case "make": {
      const who = nm(e.shooter);
      if (e.kind === "dunk") return pick([`${who} throws it down!`, `Oh, ${who} hammers it home!`, `${who} with the slam!`, `Big-time flush from ${who}!`]);
      if (e.points === 3) {
        if (late && margin <= 3) return pick([`${who} from deep... got it! Huge three!`, `Ice in the veins! ${who} knocks it down!`]);
        return pick([`${who} for three... bang!`, `${who} splashes the three.`, `Triple from ${who}!`, `${who}, nothing but net from downtown.`]);
      }
      if (e.andOne) return pick([`${who} scores and gets the foul. And one!`, `Plus the harm! ${who} hangs on for the and-one.`]);
      if (e.kind === "layup") return pick([`${who} lays it in.`, `${who} finishes at the rim.`, `Easy two for ${who}.`]);
      if (e.kind === "floater") return pick([`Soft floater from ${who}.`, `${who} drops in the teardrop.`]);
      if (e.assist !== null && rng.chance(0.4)) return `${nm(e.assist)} finds ${who} for two.`;
      return pick([`${who} pulls up... good.`, `${who} hits the jumper.`, `Mid-range money from ${who}.`]);
    }
    case "miss":
      if (rng.chance(0.55)) return null;
      return e.points === 3 ? pick([`${nm(e.shooter)} from three... no good.`, `Off the mark from deep.`]) : pick([`${nm(e.shooter)} can't get it to fall.`, `Rims out.`]);
    case "block": return pick([`Rejected by ${nm(e.blocker)}!`, `${nm(e.blocker)} sends it back!`, `Get that out of here! ${nm(e.blocker)} with the block.`]);
    case "steal": return pick([`Picked off by ${nm(e.player)}!`, `${nm(e.player)} with the steal.`, `${nm(e.player)} jumps the lane!`]);
    case "dribbleMove": return e.broke !== null ? pick([`${nm(e.player)} breaks his man down!`, `Ankles! ${nm(e.player)} with a filthy move.`]) : null;
    case "foul": return e.fts ? `Foul on ${nm(e.player)}. ${e.fts} shots coming.` : rng.chance(0.4) ? `Whistle. Foul on ${nm(e.player)}.` : null;
    case "violation":
      return e.kind === "shotClock" ? "Shot clock violation." : e.kind === "threeSeconds" ? "Three seconds in the lane." : e.kind === "goaltending" ? "Goaltending is called!" : e.kind === "backcourt" ? "Over and back. Backcourt violation." : null;
    case "timeout": return `${s.teams[e.team].team.name} calls timeout.`;
    case "periodEnd": return s.cfg.rules.periods === 2 && e.period === 1 ? "That's the half." : `End of the ${ordinal(e.period)}.`;
    case "final": return `That's the ballgame. ${s.teams[e.winner].team.name} win it.`;
    case "rebound": return e.offensive && rng.chance(0.35) ? `Offensive board, ${nm(e.player)}.` : null;
    default: return null;
  }
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]) + (n > 4 ? "" : " quarter");
}

let lastSpoke = 0;
export function speak(text: string, volume: number) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const now = performance.now();
  if (now - lastSpoke < 1800 || window.speechSynthesis.speaking) return;
  lastSpoke = now;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.12;
  u.pitch = 0.95;
  u.volume = volume;
  window.speechSynthesis.speak(u);
}
