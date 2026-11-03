"use client";
import { autoKeysFor, setAuto } from "@/franchise/auto";
import type { LeagueId } from "@/engine/types";
import { leagueModule, type SettingsField } from "@/franchise/leagues";
import { setLeagueSettings } from "@/franchise/settings";
import type { Franchise, LeagueSettings } from "@/franchise/types";
import type { Difficulty } from "@/game/sim/state";
import { useFranchiseSim } from "@/state/franchiseSim";
import { useFranchise } from "@/state/franchiseStore";
import { Panel, Select, Toggle } from "@/ui/kit";

const LATER = "Starts next season";

/** League rules, as fields. Used by the creator and the Settings tab. Each league shows only the rules it has. */
export function LeagueFields({
  league,
  value,
  onChange,
  waits,
}: {
  league: LeagueId;
  value: LeagueSettings;
  onChange: (patch: Partial<LeagueSettings>) => void;
  waits?: boolean;
}) {
  const options = leagueModule(league).settingsOptions;
  const has = (field: SettingsField) => options.fields.includes(field);
  const format = (patch: Partial<LeagueSettings["playoffFormat"]>) => onChange({ playoffFormat: { ...value.playoffFormat, ...patch } });
  return (
    <>
      <Select
        label="Games per season"
        value={value.gamesPerSeason}
        options={options.games.map((n) => ({ value: n, label: String(n) }))}
        onChange={(gamesPerSeason) => onChange({ gamesPerSeason })}
        hint={waits ? LATER : undefined}
      />
      {has("conferenceTournaments") && (
        <Toggle
          label="Conference tournaments"
          hint={waits ? LATER : "Off: each conference's regular-season champion gets its bid"}
          checked={value.playoffFormat.conferenceTournaments !== false}
          onChange={(conferenceTournaments) => format({ conferenceTournaments })}
        />
      )}
      {has("nationalField") && (
        <Select
          label="Division I tournament"
          value={value.playoffFormat.nationalField ?? 68}
          options={[
            { value: 68, label: "68 teams" },
            { value: 64, label: "64 teams" },
          ]}
          onChange={(nationalField) => format({ nationalField })}
          hint={waits ? LATER : "68 adds four opening-round games"}
        />
      )}
      {has("openDivision") && (
        <Toggle
          label="Open Division"
          hint={waits ? LATER : "The best 16 from 6A to 4A play their own bracket"}
          checked={value.playoffFormat.openDivision !== false}
          onChange={(openDivision) => format({ openDivision })}
        />
      )}
      {has("playoffFormat") && (
        <>
          <Select
            label="First round"
            value={value.playoffFormat.firstRoundBestOf}
            options={[
              { value: 7, label: "Best of 7" },
              { value: 5, label: "Best of 5" },
            ]}
            onChange={(firstRoundBestOf) => format({ firstRoundBestOf })}
            hint={waits ? LATER : undefined}
          />
          <Toggle
            label="Play-in tournament"
            hint={waits ? LATER : "Seeds 7 to 10 play for the last two spots"}
            checked={value.playoffFormat.playIn}
            onChange={(playIn) => format({ playIn })}
          />
        </>
      )}
      {has("tradeDifficulty") && (
        <Select
          label="Trade difficulty"
          value={value.tradeDifficulty}
          options={[
            { value: "easy", label: "Easy" },
            { value: "normal", label: "Normal" },
            { value: "hard", label: "Hard" },
          ]}
          onChange={(tradeDifficulty) => onChange({ tradeDifficulty })}
        />
      )}
      <Select
        label="Injuries"
        value={value.injuries}
        options={[
          { value: "off", label: "Off" },
          { value: "fewer", label: "Fewer" },
          { value: "normal", label: "Normal" },
          { value: "more", label: "More" },
        ]}
        onChange={(injuries) => onChange({ injuries })}
      />
      <Select
        label="Player progression"
        value={value.progression}
        options={[
          { value: "slow", label: "Slow" },
          { value: "normal", label: "Normal" },
          { value: "fast", label: "Fast" },
        ]}
        onChange={(progression) => onChange({ progression })}
      />
    </>
  );
}

const DIFFICULTY: { value: Difficulty; label: string }[] = [
  { value: "rookie", label: "Rookie" },
  { value: "pro", label: "Pro" },
  { value: "allstar", label: "All-Star" },
  { value: "superstar", label: "Superstar" },
  { value: "hof", label: "Hall of Fame" },
  { value: "legend", label: "Legend" },
];

export function SettingsTab({ f }: { f: Franchise }) {
  const update = useFranchise((s) => s.update);
  const running = useFranchiseSim((s) => s.running);
  const shown = f.settings.pendingLeague ?? f.settings.league;
  const set = (patch: Partial<Franchise["settings"]>) => update((x) => ({ ...x, settings: { ...x.settings, ...patch } }), []);
  return (
    <fieldset disabled={running} className="flex flex-col gap-5">
      <Panel title="League">
        <LeagueFields league={f.league} value={shown} waits onChange={(patch) => update((x) => setLeagueSettings(x, patch), [])} />
      </Panel>
      <Panel title="Auto-manage">
        <p className="mb-2 text-sm text-steel">Your staff runs anything switched on, using the same rules as every other team.</p>
        <Toggle
          label="Rotation"
          hint="Your staff sets starters and minutes"
          checked={f.plan.autoRotation}
          onChange={(autoRotation) => update((x) => ({ ...x, plan: { ...x.plan, autoRotation } }), [])}
        />
        {autoKeysFor(f).map((k) => (
          <Toggle key={k.key} label={k.label} hint={k.hint} checked={f.settings.auto[k.key]} onChange={(on) => update((x) => setAuto(x, k.key, on))} />
        ))}
      </Panel>
      <Panel title="Playing games">
        <Select
          label={leagueModule(f.league).periods === 2 ? "Half length" : "Quarter length"}
          value={f.settings.quarterMinutes}
          options={(leagueModule(f.league).periods === 2 ? [6, 8, 10, 12, 16, 20] : [3, 5, 6, 8, 10, 12]).map((n) => ({ value: n, label: `${n} minutes` }))}
          onChange={(quarterMinutes) => set({ quarterMinutes })}
          hint="Stats from shorter games count at full length"
        />
        <Select label="Difficulty" value={f.settings.difficulty} options={DIFFICULTY} onChange={(difficulty) => set({ difficulty })} />
        <Select
          label="Close game margin"
          value={f.settings.closeGameMargin}
          options={[4, 6, 8, 10, 12, 15].map((n) => ({ value: n, label: `${n} points` }))}
          onChange={(closeGameMargin) => set({ closeGameMargin })}
          hint="How close counts for Close games only"
        />
      </Panel>
    </fieldset>
  );
}
