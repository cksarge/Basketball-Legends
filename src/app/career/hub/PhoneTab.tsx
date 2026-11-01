"use client";
import { useState } from "react";
import type { Career, ScheduledGame } from "@/career/types";
import { formatDate } from "@/career/format";
import { isRivalGame, personality } from "@/career/story/engine";
import { Button, Panel, Segmented } from "@/ui/kit";
import { answerAction, readThreadAction, replyAction, skipStoryAction } from "./actions";

/** Quick replies, so a text never needs typing with a controller in your hands. */
const REPLIES = ["Thanks.", "On it.", "Appreciate you.", "Love you too."];

/** Press conferences and decisions waiting on you. */
export function StoryCards({ career }: { career: Career }) {
  const [reply, setReply] = useState<string | null>(null);
  const waiting = career.story?.pending ?? [];
  const ev = waiting[0];
  return (
    <>
      {reply && (
        <p role="status" className="rounded-[var(--radius-chip)] bg-deck p-3 text-sm text-amber ring-1 ring-line">
          {reply}
        </p>
      )}
      {ev && (
        <Panel title={ev.title}>
          <p className="text-sm text-steel">
            {formatDate(ev.date)}
            {ev.from ? ` · ${ev.from}` : ""}
            {waiting.length > 1 ? ` · ${waiting.length - 1} more waiting` : ""}
          </p>
          <p className="my-3 font-semibold">{ev.body}</p>
          <ul aria-label="Your answer" className="flex flex-col gap-2">
            {ev.choices.map((c, i) => (
              <li key={c.text}>
                <button
                  className="w-full rounded-[var(--radius-chip)] bg-deck-2 px-4 py-2.5 text-left ring-1 ring-line hover:ring-amber focus-visible:ring-amber"
                  onClick={async () => setReply((await answerAction(ev.id, i)) || null)}
                >
                  {c.text}
                </button>
              </li>
            ))}
          </ul>
          <button className="mt-2 text-sm text-steel underline" onClick={() => skipStoryAction(ev.id)}>
            {ev.kind === "press" ? "Walk past the microphones" : "Let it go"}
          </button>
        </Panel>
      )}
    </>
  );
}

export function RivalTag({ career, game }: { career: Career; game: ScheduledGame }) {
  if (!isRivalGame(career, game)) return null;
  const r = career.story!.rival;
  return (
    <p className="mb-1 text-sm font-semibold text-amber">
      Rival game: {r.name} ({r.wins}-{r.losses} against them so far)
    </p>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-navy">
        <div className="h-full bg-amber" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

/** A scale from one trait to its opposite. */
function Scale({ left, right, value }: { left: string; right: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm text-steel">
        <span>{left}</span>
        <span>{right}</span>
      </div>
      <div className="relative h-2 rounded-full bg-navy" role="img" aria-label={`${left} to ${right}: ${Math.round(value * 100)}`}>
        <div className="absolute -top-0.5 h-3 w-3 -translate-x-1/2 rounded-full bg-amber" style={{ left: `${(value + 1) * 50}%` }} />
      </div>
    </div>
  );
}

/** Your phone: texts, the social feed, and how people see you. */
export function PhoneTab({ career }: { career: Career }) {
  const s = career.story;
  const [view, setView] = useState<"texts" | "social">("texts");
  const names = Object.keys(s?.threads ?? {});
  const [picked, setPicked] = useState<string | null>(null);
  if (!s) return <Panel>Your phone is quiet for now.</Panel>;
  const who = picked && s.threads[picked] ? picked : (names[0] ?? null);
  const thread = who ? s.threads[who] : [];
  const open = (name: string) => {
    setPicked(name);
    void readThreadAction(name);
  };
  const me = personality(career);
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <Panel>
        <div className="mb-4">
          <Segmented
            label="Phone"
            value={view}
            options={[
              { value: "texts", label: `Texts${s.unread.length ? ` (${s.unread.length})` : ""}` },
              { value: "social", label: "Social" },
            ]}
            onChange={setView}
          />
        </div>
        {view === "texts" ? (
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <ul aria-label="Conversations" className="flex flex-col gap-1">
              {names.map((n) => (
                <li key={n}>
                  <button
                    onClick={() => open(n)}
                    className={`w-full rounded-[var(--radius-chip)] px-3 py-2 text-left text-sm ${n === who ? "bg-amber text-navy" : "bg-deck-2 hover:text-amber"}`}
                  >
                    {n}
                    {s.unread.includes(n) && <span className="ml-1 text-bad">●</span>}
                  </button>
                </li>
              ))}
            </ul>
            <div>
              <ol aria-label={who ? `Texts with ${who}` : "Texts"} className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
                {thread.map((t, i) => (
                  <li
                    key={i}
                    className={`max-w-[85%] rounded-[var(--radius-chip)] px-3 py-2 text-sm ${t.mine ? "self-end bg-amber text-navy" : "self-start bg-deck-2"}`}
                  >
                    {t.text}
                    <span className={`block text-xs ${t.mine ? "text-navy/70" : "text-steel"}`}>{formatDate(t.date)}</span>
                  </li>
                ))}
              </ol>
              {who && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {REPLIES.map((r) => (
                    <Button key={r} variant="ghost" onClick={() => replyAction(who, r)}>
                      {r}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : s.feed.length === 0 ? (
          <p className="text-steel">Nobody&apos;s talking about you yet. Give them a reason.</p>
        ) : (
          <ul aria-label="Social feed" className="flex max-h-[32rem] flex-col gap-3 overflow-y-auto pr-1">
            {s.feed.map((p, i) => (
              <li key={i} className="border-t border-line/60 pt-2">
                <p className="text-sm">
                  <span className="font-semibold">{p.author}</span> <span className="text-steel">{p.handle}</span>
                </p>
                <p>{p.text}</p>
                <p className="text-xs text-steel">
                  {formatDate(p.date)} · ♥ {p.likes.toLocaleString("en-US")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="flex flex-col gap-5">
        <Panel title="Your reputation">
          <p className="mb-3 font-semibold text-amber">{me.label}</p>
          <div className="mb-4 flex flex-col gap-3">
            <Scale left="Humble" right="Confident" value={me.confident} />
            <Scale left="Team-first" right="Star" value={me.star} />
          </div>
          <div className="flex flex-col gap-2">
            <Meter label="Fans" value={s.fans} />
            <Meter label="Media" value={s.media} />
            <Meter label="Teammates" value={s.teammates} />
            <Meter label="Coaches" value={s.coach} />
          </div>
          <p className="mt-3 text-xs text-steel">
            Fans bring bigger endorsements, the media moves your draft stock, and coaches and teammates affect your minutes and chemistry.
          </p>
        </Panel>
      </div>
    </div>
  );
}
