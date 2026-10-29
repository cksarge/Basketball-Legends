"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { heightStr, playerOvr } from "@/engine/player";
import type { Player } from "@/engine/types";
import { PARKS, parkById, type Park } from "@/game/park/parks";
import { parkRegulars, regularOutfit } from "@/game/park/regulars";
import { crewById, recordGame, simUntilYou } from "@/game/park/line";
import {
  type Cast,
  castSize,
  crewStrength,
  lineGame,
  maxCrews,
  MAX_TEAM,
  MIN_TEAM,
  pickCast,
  rulesFor,
  buildPark,
  startLine,
  YOU_CREW,
} from "@/game/park/session";
import { useMatchStore } from "@/state/matchStore";
import { type ParkMode, type ParkSetup, useParkStore } from "@/state/parkStore";
import { audio } from "@/audio/engine";
import { Button, Panel, Segmented, Toggle } from "@/ui/kit";
import { PlayerPicker } from "./PlayerPicker";

const MODES: { value: ParkMode; label: string; blurb: string }[] = [
  { value: "pickup", label: "Pickup game", blurb: "One game, 1-on-1 up to 5-on-5." },
  { value: "line", label: "Next game up", blurb: "Winners stay on. Lose and you're back in line." },
  { value: "21", label: "21", blurb: "Everyone for themselves. Hit exactly 21." },
  { value: "horse", label: "HORSE", blurb: "Make it and they have to match it." },
  { value: "three", label: "3-point contest", blurb: "25 balls, five racks, 60 seconds." },
];

function controllerId() {
  if (typeof navigator === "undefined") return "keyboard";
  const pad = [...(navigator.getGamepads?.() ?? [])].find((p): p is Gamepad => !!p && p.connected);
  return pad ? `pad${pad.index}` : "keyboard";
}

/** A little top-down sketch of the park's court colors. */
function CourtSwatch({ park }: { park: Park }) {
  const s = park.surface;
  return (
    <div className="relative h-16 w-full overflow-hidden rounded" style={{ background: s.apron }} aria-hidden>
      <div className="absolute inset-x-3 inset-y-2 rounded-sm border" style={{ background: s.court, borderColor: s.lines }}>
        <div className="absolute inset-y-[30%] left-0 w-[18%] border" style={{ background: s.key, borderColor: s.lines }} />
        <div className="absolute inset-y-[30%] right-0 w-[18%] border" style={{ background: s.key, borderColor: s.lines }} />
        <div className="absolute inset-y-0 left-1/2 border-l" style={{ borderColor: s.lines }} />
      </div>
      <span className="absolute right-1.5 top-1 text-xs">{park.time === "night" ? "🌙" : park.time === "sunset" ? "🌇" : "☀️"}</span>
    </div>
  );
}

