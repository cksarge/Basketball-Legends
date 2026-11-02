"use client";
import { fullName, playerOvr } from "@/engine/player";
import type { Player, Team } from "@/engine/types";
import { moneyM } from "@/franchise/pro/cap";
import { shownOvr } from "@/franchise/pro/scouting";
import { tradeReply } from "@/franchise/pro/tradeAi";
import { applyTrade, signAndTradeOptions, tradeProblems, type Trade, type TradeAsset } from "@/franchise/pro/trades";
import type { Franchise } from "@/franchise/types";
import { useFranchiseSim } from "@/state/franchiseSim";
import { Button, Panel } from "@/ui/kit";
import { useRosterMove } from "./actions";

const pickName = (id: string, teams: Team[]) => {
  const [, year, round, ...rest] = id.split("-");
  const abbrev = teams.find((t) => t.id === rest.join("-"))?.abbrev ?? "";
  return `${year} round ${round} (${abbrev})`;
};

/** A deal's pieces in words. */
export const assetName = (f: Franchise, a: TradeAsset, teams: Team[]) => (a.kind === "pick" ? pickName(a.id, teams) : fullName(f.players[a.id]));

export function dealLines(f: Franchise, t: Trade, teams: Team[]) {
  return t.teams.map((id) => ({
    team: teams.find((x) => x.id === id)?.name ?? id,
    gets: t.assets.filter((a) => a.to === id).map((a) => assetName(f, a, teams)),
  }));
}

/** Team ids read as names in messages. */
export function named(message: string, teams: Team[]) {
  return teams.reduce((m, t) => m.split(t.id).join(t.name), message);
}

function TeamColumn({
  f,
  team,
  teams,
  assets,
  onToggle,
  to,
}: {
  f: Franchise;
  team: Team;
  teams: Team[];
  assets: TradeAsset[];
  onToggle: (a: TradeAsset) => void;
  to: string;
}) {
  const players = f.rosters[team.id].map((id) => f.players[id]).sort((a, b) => playerOvr(b) - playerOvr(a));
  const picks = f.picks.filter((p) => p.ownerId === team.id && !f.draft.results.some((r) => r.pickId === p.id));
  const on = (id: string) => assets.some((a) => a.id === id);
  const row = (id: string, label: string, asset: TradeAsset) => (
    <li key={id}>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={on(id)} onChange={() => onToggle(asset)} />
        <span>{label}</span>
      </label>
    </li>
  );
  const playerLine = (p: Player) => `${fullName(p)}, ${p.pos} ${shownOvr(p)}, ${p.age}, ${moneyM(p.contract?.salary ?? 0)} × ${p.contract?.years ?? 0}`;
  return (
    <fieldset className="min-w-0 flex-1">
      <legend className="mb-1 font-display text-xl font-bold">{team.name}</legend>
      <ul className="scrollbar-thin flex max-h-96 flex-col gap-1 overflow-y-auto text-sm">
        {players.map((p) => row(p.id, playerLine(p), { kind: "player", id: p.id, from: team.id, to }))}
        {picks.map((p) => row(p.id, pickName(p.id, teams), { kind: "pick", id: p.id, from: team.id, to }))}
        {signAndTradeOptions(f, team.id).map((o) => {
          const signAndTrade = { salary: o.salary, years: o.years };
          return row(o.id, `Sign-and-trade: ${fullName(f.players[o.id])}, ${moneyM(o.salary)} × ${o.years}`, {
            kind: "player",
            id: o.id,
            from: team.id,
            to,
            signAndTrade,
          });
        })}
      </ul>
    </fieldset>
  );
}

/** One column per team: tick what moves, see whether it's legal, and propose it. */
export function TradeBuilder({
  f,
  teams,
  partners,
  deal,
  onDeal,
  reply,
  onReply,
}: {
  f: Franchise;
  teams: Team[];
  partners: string[];
  deal: TradeAsset[];
  onDeal: (assets: TradeAsset[]) => void;
  reply: string | null;
  onReply: (note: string | null) => void;
}) {
  const move = useRosterMove();
  const running = useFranchiseSim((s) => s.running);
  const ids = [f.teamId, ...partners];
  const trade: Trade = { teams: ids, assets: deal };
  const problems = deal.length ? tradeProblems(f, trade) : [];
  const toggle = (a: TradeAsset) => {
    onReply(null);
    onDeal(deal.some((x) => x.id === a.id) ? deal.filter((x) => x.id !== a.id) : [...deal, a]);
  };
  const setTo = (id: string, to: string) => onDeal(deal.map((a) => (a.id === id ? { ...a, to } : a)));
  const propose = async () => {
    const answer = tradeReply(f, trade);
    onReply(named(answer.note, teams));
    if (!answer.accepted) return;
    const partner = teams.find((t) => t.id === partners[0])?.name ?? "";
    if (await move(`Traded with ${partner}`, (x) => applyTrade(x, trade))) {
      onDeal([]);
      onReply("Trade done.");
    }
  };
  const totals = (id: string) => {
    const sum = (list: TradeAsset[]) =>
      list.reduce((n, a) => n + (a.kind !== "player" ? 0 : (a.signAndTrade?.salary ?? f.players[a.id].contract?.salary ?? 0)), 0);
    return `${moneyM(sum(deal.filter((a) => a.to === id)))} in, ${moneyM(sum(deal.filter((a) => a.from === id)))} out`;
  };
  return (
    <Panel title="Trade builder">
      <div className="flex flex-col gap-4 md:flex-row">
        {ids.map((id) => (
          <TeamColumn
            key={id}
            f={f}
            team={teams.find((t) => t.id === id)!}
            teams={teams}
            assets={deal}
            onToggle={toggle}
            to={id === f.teamId ? partners[0] : f.teamId}
          />
        ))}
      </div>
      {deal.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 text-sm">
          {ids.map((id) => (
            <p key={id}>
              <span className="text-steel">{teams.find((t) => t.id === id)?.name}:</span> {totals(id)}
            </p>
          ))}
          {ids.length > 2 &&
            deal.map((a) => (
              <label key={a.id} className="flex items-center gap-2">
                {assetName(f, a, teams)} goes to
                <select
                  value={a.to}
                  onChange={(e) => setTo(a.id, e.target.value)}
                  className="rounded-[var(--radius-chip)] bg-navy px-2 py-1 text-net ring-1 ring-line"
                >
                  {ids
                    .filter((id) => id !== a.from)
                    .map((id) => (
                      <option key={id} value={id}>
                        {teams.find((t) => t.id === id)?.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
        </div>
      )}
      {problems.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-sm text-amber" aria-label="Problems with this deal">
          {problems.map((p) => (
            <li key={p}>{named(p, teams)}</li>
          ))}
        </ul>
      )}
      {reply && (
        <p role="status" className="mt-3 font-semibold">
          {reply}
        </p>
      )}
      <Button className="mt-3" disabled={running || !deal.length || problems.length > 0} onClick={propose}>
        Propose trade
      </Button>
    </Panel>
  );
}
