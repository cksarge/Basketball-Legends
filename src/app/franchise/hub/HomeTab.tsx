"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addDays } from "@/career/calendar";
import type { ScheduledGame } from "@/career/types";
import { formatDate } from "@/career/format";
import { primaryDevice } from "@/ui/game/primaryDevice";
import { teamLabel } from "@/data/leagues";
import type { Team } from "@/engine/types";
import { fullName } from "@/engine/player";
import { dueGame, nextFranchiseEvent, startFourth } from "@/franchise/core/season";
import { leagueModule } from "@/franchise/leagues";
import { fourthPending, franchisePending } from "@/franchise/match";
import { loadFranchise } from "@/franchise/storage";
import type { Franchise } from "@/franchise/types";
import { runFranchiseSim, useFranchiseSim } from "@/state/franchiseSim";
import { useFranchise } from "@/state/franchiseStore";
import { useMatchStore } from "@/state/matchStore";
import { findFranchiseSave } from "@/state/suspended";
import { Button, Panel, Toggle } from "@/ui/kit";
import { useInputDevice } from "@/ui/MenuNavigator";
import { MatchupPicker } from "@/ui/MatchupPicker";
import { TeamLogo } from "@/ui/TeamLogo";
import { toast } from "@/ui/Toaster";

/** Who guards whom in the next game. */
function GamePlanPanel({ f, game }: { f: Franchise; game: ScheduledGame }) {
  const update = useFranchise((s) => s.update);
  const running = useFranchiseSim((s) => s.running);
  const opponent = game.homeId === f.teamId ? game.awayId : game.homeId;
  const roster = (id: string) => f.rosters[id].map((p) => f.players[p]);
  const mine = roster(f.teamId);
  return (
    <Panel title="Game plan">
      <p className="mb-2 text-sm text-steel">For this game only. Matchups apply when you play man-to-man.</p>
      <MatchupPicker
        mine={mine.filter((p) => !p.injury)}
        theirs={roster(opponent).filter((p) => !p.injury)}
        value={f.plan.tactics}
        disabled={running}
        onChange={(tactics) => update((x) => ({ ...x, plan: { ...x.plan, tactics } }))}
      />
    </Panel>
  );
}

