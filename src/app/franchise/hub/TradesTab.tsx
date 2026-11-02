"use client";
import { useMemo, useState } from "react";
import { formatDate } from "@/career/format";
import { proCalendar } from "@/career/calendar";
import type { Team } from "@/engine/types";
import { askFor, refreshOffers, type TradeOffer } from "@/franchise/pro/tradeAi";
import { applyTrade, tradeOpen, tradeProblems, type Trade, type TradeAsset } from "@/franchise/pro/trades";
import type { Franchise } from "@/franchise/types";
import { useFranchiseSim } from "@/state/franchiseSim";
import { Button, Panel } from "@/ui/kit";
import { useRosterMove } from "./actions";
import { TradeBuilder, dealLines } from "./TradeBuilder";

const NO_THIRD = "";
const RECENT_TRADES = 8;

function DealSummary({ f, t, teams }: { f: Franchise; t: Trade; teams: Team[] }) {
  return (
    <ul className="text-sm">
      {dealLines(f, t, teams).map((l) => (
        <li key={l.team}>
          <span className="text-steel">{l.team} get:</span> {l.gets.join(", ") || "nothing"}
        </li>
      ))}
    </ul>
  );
}

/** Offers from other teams, with a button to take one. */
export function OffersList({ f, teams, offers }: { f: Franchise; teams: Team[]; offers: TradeOffer[] }) {
  const move = useRosterMove();
  const running = useFranchiseSim((s) => s.running);
  return (
    <ul className="flex flex-col gap-3">
      {offers.map((o) => (
        <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
          <DealSummary f={f} t={o.trade} teams={teams} />
          <Button variant="secondary" disabled={running} onClick={() => move("Accepted a trade offer", (x) => applyTrade(x, o.trade))}>
            Accept
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function TradesTab({ f, teams }: { f: Franchise; teams: Team[] }) {
  const move = useRosterMove();
  const running = useFranchiseSim((s) => s.running);
  const others = useMemo(() => teams.filter((t) => t.id !== f.teamId).sort((a, b) => a.name.localeCompare(b.name)), [teams, f.teamId]);
  const [partner, setPartner] = useState(others[0].id);
  const [third, setThird] = useState(NO_THIRD);
  const [deal, setDeal] = useState<TradeAsset[]>([]);
  const [reply, setReply] = useState<string | null>(null);
  const [found, setFound] = useState<Trade[] | null>(null);
  const partners = third ? [partner, third] : [partner];
  const pickTeams = (next: string, nextThird: string) => {
    setPartner(next);
    setThird(nextThird === next ? NO_THIRD : nextThird);
    setDeal([]);
    setReply(null);
    setFound(null);
  };
  const open = tradeOpen(f);
  const wanted = deal.filter((a) => a.to === f.teamId && a.from === partner);
  const select = "rounded-[var(--radius-chip)] bg-navy px-3 py-2 text-net ring-1 ring-line";
  return (
    <div className="flex flex-col gap-5">
      {!open && (
        <Panel>
          <p role="status" className="font-semibold text-amber">
            The trade deadline has passed. Trades reopen when the Finals end.
          </p>
        </Panel>
      )}
      <Panel title="Trade partners">
        <p className="mb-3 text-sm text-steel">The deadline is {formatDate(proCalendar(f.season.year).tradeDeadline)}.</p>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-sm text-steel">
            Trade with
            <select aria-label="Trade with" className={select} value={partner} onChange={(e) => pickTeams(e.target.value, third)}>
              {others.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-steel">
            Third team
            <select aria-label="Third team" className={select} value={third} onChange={(e) => pickTeams(partner, e.target.value)}>
              <option value={NO_THIRD}>None</option>
              {others
                .filter((t) => t.id !== partner)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </Panel>
      <TradeBuilder f={f} teams={teams} partners={partners} deal={deal} onDeal={setDeal} reply={reply} onReply={setReply} />
      <Panel title="Trade finder">
        <p className="mb-3 text-sm text-steel">Tick what you want from the first team in the builder, and the finder looks for what you could send back.</p>
        <Button variant="secondary" disabled={!wanted.length || running} onClick={() => setFound(askFor(f, wanted))}>
          Find a deal
        </Button>
        {found && found.length === 0 && <p className="mt-3 text-steel">Nothing you have gets this done.</p>}
        {found && found.length > 0 && (
          <ul className="mt-3 flex flex-col gap-3">
            {found.map((t, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                <DealSummary f={f} t={t} teams={teams} />
                <Button
                  variant="secondary"
                  onClick={() => {
                    setThird(NO_THIRD);
                    setDeal(t.assets);
                    setFound(null);
                    setReply(null);
                  }}
                >
                  Load deal
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Trade block">
        {f.tradeBlock.length === 0 ? (
          <p className="text-steel">Put players on the block from the Roster tab, and teams will call.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-steel">
              On the block:{" "}
              {f.tradeBlock
                .filter((id) => f.players[id])
                .map((id) => `${f.players[id].firstName} ${f.players[id].lastName}`)
                .join(", ")}
            </p>
            <Button variant="secondary" disabled={running || !open} onClick={() => move(null, refreshOffers)}>
              Ask around
            </Button>
          </>
        )}
        {f.tradeOffers.filter((o) => !tradeProblems(f, o.trade).length).length > 0 && (
          <div className="mt-3">
            <OffersList f={f} teams={teams} offers={f.tradeOffers.filter((o) => !tradeProblems(f, o.trade).length)} />
          </div>
        )}
      </Panel>
      {f.tradeLog.length > 0 && (
        <Panel title="Around the league">
          <ul className="flex flex-col gap-1 text-sm">
            {f.tradeLog
              .slice(-RECENT_TRADES)
              .reverse()
              .map((t, i) => (
                <li key={i}>
                  {formatDate(t.date)}: {t.teams.map((id) => teams.find((x) => x.id === id)?.name).join(" and ")} made a trade
                </li>
              ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
