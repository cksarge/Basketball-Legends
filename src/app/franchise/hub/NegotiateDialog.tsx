"use client";
import { useEffect, useRef, useState } from "react";
import { fullName } from "@/engine/player";
import type { Player } from "@/engine/types";
import { rightsLimit, moneyM } from "@/franchise/pro/cap";
import { extendContract } from "@/franchise/pro/contracts";
import { placeBid, signNow, withdrawBid } from "@/franchise/pro/freeAgency";
import { askingPrice, mood, negotiate, recordTalk, type NegotiationReply, type Offer } from "@/franchise/pro/market";
import { capRules } from "@/franchise/pro/rules";
import type { Franchise } from "@/franchise/types";
import { Button, Toggle } from "@/ui/kit";
import { useRosterMove } from "./actions";

export type TalkKind = "extend" | "bid" | "sign";

const MAX_YEARS = 5;
const TITLE: Record<TalkKind, string> = { extend: "Re-sign", bid: "Bid on", sign: "Sign" };
const moodWord = (n: number) => (n >= 0.66 ? "Keen" : n >= 0.4 ? "Open" : "Unsure");

/** Talks with one player: an extension, a bid for the rounds, or a signing on the open market. */
export function NegotiateDialog({ f, player, kind, onClose }: { f: Franchise; player: Player; kind: TalkKind; onClose: () => void }) {
  const move = useRosterMove();
  const ref = useRef<HTMLDialogElement>(null);
  const ask = askingPrice(f, player, f.teamId);
  const existing = f.freeAgency?.bids.find((b) => b.playerId === player.id && b.teamId === f.teamId);
  const [salary, setSalary] = useState(+((existing?.salary ?? ask.salary) / 1e6).toFixed(2));
  const [years, setYears] = useState(existing?.years ?? ask.years);
  const [playerOption, setPlayerOption] = useState(false);
  const [teamOption, setTeamOption] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const feeling = mood(f, player, f.teamId);
  const offer: Offer = { teamId: f.teamId, salary: Math.round(salary * 100) * 10_000, years, playerOption, teamOption };

  const say = (reply: NegotiationReply) => {
    if (reply.kind === "counter") {
      setSalary(+(reply.salary / 1e6).toFixed(2));
      setYears(reply.years);
    }
    setMessage(reply.kind === "accept" ? "Deal." : reply.kind === "counter" ? `${reply.note} He'd take ${moneyM(reply.salary)}.` : reply.note);
  };

  const submit = async () => {
    if (kind === "extend") {
      const limit = rightsLimit(f, player, f.teamId);
      if (limit === 0) return setMessage("You don't hold his veteran rights yet.");
      if (offer.salary > limit) return setMessage(`Veteran rights let you pay him up to ${moneyM(limit)}.`);
      const reply = negotiate(f, player, offer);
      say(reply);
      if (reply.kind === "accept") await move(`Re-signed ${fullName(player)}`, (x) => extendContract(x, player.id, offer.salary, offer.years));
      else await move(null, (x) => recordTalk(x, player.id));
      if (reply.kind === "accept") ref.current?.close();
      return;
    }
    const attempt = kind === "bid" ? placeBid : signNow;
    let reason: string | null = null;
    await move(kind === "bid" ? null : `Signed ${fullName(player)}`, (x) => {
      const r = attempt(x, player.id, offer);
      if (!r.ok) reason = r.reason;
      return r.ok ? r.franchise : x;
    });
    if (reason) setMessage(reason);
    else ref.current?.close();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-[var(--radius-chip)] bg-deck p-5 text-net ring-1 ring-line backdrop:bg-black/60"
    >
      <h3 className="mb-1 font-display text-2xl font-black">
        {TITLE[kind]} {fullName(player)}
      </h3>
      <p className="mb-3 text-sm text-steel">
        Asking {moneyM(ask.salary)} for {ask.years} year{ask.years === 1 ? "" : "s"}. {moodWord(feeling.score)} about your team: role{" "}
        {Math.round(feeling.parts.role * 100)}, winning {Math.round(feeling.parts.winning * 100)}, money {Math.round(feeling.parts.money * 100)}, loyalty{" "}
        {Math.round(feeling.parts.loyalty * 100)}.
      </p>
      <div className="mb-3 flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm text-steel">
          Salary ($M per year)
          <input
            type="number"
            min={capRules(f.cap).minSalary / 1e6}
            step={0.1}
            value={salary}
            onChange={(e) => setSalary(+e.target.value)}
            className="w-32 rounded-[var(--radius-chip)] bg-navy px-3 py-2 text-net ring-1 ring-line"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-steel">
          Years
          <select
            value={years}
            onChange={(e) => setYears(+e.target.value)}
            className="rounded-[var(--radius-chip)] bg-navy px-3 py-2 text-net ring-1 ring-line"
          >
            {Array.from({ length: MAX_YEARS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Toggle label="Player option in the last year" checked={playerOption} onChange={setPlayerOption} />
      <Toggle label="Team option in the last year" checked={teamOption} onChange={setTeamOption} />
      {message && (
        <p role="status" className="my-3 font-semibold text-amber">
          {message}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={submit}>{kind === "bid" ? "Place bid" : "Make offer"}</Button>
        {existing && (
          <Button
            variant="secondary"
            onClick={async () => {
              await move(null, (x) => withdrawBid(x, player.id));
              ref.current?.close();
            }}
          >
            Withdraw bid
          </Button>
        )}
        <Button variant="ghost" onClick={() => ref.current?.close()}>
          Close
        </Button>
      </div>
    </dialog>
  );
}
