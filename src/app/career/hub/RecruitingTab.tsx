"use client";
import { useState } from "react";
import type { Team } from "@/engine/types";
import type { Career, Offer } from "@/career/types";
import { formatDate } from "@/career/format";
import { currentSeason, type HsContext } from "@/career/hs/season";
import { D1_GPA } from "@/career/hs/academics";
import { rankingText } from "@/career/hs/rankings";
import {
  VISIT_FOCUS,
  canReclassify,
  contactDate,
  cumulativeGpa,
  earlySigning,
  lateSigning,
  liveOffers,
  walkOnOptions,
  type VisitFocus,
} from "@/career/recruiting";
import { TeamLogo } from "@/ui/TeamLogo";
import { Button, Panel, Segmented } from "@/ui/kit";
import { toast } from "@/ui/Toaster";
import { chooseCollegeAction, commitAction, decommitAction, favoriteAction, reclassifyAction, visitAction } from "./actions";

const STATUS_LABEL: Record<Offer["status"], string> = {
  interested: "Interested",
  offered: "Offer",
  committed: "Committed",
  signed: "Signed",
  withdrawn: "Withdrawn",
};
const STATUS_STYLE: Record<Offer["status"], string> = {
  interested: "bg-deck-2 text-steel ring-line",
  offered: "bg-amber/15 text-amber ring-amber/50",
  committed: "bg-good/15 text-good ring-good/50",
  signed: "bg-good/15 text-good ring-good/50",
  withdrawn: "bg-bad/10 text-bad ring-bad/40",
};

export const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : n ? `$${n}` : "—");

function confName(t: Team, ctx: HsContext) {
  const c = ctx.conferences?.get(t.conferenceId);
  return c?.short ?? c?.name ?? "";
}

function Meter({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="flex items-center gap-2" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-2 w-20 overflow-hidden rounded-full bg-navy ring-1 ring-line">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${value}%` }} />
      </div>
      <span className="w-7 text-right text-xs tabular-nums text-steel">{value}</span>
    </div>
  );
}

type Filter = "all" | "offers" | "favorites";

