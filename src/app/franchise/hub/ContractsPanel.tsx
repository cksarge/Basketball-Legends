"use client";
import { useState } from "react";
import { fullName } from "@/engine/player";
import type { Player } from "@/engine/types";
import { moneyM } from "@/franchise/pro/cap";
import { expiring, pendingOptions, setTeamOption } from "@/franchise/pro/contracts";
import { staffHandles } from "@/franchise/pro/freeAgency";
import { marketValue } from "@/franchise/pro/market";
import type { Franchise } from "@/franchise/types";
import { Button, Panel } from "@/ui/kit";
import { useRosterMove } from "./actions";
import { NegotiateDialog } from "./NegotiateDialog";

/** Team options and the players whose deals are ending, before free agency opens. */
export function ContractsPanel({ f }: { f: Franchise }) {
  const move = useRosterMove();
  const [talk, setTalk] = useState<Player | null>(null);
  const options = pendingOptions(f, f.teamId);
  const ending = expiring(f, f.teamId);
  return (
    <>
      <Panel title="Team options">
        {options.length === 0 ? (
          <p className="text-steel">You have no team options to decide.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {options.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {fullName(p)}: {moneyM(p.contract!.salary)}, worth about {moneyM(marketValue(f, p))}
                </span>
                <span className="flex gap-2">
                  <Button variant="secondary" onClick={() => move(`Picked up ${fullName(p)}'s option`, (x) => setTeamOption(x, p.id, true))}>
                    Exercise
                  </Button>
                  <Button variant="ghost" onClick={() => move(`Declined ${fullName(p)}'s option`, (x) => setTeamOption(x, p.id, false))}>
                    Decline
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {options.length > 0 && (
          <Button variant="secondary" className="mt-3" onClick={() => move("Staff decided the options", staffHandles)}>
            Let your staff decide
          </Button>
        )}
      </Panel>
      <Panel title="Expiring deals">
        {ending.length === 0 ? (
          <p className="text-steel">Nobody&apos;s deal ends this summer.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {ending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {fullName(p)}: {moneyM(p.contract!.salary)}, worth about {moneyM(marketValue(f, p))}
                </span>
                <Button variant="secondary" onClick={() => setTalk(p)}>
                  Re-sign
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {talk && <NegotiateDialog f={f} player={talk} kind="extend" onClose={() => setTalk(null)} />}
    </>
  );
}