export function HomeTab({ f, teams }: { f: Franchise; teams: Team[] }) {
  const router = useRouter();
  const setPending = useMatchStore((s) => s.setPending);
  const device = useInputDevice((s) => s.device);
  const update = useFranchise((s) => s.update);
  const ev = nextFranchiseEvent(f);
  const [until, setUntil] = useState("");
  const running = useFranchiseSim((s) => s.running);
  const byId = (id: string) => teams.find((t) => t.id === id)!;
  const seasonEnd = leagueModule(f.league).calendar(f.season.year).seasonEnd;

  const play = async () => {
    if (ev.kind !== "game") return;
    // the rest of the league catches up to game day first
    if ((await runFranchiseSim({ until: "nextUserGame", includeUser: false }, teams)) !== "done") return;
    const fresh = await loadFranchise(f.id);
    const game = fresh && dueGame(fresh);
    if (!game || game.id !== ev.game.id) {
      toast("That game has changed. Check the schedule and try again.", "bad");
      return;
    }
    setPending(franchisePending(fresh, game, teams, primaryDevice(device)));
    router.push("/game/");
  };
  const playFourth = async () => {
    if (ev.kind !== "game") return;
    if ((await runFranchiseSim({ until: "nextUserGame", includeUser: false }, teams)) !== "done") return;
    await update((x) => {
      const game = dueGame(x);
      return game?.id === ev.game.id ? startFourth(x, game) : x;
    });
    const fresh = await loadFranchise(f.id);
    if (!fresh?.live || fresh.live.gameId !== ev.game.id) {
      toast("That game has changed. Check the schedule and try again.", "bad");
      return;
    }
    setPending(fourthPending(fresh, ev.game, teams, primaryDevice(device)));
    router.push("/game/");
  };
  const saved = ev.kind === "game" ? findFranchiseSave(f.id, ev.game.id) : null;
  const live = ev.kind === "game" && f.live?.gameId === ev.game.id ? f.live.partial : null;
  const dayAfter = until || addDays(f.date, 7);

  if (ev.kind === "seasonEnd") {
    const champ = f.season.championId;
    const pick = (id: string) => f.season.awards.filter((a) => a.id === id);
    return (
      <div className="flex flex-col gap-5">
        {champ && (
          <Panel>
            <div className="flex items-center gap-4">
              <TeamLogo team={byId(champ)} size={72} />
              <p className="font-display text-3xl font-black">{teamLabel(byId(champ))} won the championship</p>
            </div>
          </Panel>
        )}
        <Panel title="Awards">
          <ul className="flex flex-col gap-1">
            {["mvp", "dpoy", "sixth", "finalsMvp"].flatMap(pick).map((a) => (
              <li key={a.id}>
                <span className="text-steel">{a.label}:</span> {fullName(f.players[a.playerId])}, {byId(a.teamId).name}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <p className="text-steel">The offseason arrives in a later update. Your season is saved.</p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title={ev.kind === "game" ? "Next game" : "Next up"}>
        {ev.kind === "game" ? (
          <>
            <div className="flex items-center gap-4">
              <TeamLogo team={byId(ev.game.homeId === f.teamId ? ev.game.awayId : ev.game.homeId)} size={56} />
              <div>
                <p className="font-display text-2xl font-black">
                  {ev.game.homeId === f.teamId ? "vs" : "at"} {teamLabel(byId(ev.game.homeId === f.teamId ? ev.game.awayId : ev.game.homeId))}
                </p>
                <p className="text-sm text-steel">
                  {formatDate(ev.date)}
                  {ev.game.label ? ` · ${ev.game.label}` : ""}
                </p>
              </div>
            </div>
            {live && (
              <p className="mt-3 font-semibold" role="status">
                After three quarters: {byId(ev.game.awayId).name} {live.away}, {byId(ev.game.homeId).name} {live.home}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {saved ? (
                <Button
                  disabled={running}
                  onClick={() => {
                    setPending(saved.pending);
                    router.push("/game/");
                  }}
                >
                  Resume game
                </Button>
              ) : (
                <>
                  {!live && (
                    <Button disabled={running} onClick={play}>
                      Play
                    </Button>
                  )}
                  <Button variant={live ? "primary" : "secondary"} disabled={running} onClick={playFourth}>
                    Play the 4th quarter
                  </Button>
                </>
              )}
              <Button variant="secondary" disabled={running} onClick={() => runFranchiseSim({ until: ev.date, includeUser: true, simLive: true }, teams)}>
                {live ? "Sim the rest" : "Sim game"}
              </Button>
              {ev.date > f.date && (
                <Button variant="secondary" disabled={running} onClick={() => runFranchiseSim({ until: "nextUserGame", includeUser: false }, teams)}>
                  Sim to next event
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-steel">Your team has no game scheduled right now.</p>
            <div className="mt-4">
              <Button disabled={running} onClick={() => runFranchiseSim({ until: "nextUserGame", includeUser: false }, teams)}>
                Sim to next event
              </Button>
            </div>
          </>
        )}
      </Panel>
      {ev.kind === "game" && <GamePlanPanel f={f} game={ev.game} />}
      <Panel title="Sim ahead">
        <fieldset disabled={running}>
          <Toggle
            label="Close games only"
            hint={`Sims your games, and stops if the 4th quarter starts within ${f.settings.closeGameMargin} points`}
            checked={f.settings.closeGamesOnly}
            onChange={(closeGamesOnly) => update((x) => ({ ...x, settings: { ...x.settings, closeGamesOnly } }))}
          />
        </fieldset>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm text-steel">
            Sim through
            <input
              type="date"
              value={dayAfter}
              min={f.date}
              max={seasonEnd}
              onChange={(e) => setUntil(e.target.value)}
              className="rounded-[var(--radius-chip)] bg-navy px-3 py-2 text-net ring-1 ring-line"
            />
          </label>
          <Button variant="secondary" disabled={running} onClick={() => runFranchiseSim({ until: dayAfter, includeUser: true }, teams)}>
            Sim to date
          </Button>
          <Button variant="secondary" disabled={running} onClick={() => runFranchiseSim({ until: "seasonEnd", includeUser: true }, teams)}>
            Sim the season
          </Button>
        </div>
      </Panel>
    </div>
  );
}