export function RecruitingTab({ career, ctx }: { career: Career; ctx: HsContext }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [visiting, setVisiting] = useState<string | null>(null);
  const [story, setStory] = useState<{ teamId: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReclass, setConfirmReclass] = useState(false);
  const s = currentSeason(career);
  const rec = career.recruiting;
  const gpa = cumulativeGpa(career);
  const opens = contactDate(career.startYear);
  const colleges = ctx.collegeById ?? new Map<string, Team>();
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const offers = (rec?.offers ?? [])
    .filter((o) => colleges.has(o.teamId))
    .filter((o) => (filter === "offers" ? ["offered", "committed", "signed"].includes(o.status) : filter === "favorites" ? o.favorite : true))
    .sort((a, b) => order(a) - order(b) || b.myInterest - a.myInterest);
  const committed = rec?.committedTo ? colleges.get(rec.committedTo) : undefined;
  const chosen = rec?.college ? colleges.get(rec.college.teamId) : undefined;
  const visitsLeft = rec ? rec.visitsAllowed - rec.visitsUsed : 5;
  const offerCount = (rec?.offers ?? []).filter((o) => ["offered", "committed", "signed"].includes(o.status)).length;
  const senior = s?.grade === 12 || rec?.reclassified;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
      <div className="flex flex-col gap-5">
        <Panel title="Your recruitment">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-steel">Ranking</dt>
            <dd>{rankingText(s?.ranking)}</dd>
            <dt className="text-steel">Core GPA</dt>
            <dd>
              {gpa === null ? "No grades yet" : gpa.toFixed(2)}
              {gpa !== null && gpa < D1_GPA && (
                <span className="block text-bad">Below the {D1_GPA.toFixed(1)} Division I needs: D1 programs can&apos;t recruit you.</span>
              )}
            </dd>
            <dt className="text-steel">Offers</dt>
            <dd>{offerCount}</dd>
            <dt className="text-steel">Official visits</dt>
            <dd>
              {visitsLeft} of {rec?.visitsAllowed ?? 5} left
            </dd>
            <dt className="text-steel">Status</dt>
            <dd>
              {chosen
                ? `${rec?.college?.walkOn ? "Walking on at" : "Signed with"} ${chosen.name}`
                : rec?.signedDate && committed
                  ? `Signed with ${committed.name} (${formatDate(rec.signedDate)})`
                  : committed
                    ? `Committed to ${committed.name}`
                    : "Uncommitted"}
            </dd>
          </dl>
          {committed && !rec?.signedDate && s && (
            <p className="mt-3 text-sm text-steel">
              You sign your letter of intent on the early signing day ({formatDate(earlySigning(senior ? s.year : s.year + (12 - s.grade)))}) or the late one (
              {formatDate(lateSigning(senior ? s.year : s.year + (12 - s.grade)))}). Until then you can still decommit.
            </p>
          )}
        </Panel>
        {canReclassify(career) && (
          <Panel title="Reclassify">
            <p className="mb-3 text-sm">
              Top recruits with strong grades can finish their credits this spring and graduate a year early. You skip senior year and start college this fall,
              a year younger than everyone else.
            </p>
            {confirmReclass ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await reclassifyAction();
                      toast("Reclassified: you graduate this spring", "good");
                    })
                  }
                >
                  Yes, graduate early
                </Button>
                <Button variant="secondary" onClick={() => setConfirmReclass(false)}>
                  Not now
                </Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmReclass(true)}>
                Reclassify to the class of {(s?.year ?? 0) + 1}
              </Button>
            )}
          </Panel>
        )}
        {rec?.reclassified && <p className="text-sm text-steel">You reclassified: this is your last year of high school.</p>}
      </div>

      <Panel>
        {career.date < opens && !rec ? (
          <>
            <h2 className="mb-2 font-display text-2xl font-black">Recruiting opens {formatDate(opens)}</h2>
            <p className="text-steel">
              College coaches can start contacting you on June 15 after your sophomore year. Until then, play well on varsity, go to camps and AAU showcases,
              and keep your grades up: Division I schools need a {D1_GPA.toFixed(1)} core GPA.
            </p>
          </>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-2xl font-black">Programs</h2>
              <Segmented<Filter>
                label="Show"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "offers", label: "Offers" },
                  { value: "favorites", label: "Shortlist" },
                ]}
              />
            </div>
            {!offers.length && (
              <p className="text-steel">
                {filter === "favorites" ? "Tap the star next to a program to shortlist it." : "No programs in touch yet. Keep playing well and getting seen."}
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {offers.map((o) => {
                const t = colleges.get(o.teamId)!;
                const canVisit = !o.visited && visitsLeft > 0 && !rec?.signedDate && ["interested", "offered", "committed"].includes(o.status);
                return (
                  <li key={o.teamId} className="rounded-[var(--radius-chip)] bg-deck-2 p-3 ring-1 ring-line">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <button
                        aria-label={o.favorite ? `Remove ${t.name} from shortlist` : `Shortlist ${t.name}`}
                        aria-pressed={!!o.favorite}
                        onClick={() => favoriteAction(o.teamId)}
                        className={`text-xl ${o.favorite ? "text-amber" : "text-steel/60 hover:text-steel"}`}
                      >
                        {o.favorite ? "★" : "☆"}
                      </button>
                      <TeamLogo team={t} size={40} />
                      <div className="min-w-40 flex-1">
                        <p className="font-display text-xl font-black leading-tight">
                          {t.name} <span className="text-base font-bold text-steel">{t.nickname}</span>
                        </p>
                        <p className="text-xs text-steel">
                          {t.tier} · {confName(t, ctx)} · {t.city}, {t.state}
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${STATUS_STYLE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                      <div className="flex flex-col gap-1 text-xs">
                        <span className="flex items-center gap-2">
                          <span className="w-12 text-steel">Them</span>
                          <Meter value={o.interest} label={`${t.name}'s interest in you`} tone="bg-amber" />
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="w-12 text-steel">You</span>
                          <Meter value={o.myInterest} label={`Your interest in ${t.name}`} tone="bg-good" />
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                      <span className="text-steel">{o.role}</span>
                      {t.tier === "D1" && <span className="text-steel">NIL about {money(o.nil)}/yr</span>}
                      {o.visited && <span className="text-good">Visited</span>}
                      <span className="ml-auto flex flex-wrap gap-2">
                        {canVisit && (
                          <Button variant="secondary" className="!px-3 !py-1 !text-base" onClick={() => setVisiting(visiting === o.teamId ? null : o.teamId)}>
                            Official visit
                          </Button>
                        )}
                        {o.status === "offered" && !rec?.signedDate && (
                          <Button
                            className="!px-3 !py-1 !text-base"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await commitAction(o.teamId, ctx);
                                toast(`Committed to ${t.name}!`, "good");
                              })
                            }
                          >
                            Commit
                          </Button>
                        )}
                        {o.status === "committed" && !rec?.signedDate && (
                          <Button variant="secondary" className="!px-3 !py-1 !text-base" disabled={busy} onClick={() => run(() => decommitAction(ctx))}>
                            Decommit
                          </Button>
                        )}
                      </span>
                    </div>
                    {visiting === o.teamId && (
                      <div className="mt-3 border-t border-line pt-3">
                        <p className="mb-2 text-sm">
                          A weekend on campus at {t.name}. What do you spend the most time on? ({visitsLeft} visit{visitsLeft === 1 ? "" : "s"} left)
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {VISIT_FOCUS.map((f) => (
                            <button
                              key={f.id}
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  const text = await visitAction(o.teamId, f.id as VisitFocus, ctx);
                                  setVisiting(null);
                                  setStory({ teamId: o.teamId, text });
                                })
                              }
                              className="rounded-[var(--radius-chip)] bg-deck p-3 text-left ring-1 ring-line hover:ring-amber disabled:opacity-40"
                            >
                              <span className="block font-semibold">{f.label}</span>
                              <span className="block text-xs text-steel">{f.blurb}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {story?.teamId === o.teamId && (
                      <p className="mt-3 border-t border-line pt-3 text-sm" role="status">
                        {story.text}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel>
    </div>
  );
}

const order = (o: Offer) => ({ signed: 0, committed: 1, offered: 2, interested: 3, withdrawn: 4 })[o.status];

/** Graduation's college decision: sign with an offer or walk on somewhere. */
export function CollegeChoice({ career, ctx }: { career: Career; ctx: HsContext }) {
  const [busy, setBusy] = useState(false);
  const [showWalkOn, setShowWalkOn] = useState(false);
  const [allOffers, setAllOffers] = useState(false);
  const colleges = ctx.colleges ?? [];
  const byId = ctx.collegeById ?? new Map<string, Team>();
  const rec = career.recruiting;
  // your committed or signed school first, then the rest by how much you like them
  const offers = liveOffers(career)
    .filter((o) => byId.has(o.teamId))
    .sort((a, b) => order(a) - order(b));
  const shown = allOffers ? offers : offers.slice(0, 6);
  const signedWith = rec?.signedDate && rec.committedTo ? rec.committedTo : null;
  const walkOns = walkOnOptions(career, colleges);
  const chosen = rec?.college?.teamId;
  const pick = async (id: string) => {
    setBusy(true);
    try {
      await chooseCollegeAction(id, ctx);
    } finally {
      setBusy(false);
    }
  };
  const row = (t: Team, detail: string, label: string) => (
    <li key={t.id}>
      <button
        disabled={busy || (!!signedWith && signedWith !== t.id)}
        onClick={() => pick(t.id)}
        aria-pressed={chosen === t.id}
        className={`flex w-full items-center gap-3 rounded-[var(--radius-chip)] p-3 text-left ring-1 disabled:opacity-40 ${chosen === t.id ? "bg-amber/15 ring-amber" : "bg-deck-2 ring-line hover:ring-amber"}`}
      >
        <TeamLogo team={t} size={36} />
        <span className="flex-1">
          <span className="block font-display text-lg font-black leading-tight">{t.name}</span>
          <span className="block text-xs text-steel">
            {t.tier} · {confName(t, ctx)} · {detail}
          </span>
        </span>
        <span className="text-sm font-semibold text-amber">{chosen === t.id ? "Chosen" : label}</span>
      </button>
    </li>
  );
  return (
    <div>
      <p className="mb-2 font-semibold">Where are you playing next year?</p>
      {signedWith && <p className="mb-2 text-sm text-steel">Your letter of intent is binding: you&apos;re going to {byId.get(signedWith)?.name}.</p>}
      {offers.length > 0 ? (
        <ul className="mb-3 flex flex-col gap-2">
          {shown.map((o) => row(byId.get(o.teamId)!, `${o.role}${o.nil ? ` · NIL about ${money(o.nil)}/yr` : ""}`, "Sign"))}
        </ul>
      ) : null}
      {offers.length > shown.length && (
        <button className="mb-3 mr-4 text-sm text-steel underline" onClick={() => setAllOffers(true)}>
          Show all {offers.length} offers
        </button>
      )}
      {offers.length === 0 && (
        <p className="mb-3 text-sm text-steel">No scholarship offers. You can still walk on: make the team in practice and earn a scholarship later.</p>
      )}
      {!signedWith && walkOns.length > 0 && (
        <>
          {offers.length > 0 && !showWalkOn ? (
            <button className="mb-3 text-sm text-steel underline" onClick={() => setShowWalkOn(true)}>
              Or walk on somewhere instead
            </button>
          ) : (
            <ul className="mb-3 flex flex-col gap-2">{walkOns.map((t) => row(t, "Walk-on: no scholarship, earn your spot", "Walk on"))}</ul>
          )}
        </>
      )}
    </div>
  );
}