export function ParkMenu() {
  const router = useRouter();
  const { setup, set, line, setLine, load, loaded } = useParkStore();
  const setPending = useMatchStore((s) => s.setPending);
  const lastResult = useMatchStore((s) => s.lastResult);
  const setResult = useMatchStore((s) => s.setResult);
  const [seed, setSeed] = useState(1);
  const [overrides, setOverrides] = useState<Record<string, Player>>({});
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => load(), [load]);

  const park = parkById(setup.parkId);
  const regulars = useMemo(() => parkRegulars(park), [park]);
  const base = useMemo(() => pickCast(setup, regulars, seed), [setup, regulars, seed]);
  const cast: Cast = useMemo(() => {
    const o = (slot: string, p: Player) => overrides[slot] ?? p;
    return {
      you: setup.you ?? base.you,
      mates: base.mates.map((p, i) => o(`mates-${i}`, p)),
      opps: base.opps.map((p, i) => o(`opps-${i}`, p)),
      crews: base.crews,
    };
  }, [base, overrides, setup.you]);

  // a line game just finished: record it, then play out the games ahead of you
  useEffect(() => {
    if (!line || !lastResult || lastResult.mode !== "park" || lastResult.simulated === undefined) return;
    const theirs = (lastResult.homeId === "crew-you" ? lastResult.awayId : lastResult.homeId).replace(/^crew-/, "");
    if (!line.line.crews.some((c) => c.id === theirs)) return;
    const youHome = lastResult.homeId === "crew-you";
    let l = recordGame(line.line, {
      home: YOU_CREW,
      away: theirs,
      homeScore: youHome ? lastResult.homeScore : lastResult.awayScore,
      awayScore: youHome ? lastResult.awayScore : lastResult.homeScore,
      played: true,
    });
    l = simUntilYou(l, (id) => crewStrength(l, line.players, id), line.rules, `${line.parkId}:${l.history.length}`);
    setResult(null);
    setLine({ ...line, line: l, recorded: line.recorded + 1 });
  }, [line, lastResult, setLine, setResult]);

  if (!loaded) return null;

  const go = (p: ReturnType<typeof buildPark>["pending"]) => {
    audio.unlock();
    setPending(p);
    router.push("/game/");
  };

  const start = () => {
    const seedNow = Math.floor(Math.random() * 1e6);
    if (setup.mode === "line") {
      const { line: l, players } = startLine(setup, cast);
      const session = { parkId: park.id, rules: rulesFor(setup), line: l, players, recorded: 0 };
      setLine(session);
      go(lineGame(park.id, session.rules, l, players, controllerId(), seedNow));
      return;
    }
    go(buildPark(setup, cast, controllerId(), seedNow).pending);
  };

  if (line) return <LineView key={line.recorded} />;

  const n = castSize(setup);
  const taken = new Set([cast.you.id, ...cast.mates.map((p) => p.id), ...cast.opps.map((p) => p.id)]);
  const pick = (slot: string, p: Player) => {
    if (slot === "you") set({ you: p });
    else setOverrides((o) => ({ ...o, [slot]: p }));
    setPicking(null);
  };
  const playerChip = (slot: string, p: Player) => {
    const reg = regulars.find((r) => r.player.id === p.id);
    const o = regularOutfit(p.id);
    return (
      <li key={slot}>
        <button
          onClick={() => setPicking(slot)}
          className="flex w-full items-center gap-3 rounded-[var(--radius-chip)] bg-deck-2 px-3 py-2 text-left ring-1 ring-line hover:ring-amber"
          aria-label={`Change ${p.firstName} ${p.lastName}`}
        >
          <span className="h-7 w-5 rounded-sm ring-1 ring-line" style={{ background: o.shirt }} aria-hidden />
          <span className="flex-1">
            <span className="block font-semibold leading-tight">
              {p.firstName} {p.lastName}
              {reg && <span className="text-steel"> “{reg.nickname}”</span>}
            </span>
            <span className="block text-xs text-steel">
              {p.pos} · {heightStr(p.heightIn)} · {playerOvr(p)} OVR{reg ? ` · ${reg.rep}` : ""}
            </span>
          </span>
          <span className="text-xs text-steel">Change</span>
        </button>
      </li>
    );
  };
  const team = setup.mode === "pickup" || setup.mode === "line";

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Pick a park">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {PARKS.map((p) => (
            <li key={p.id}>
              <button
                aria-pressed={p.id === park.id}
                onClick={() => {
                  set({ parkId: p.id, you: null });
                  setOverrides({});
                }}
                className={`flex h-full w-full flex-col gap-2 rounded-[var(--radius-chip)] p-3 text-left ring-1 ${p.id === park.id ? "bg-amber/10 ring-amber" : "bg-deck-2 ring-line hover:ring-amber"}`}
              >
                <CourtSwatch park={p} />
                <span className="font-display text-lg font-black leading-tight">{p.name}</span>
                <span className="text-xs text-steel">
                  {p.city}, {p.state} · {p.vibe}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-steel">{park.blurb}</p>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Panel title="What are we playing?">
          <Segmented<ParkMode>
            label="Game"
            value={setup.mode}
            onChange={(mode) => set({ mode, target: mode === "21" ? 21 : setup.mode === "21" ? 15 : setup.target })}
            options={MODES.map((m) => ({ value: m.value, label: m.label }))}
          />
          <p className="mt-2 text-sm text-steel">{MODES.find((m) => m.value === setup.mode)?.blurb}</p>
          <div className="mt-4 flex flex-col gap-3">
            {team && (
              <>
                <Segmented<number>
                  showLabel
                  label="Team size"
                  value={setup.teamSize}
                  onChange={(teamSize) => set({ teamSize, halfCourt: teamSize <= 3 ? true : teamSize >= 5 ? false : setup.halfCourt })}
                  options={Array.from({ length: MAX_TEAM - MIN_TEAM + 1 }, (_, i) => ({ value: i + 1, label: `${i + 1}v${i + 1}` }))}
                />
                <Segmented<string>
                  showLabel
                  label="Court"
                  value={setup.halfCourt ? "half" : "full"}
                  onChange={(v) => set({ halfCourt: v === "half" })}
                  options={[
                    { value: "half", label: "Half court" },
                    { value: "full", label: "Full court" },
                  ]}
                />
              </>
            )}
            {setup.mode !== "horse" && setup.mode !== "three" && (
              <>
                <Segmented<string>
                  showLabel
                  label="Scoring"
                  value={setup.scoring}
                  onChange={(v) => set({ scoring: v as ParkSetup["scoring"] })}
                  options={[
                    { value: "ones", label: "1s and 2s" },
                    { value: "twos", label: "2s and 3s" },
                  ]}
                />
                <Segmented<number>
                  showLabel
                  label={setup.mode === "21" ? "Play to exactly" : "Game to"}
                  value={setup.target}
                  onChange={(target) => set({ target })}
                  options={[11, 15, 21].map((v) => ({ value: v, label: String(v) }))}
                />
              </>
            )}
            {team && (
              <>
                <Toggle label="Win by 2" checked={setup.winBy2} onChange={(winBy2) => set({ winBy2 })} />
                <Toggle
                  label="Make it, take it"
                  hint="The team that scores keeps the ball. Off: losers' ball after every basket."
                  checked={setup.makeItTakeIt}
                  onChange={(makeItTakeIt) => set({ makeItTakeIt })}
                />
              </>
            )}
            {setup.mode === "line" && (
              <Segmented<number>
                showLabel
                label="Crews waiting"
                value={Math.min(setup.crews, maxCrews(setup))}
                onChange={(crews) => set({ crews })}
                options={[1, 2, 3, 4].filter((v) => v <= maxCrews({ ...setup, crews: 4 })).map((v) => ({ value: v, label: String(v) }))}
              />
            )}
            {setup.mode === "21" && (
              <Segmented<number>
                showLabel
                label="Players"
                value={setup.players21}
                onChange={(players21) => set({ players21 })}
                options={[3, 4, 5, 6].map((v) => ({ value: v, label: String(v) }))}
              />
            )}
            {setup.mode === "horse" && (
              <>
                <Segmented<number>
                  showLabel
                  label="Opponents"
                  value={setup.horseOpponents}
                  onChange={(horseOpponents) => set({ horseOpponents })}
                  options={[1, 2, 3].map((v) => ({ value: v, label: String(v) }))}
                />
                <Segmented<string>
                  showLabel
                  label="Spell"
                  value={setup.word}
                  onChange={(v) => set({ word: v as ParkSetup["word"] })}
                  options={["HORSE", "PIG"].map((v) => ({ value: v, label: v }))}
                />
              </>
            )}
            {setup.mode === "three" && (
              <Segmented<number>
                showLabel
                label="Rivals"
                value={setup.rivals}
                onChange={(rivals) => set({ rivals })}
                options={[1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }))}
              />
            )}
          </div>
          <RulesNote setup={setup} />
        </Panel>

        <Panel title="Who's playing">
          <p className="mb-1 text-sm text-steel">You</p>
          <ul className="mb-3">{playerChip("you", cast.you)}</ul>
          {n.mates > 0 && (
            <>
              <p className="mb-1 text-sm text-steel">Your teammates</p>
              <ul className="mb-3 flex flex-col gap-1.5">{cast.mates.map((p, i) => playerChip(`mates-${i}`, p))}</ul>
            </>
          )}
          {n.opps > 0 && (
            <>
              <p className="mb-1 text-sm text-steel">
                {setup.mode === "three"
                  ? "Rivals"
                  : setup.mode === "21" || setup.mode === "horse"
                    ? "Playing with you"
                    : setup.mode === "line"
                      ? "Holding the court"
                      : "The other side"}
              </p>
              <ul className="mb-3 flex flex-col gap-1.5">{cast.opps.map((p, i) => playerChip(`opps-${i}`, p))}</ul>
            </>
          )}
          {setup.mode === "line" && cast.crews.length > 0 && (
            <p className="mb-3 text-sm text-steel">
              {cast.crews.length} more crew{cast.crews.length > 1 ? "s" : ""} of park regulars waiting by the fence.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => (setSeed((x) => x + 1), setOverrides({}))}>
              Shuffle the regulars
            </Button>
            <Button onClick={start}>Play</Button>
          </div>
        </Panel>
      </div>

      {picking && (
        <PlayerPicker
          title={picking === "you" ? "Who are you playing as?" : "Pick a player"}
          regulars={regulars}
          taken={new Set([...taken].filter((id) => id !== (picking === "you" ? cast.you.id : undefined)))}
          onPick={(p) => pick(picking, p)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

function RulesNote({ setup }: { setup: ParkSetup }) {
  const items =
    setup.mode === "horse"
      ? [
          "Make a shot from anywhere and everyone else has to make the same shot from the same spot.",
          "Miss a shot you have to match and you take a letter. Spell the word and you're out.",
          "Miss your own shot and the next player sets one.",
        ]
      : setup.mode === "three"
        ? [
            "Five racks of five balls around the arc: walk to each rack and the next ball comes to you.",
            "Every ball is worth 1 except the last one on each rack (2).",
            "Highest score after 60 seconds wins.",
          ]
        : [
            setup.mode === "21" ? "Everyone plays on their own: the ball handler against everyone else." : "No clock and no referees.",
            "Call your own fouls: no free throws, the player who was fouled checks it back up.",
            setup.mode === "21" || setup.halfCourt
              ? "After a miss, a steal or a rebound, take it back past the arc before you can score."
              : "Full court: after a basket the other team inbounds.",
            setup.mode === "21"
              ? "Make a basket and keep shooting free throws (1 point each) until you miss. Go over and you drop back."
              : "Check ball up top after every basket and foul (half court).",
          ];
  return (
    <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-steel">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

/** The line: who holds the court, who's waiting, and how the last games went. */
function LineView() {
  const router = useRouter();
  const { line, setLine } = useParkStore();
  const setPending = useMatchStore((s) => s.setPending);
  if (!line) return null;
  const l = line.line;
  const park = parkById(line.parkId);
  const name = (id: string) => crewById(l, id).name;
  const recent = [...l.history].reverse().slice(0, 8);
  const play = () => {
    audio.unlock();
    setPending(lineGame(line.parkId, line.rules, l, line.players, controllerId(), Math.floor(Math.random() * 1e6)));
    router.push("/game/");
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <Panel title={`Next game up at ${park.name}`}>
        <p className="mb-4 text-steel">
          {l.holder === l.you ? `You're holding the court. ${l.streak} straight win${l.streak === 1 ? "" : "s"}.` : `${name(l.holder)} has the court.`}
          {l.best > 0 && ` Your best run today: ${l.best}.`}
        </p>
        <div className="mb-4 flex items-center justify-center gap-4 rounded-[var(--radius-chip)] bg-deck-2 p-4 ring-1 ring-line">
          <span className={`font-display text-2xl font-black ${l.holder === l.you ? "text-amber" : ""}`}>{name(l.holder)}</span>
          <span className="text-steel">vs</span>
          <span className={`font-display text-2xl font-black ${l.queue[0] === l.you ? "text-amber" : ""}`}>{name(l.queue[0])}</span>
        </div>
        <p className="mb-1 text-sm text-steel">Waiting by the fence</p>
        <ol className="mb-4 list-decimal pl-6">
          {l.queue.slice(1).map((id) => (
            <li key={id} className={id === l.you ? "text-amber" : ""}>
              {name(id)}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button onClick={play}>Play next game</Button>
          <Button variant="secondary" onClick={() => setLine(null)}>
            Leave the line
          </Button>
        </div>
      </Panel>
      <Panel title="Results">
        {!recent.length && <p className="text-steel">No games yet.</p>}
        <ul className="flex flex-col gap-1.5">
          {recent.map((g, i) => {
            const homeWon = g.homeScore > g.awayScore;
            return (
              <li key={i} className="flex justify-between rounded bg-deck-2 px-3 py-1.5 text-sm">
                <span>
                  <b className={homeWon ? "" : "text-steel"}>{name(g.home)}</b> {g.homeScore}-{g.awayScore}{" "}
                  <b className={homeWon ? "text-steel" : ""}>{name(g.away)}</b>
                </span>
                <span className="text-xs text-steel">{g.played ? "You played" : "While you waited"}</span>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
