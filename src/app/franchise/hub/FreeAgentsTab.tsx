"use client";
import { useState } from "react";
import { fullName, playerOvr } from "@/engine/player";
import type { Player, Position } from "@/engine/types";
import { moneyM } from "@/franchise/pro/cap";
import { nextRound } from "@/franchise/pro/freeAgency";
import { askingPrice, marketValue, mood } from "@/franchise/pro/market";
import { claimWaiver, lowDealOpen, signDev, signTwoWay } from "@/franchise/pro/rosterMoves";
import { shownOvr } from "@/franchise/pro/scouting";
import type { Franchise } from "@/franchise/types";
import { useFranchiseSim } from "@/state/franchiseSim";
import { Button, Panel, Segmented } from "@/ui/kit";
import { SortTable, type Column } from "@/ui/SortTable";
import { useRosterMove } from "./actions";
import { NegotiateDialog } from "./NegotiateDialog";

const small = "!px-3 !py-1 !text-base";
const FILTERS: ("All" | Position)[] = ["All", "PG", "SG", "SF", "PF", "C"];
const STAGE: Record<string, string> = {
  moratorium: "The moratorium runs until July 6. Place your bids, then start round one.",
  bidding: "Bidding rounds are on. Players with a good enough offer sign each round, and they get less picky as rounds pass.",
  open: "The bidding rounds are over. Anyone left can sign now, and their asks fall as the season goes on.",
};

/** The market: who's out there, what they want and what you've bid. */
export function FreeAgentsTab({ f }: { f: Franchise }) {
  const move = useRosterMove();
  const running = useFranchiseSim((s) => s.running);
  const [pos, setPos] = useState<"All" | Position>("All");
  const [talk, setTalk] = useState<Player | null>(null);
  const st = f.freeAgency;
  const bidding = st && st.stage !== "open";
  const bidOf = (id: string) => st?.bids.find((b) => b.playerId === id && b.teamId === f.teamId);
  const rows = f.freeAgents.map((id) => f.players[id]).filter((p) => pos === "All" || p.pos === pos);
  const columns: Column<Player>[] = [
    { key: "name", label: "Player", text: true, value: (p) => `${p.lastName} ${p.firstName}`, render: fullName },
    { key: "pos", label: "Pos", text: true, value: (p) => p.pos },
    { key: "age", label: "Age", value: (p) => p.age },
    { key: "ovr", label: "OVR", value: playerOvr, render: shownOvr },
    { key: "value", label: "Value", value: (p) => marketValue(f, p), render: (p) => moneyM(marketValue(f, p)) },
    { key: "ask", label: "Ask", value: (p) => askingPrice(f, p, f.teamId).salary, render: (p) => moneyM(askingPrice(f, p, f.teamId).salary) },
    { key: "mood", label: "Mood", value: (p) => Math.round(mood(f, p, f.teamId).score * 100) },
    { key: "bid", label: "Your bid", value: (p) => bidOf(p.id)?.salary ?? 0, render: (p) => (bidOf(p.id) ? moneyM(bidOf(p.id)!.salary) : "") },
    {
      key: "act",
      label: "",
      text: true,
      value: () => 0,
      render: (p) => (
        <span className="flex gap-1">
          <Button variant="secondary" className={small} disabled={running} onClick={() => setTalk(p)}>
            {bidding ? "Bid" : "Sign"}
          </Button>
          {!bidding && lowDealOpen(f, p) && (
            <>
              <Button
                variant="ghost"
                className={small}
                disabled={running}
                onClick={() => move(`Signed ${fullName(p)} to a two-way deal`, (x) => signTwoWay(x, f.teamId, p.id))}
              >
                Two-way
              </Button>
              <Button
                variant="ghost"
                className={small}
                disabled={running}
                onClick={() => move(`Signed ${fullName(p)} to a developmental deal`, (x) => signDev(x, f.teamId, p.id))}
              >
                Dev
              </Button>
            </>
          )}
        </span>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-5">
      {st && (
        <Panel title={st.stage === "moratorium" ? "Moratorium" : st.stage === "bidding" ? `After round ${st.round}` : "Open market"}>
          <p className="text-steel">{STAGE[st.stage]}</p>
          {st.notices.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1" aria-label="Round results">
              {st.notices.map((n, i) => (
                <li key={i} className="font-semibold">
                  {n}
                </li>
              ))}
            </ul>
          )}
          {bidding && (
            <Button className="mt-3" onClick={() => move(null, nextRound)}>
              {st.stage === "moratorium" ? "Start round one" : `Run round ${st.round + 1}`}
            </Button>
          )}
        </Panel>
      )}
      {f.waivers.length > 0 && (
        <Panel title="On waivers">
          <ul className="flex flex-col gap-2">
            {f.waivers.map((w) => {
              const p = f.players[w.playerId];
              return (
                <li key={w.playerId} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {fullName(p)}, {shownOvr(p)}: {moneyM(p.contract!.salary)} for {p.contract!.years} year{p.contract!.years === 1 ? "" : "s"}
                  </span>
                  {w.fromTeamId !== f.teamId && (
                    <Button
                      variant="secondary"
                      className={small}
                      disabled={running}
                      onClick={() => move(`Claimed ${fullName(p)}`, (x) => claimWaiver(x, f.teamId, p.id))}
                    >
                      Claim
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
      <Panel title="Free agents">
        <div className="mb-3">
          <Segmented label="Position" value={pos} options={FILTERS.map((p) => ({ value: p, label: p }))} onChange={setPos} />
        </div>
        {rows.length === 0 ? (
          <p className="text-steel">Nobody&apos;s available.</p>
        ) : (
          <SortTable label="Free agents" rows={rows} columns={columns} rowKey={(p) => p.id} initial="value" filter={(p) => `${p.firstName} ${p.lastName}`} />
        )}
      </Panel>
      {talk && <NegotiateDialog f={f} player={talk} kind={bidding ? "bid" : "sign"} onClose={() => setTalk(null)} />}
    </div>
  );
}
