"use client";
import { useMemo } from "react";
import { formatDate } from "@/career/format";
import { draftCalendar } from "@/career/calendar";
import { heightStr } from "@/engine/player";
import type { Player, Team } from "@/engine/types";
import { currentPick, makePick, simDraftToEnd, simToUserPick } from "@/franchise/pro/draft";
import { MAX_ASSIGNED, assignScout, prospectRange } from "@/franchise/pro/scouting";
import { draftDayOffers } from "@/franchise/pro/tradeAi";
import type { Franchise } from "@/franchise/types";
import { useFranchiseSim } from "@/state/franchiseSim";
import { useFranchise } from "@/state/franchiseStore";
import { Button, Panel } from "@/ui/kit";
import { SortTable, type Column } from "@/ui/SortTable";
import { OffersList } from "./TradesTab";

const middle = (r: [number, number]) => (r[0] + r[1]) / 2;

/** Scout the class all season, and run the draft when it comes. */
export function DraftTab({ f, teams }: { f: Franchise; teams: Team[] }) {
  const update = useFranchise((s) => s.update);
  const running = useFranchiseSim((s) => s.running);
  const { draft } = f;
  const pick = currentPick(f);
  const live = f.offseason?.step === "draft" && !!pick;
  const myTurn = live && pick?.ownerId === f.teamId;
  const offers = useMemo(() => (myTurn ? draftDayOffers(f) : []), [f, myTurn]);
  const taken = new Set(draft.results.map((r) => r.playerId));
  const rows = draft.prospects.filter((p) => !taken.has(p.id));
  const abbrev = (id: string) => teams.find((t) => t.id === id)?.abbrev ?? "";
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "";
  const playerName = (id: string) => {
    const p = f.players[id];
    return p ? `${p.firstName} ${p.lastName}` : "";
  };
  const columns: Column<Player>[] = [
    { key: "name", label: "Prospect", text: true, value: (p) => `${p.lastName} ${p.firstName}`, render: (p) => `${p.firstName} ${p.lastName}` },
    { key: "pos", label: "Pos", text: true, value: (p) => p.pos },
    { key: "age", label: "Age", value: (p) => p.age },
    { key: "ht", label: "Ht", value: (p) => p.heightIn, render: (p) => heightStr(p.heightIn) },
    { key: "ovr", label: "OVR", value: (p) => middle(prospectRange(f, p).ovr), render: (p) => prospectRange(f, p).ovr.join("-") },
    { key: "pot", label: "POT", value: (p) => middle(prospectRange(f, p).pot), render: (p) => prospectRange(f, p).pot.join("-") },
    {
      key: "act",
      label: myTurn ? "Pick" : "Scout",
      text: true,
      value: (p) => (draft.assigned.includes(p.id) ? 0 : 1),
      render: (p) =>
        myTurn ? (
          <Button variant="secondary" className="!px-3 !py-1 !text-base" onClick={() => update((x) => makePick(x, p.id))}>
            Draft
          </Button>
        ) : (
          <input
            type="checkbox"
            aria-label={`Scout ${p.firstName} ${p.lastName}`}
            checked={draft.assigned.includes(p.id)}
            disabled={running || (!draft.assigned.includes(p.id) && draft.assigned.length >= MAX_ASSIGNED)}
            onChange={(e) => update((x) => assignScout(x, p.id, e.target.checked), [])}
          />
        ),
    },
  ];
  return (
    <div className="flex flex-col gap-5">
      {live && pick && (
        <Panel title={`On the clock: pick ${draft.results.length + 1}`}>
          <p className="mb-3">{myTurn ? "You're on the clock." : `${name(pick.ownerId)} are on the clock.`}</p>
          <div className="flex flex-wrap gap-2">
            {!myTurn && <Button onClick={() => update(simToUserPick)}>Sim to my pick</Button>}
            <Button variant="secondary" onClick={() => update(simDraftToEnd)}>
              Sim the draft
            </Button>
          </div>
        </Panel>
      )}
      {myTurn && offers.length > 0 && (
        <Panel title="Calls about your pick">
          <OffersList f={f} teams={teams} offers={offers} />
        </Panel>
      )}
      {draft.results.length > 0 && (
        <Panel title="Draft results">
          <ol className="scrollbar-thin flex max-h-72 flex-col gap-1 overflow-y-auto">
            {draft.results.map((r, i) => (
              <li key={r.pickId} className={r.teamId === f.teamId ? "font-semibold text-amber" : ""}>
                {i + 1}. {abbrev(r.teamId)}: {playerName(r.playerId)}
              </li>
            ))}
          </ol>
        </Panel>
      )}
      {rows.length > 0 && !(f.offseason && !pick && draft.results.length) && (
        <Panel title={`The ${draft.year} class`}>
          <p className="mb-2 text-sm text-steel">
            The draft is {formatDate(draftCalendar(draft.year).draft)}. Your scouts follow up to {MAX_ASSIGNED} prospects closely ({draft.assigned.length}{" "}
            chosen). Ranges narrow each week, and the truth stays uncertain until a player has played.
          </p>
          <SortTable label="Draft class" rows={rows} columns={columns} rowKey={(p) => p.id} initial="ovr" />
        </Panel>
      )}
    </div>
  );
}
