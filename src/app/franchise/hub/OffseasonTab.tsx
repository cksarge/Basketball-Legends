"use client";
import { fullName } from "@/engine/player";
import type { Team } from "@/engine/types";
import { teamLabel } from "@/data/leagues";
import { advanceOffseason, canAdvance } from "@/franchise/core/offseason";
import { leagueModule } from "@/franchise/leagues";
import type { Franchise, OffseasonStep } from "@/franchise/types";
import { useFranchiseSim } from "@/state/franchiseSim";
import { useFranchise } from "@/state/franchiseStore";
import { Button, Panel } from "@/ui/kit";
import { TeamLogo } from "@/ui/TeamLogo";
import { staffHandles } from "@/franchise/pro/freeAgency";
import { standardCount } from "@/franchise/pro/rosterMoves";
import { ContractsPanel } from "./ContractsPanel";
import { DraftTab } from "./DraftTab";
import { FreeAgentsTab } from "./FreeAgentsTab";
import { ProgressPanel } from "./ProgressPanel";

const STEP_NAME: Record<OffseasonStep, string> = {
  review: "Season review",
  progress: "Player progress",
  lottery: "Draft lottery",
  draft: "Draft",
  contracts: "Contracts",
  freeAgency: "Free agency",
  camp: "Training camp",
};

/** The champion and the year's awards. */
export function SeasonReview({ f, teams }: { f: Franchise; teams: Team[] }) {
  const byId = (id: string) => teams.find((t) => t.id === id)!;
  const champ = f.season.championId;
  const pick = (id: string) => f.season.awards.filter((a) => a.id === id);
  return (
    <>
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
    </>
  );
}

function LotteryPanel({ f, teams }: { f: Franchise; teams: Team[] }) {
  return (
    <Panel title="Lottery results">
      <ol className="flex flex-col gap-1">
        {(f.draft.lottery ?? []).map((l) => {
          const moved = l.from - l.to;
          return (
            <li key={l.teamId} className={l.teamId === f.teamId ? "font-semibold text-amber" : ""}>
              {l.to + 1}. {teams.find((t) => t.id === l.teamId)?.name}
              {moved > 0 ? ` (up ${moved})` : moved < 0 ? ` (down ${-moved})` : ""}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

export function OffseasonTab({ f, teams }: { f: Franchise; teams: Team[] }) {
  const update = useFranchise((s) => s.update);
  const running = useFranchiseSim((s) => s.running);
  const steps = leagueModule(f.league).offseasonSteps;
  const step = f.offseason?.step;
  if (!step) return null;
  const at = steps.indexOf(step);
  const next = steps[at + 1];
  const allowed = canAdvance(f);
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-wrap gap-1" aria-label="Offseason steps">
        {steps.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? "step" : undefined}
            className={`rounded-[var(--radius-chip)] px-3 py-1 text-sm ${s === step ? "bg-amber font-semibold text-navy" : i < at ? "bg-deck text-net" : "bg-deck text-steel"}`}
          >
            {STEP_NAME[s]}
          </li>
        ))}
      </ol>
      {step === "review" && <SeasonReview f={f} teams={teams} />}
      {step === "progress" && <ProgressPanel f={f} />}
      {step === "lottery" && <LotteryPanel f={f} teams={teams} />}
      {step === "draft" && <DraftTab f={f} teams={teams} />}
      {step === "contracts" && <ContractsPanel f={f} />}
      {step === "freeAgency" && <FreeAgentsTab f={f} />}
      {step === "camp" && (
        <Panel title="Training camp">
          <p className="mb-3 text-steel">
            You have {standardCount(f, f.teamId)} players on standard deals. The {f.season.year + 1} season needs 13 to 15.
          </p>
          <Button variant="secondary" onClick={() => update(staffHandles)}>
            Let your staff set the roster
          </Button>
        </Panel>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={running || !allowed.ok} onClick={() => update((x) => advanceOffseason(x, teams))}>
          {next ? `Continue to ${STEP_NAME[next]}` : `Start the ${f.season.year + 1} season`}
        </Button>
        {!allowed.ok && <p className="text-sm text-steel">{allowed.reason}</p>}
      </div>
    </div>
  );
}
