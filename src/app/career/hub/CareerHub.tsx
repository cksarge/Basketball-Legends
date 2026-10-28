"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { heightStr, playerOvr } from "@/engine/player";
import { RATING_GROUPS, RATING_LABELS, type RatingKey } from "@/engine/types";
import { DIFFICULTY_LEVELS } from "@/game/sim/state";
import type { Career, CareerSettings } from "@/career/types";
import { formatDate, stageLabel } from "@/career/format";
import { deleteCareer, exportCareer } from "@/career/storage";
import { useCareer } from "@/state/careerStore";
import { Button, PageShell, Panel, Select } from "@/ui/kit";
import { downloadText, fileSlug } from "@/ui/download";
import { toast } from "@/ui/Toaster";

const PlayerPreview = dynamic(() => import("@/game3d/PlayerPreview"), { ssr: false });

export const HUB_TABS = ["Home", "Player", "Settings"] as const;
export type HubTab = (typeof HUB_TABS)[number];

export function CareerHub() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { career, team, status, error, open } = useCareer();
  const [tab, setTab] = useState<HubTab>("Home");

  useEffect(() => {
    if (id) open(id);
  }, [id, open]);

  if (!id || status === "missing") {
    return (
      <PageShell title="Career" back="/career/" backLabel="Careers">
        <Panel>
          <p className="mb-4">That career isn&apos;t saved in this browser.</p>
          <Link href="/career/" className="text-amber underline">
            See your careers
          </Link>
        </Panel>
      </PageShell>
    );
  }
  if (status === "error") {
    return (
      <PageShell title="Career" back="/career/" backLabel="Careers">
        <Panel>
          <p className="text-bad">Couldn&apos;t open this career: {error}</p>
        </Panel>
      </PageShell>
    );
  }
  if (!career || career.id !== id) {
    return (
      <PageShell title="Career" back="/career/" backLabel="Careers">
        <p className="text-steel" role="status">
          Loading your career…
        </p>
      </PageShell>
    );
  }

  const p = career.player;
  return (
    <PageShell title={`${p.firstName} ${p.lastName}`} back="/career/" backLabel="Careers" wide>
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-steel">
        <span>
          #{p.jersey} · {p.pos} · {p.archetype}
        </span>
        {team && (
          <span>
            {team.name} {team.nickname}
          </span>
        )}
        <span>
          {stageLabel(career.stage)} · {formatDate(career.date)}
        </span>
        <span className="ml-auto font-display text-3xl font-black text-amber">
          {playerOvr(p)} <span className="text-sm font-semibold text-steel">OVR</span>
        </span>
      </div>
      <nav aria-label="Career sections" role="tablist" className="mb-5 flex flex-wrap gap-1">
        {HUB_TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-[var(--radius-chip)] px-4 py-2 font-display text-lg font-bold ${tab === t ? "bg-amber text-navy" : "bg-deck text-steel ring-1 ring-line hover:text-net"}`}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === "Home" && <HomeTab career={career} />}
      {tab === "Player" && <PlayerTab career={career} />}
      {tab === "Settings" && <SettingsTab career={career} />}
    </PageShell>
  );
}

function HomeTab({ career }: { career: Career }) {
  const update = useCareer((s) => s.update);
  const unread = career.inbox.filter((m) => !m.read).length;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title={`Messages${unread ? ` (${unread} new)` : ""}`}>
        {career.inbox.length === 0 ? (
          <p className="text-steel">No messages.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {[...career.inbox].reverse().map((m) => (
              <li key={m.id} className={`rounded-[var(--radius-chip)] p-3 ring-1 ${m.read ? "ring-line" : "bg-amber/10 ring-amber/60"}`}>
                <p className="text-xs text-steel">
                  {formatDate(m.date)} · {m.from}
                </p>
                <p className="font-semibold">{m.subject}</p>
                <p className="text-sm text-net/90">{m.body}</p>
                {!m.read && (
                  <button
                    className="mt-1 text-sm text-steel underline"
                    onClick={() => update((c) => ({ ...c, inbox: c.inbox.map((x) => (x.id === m.id ? { ...x, read: true } : x)) }))}
                  >
                    Mark as read
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Career log">
        <ul className="flex flex-col gap-2">
          {[...career.log].reverse().map((e, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="w-24 flex-none text-steel">{formatDate(e.date)}</span>
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function PlayerTab({ career }: { career: Career }) {
  const team = useCareer((s) => s.team);
  const p = career.player;
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-3">
        <div className="aspect-[4/5] overflow-hidden rounded-[var(--radius-panel)] ring-1 ring-line">{team && <PlayerPreview player={p} team={team} />}</div>
        <Panel>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-steel">Height</dt>
            <dd>
              {heightStr(p.heightIn)} (grows to {heightStr(p.body.adultHeightIn)})
            </dd>
            <dt className="text-steel">Weight</dt>
            <dd>{p.weightLb} lb</dd>
            <dt className="text-steel">Wingspan</dt>
            <dd>{heightStr(p.wingspanIn)}</dd>
            <dt className="text-steel">Age</dt>
            <dd>{p.age}</dd>
            <dt className="text-steel">Hometown</dt>
            <dd>{p.hometown}</dd>
            <dt className="text-steel">Potential</dt>
            <dd>{p.potential}</dd>
            <dt className="text-steel">Skill points</dt>
            <dd>{p.skillPoints}</dd>
          </dl>
        </Panel>
      </div>
      <Panel title="Ratings">
        <p className="mb-3 text-sm text-steel">The darker bar is how high each skill can grow.</p>
        {Object.entries(RATING_GROUPS).map(([group, keys]) => (
          <div key={group} className="mb-4">
            <h3 className="mb-1 font-display text-xl font-black text-steel">{group}</h3>
            <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {keys.map((k: RatingKey) => (
                <li key={k} className="flex items-center gap-2 text-sm">
                  <span className="w-32 flex-none">{RATING_LABELS[k]}</span>
                  <span className="relative h-2 flex-1 rounded-full bg-navy" role="img" aria-label={`${p.ratings[k]} of ${p.caps[k]}`}>
                    <span className="absolute inset-y-0 left-0 rounded-full bg-line" style={{ width: `${p.caps[k]}%` }} />
                    <span className="absolute inset-y-0 left-0 rounded-full bg-amber" style={{ width: `${p.ratings[k]}%` }} />
                  </span>
                  <span className="w-14 text-right tabular-nums">
                    {p.ratings[k]}
                    <span className="text-steel">/{p.caps[k]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Panel>
    </div>
  );
}

function SettingsTab({ career }: { career: Career }) {
  const router = useRouter();
  const update = useCareer((s) => s.update);
  const close = useCareer((s) => s.close);
  const [confirm, setConfirm] = useState(false);
  const set = (patch: Partial<CareerSettings>) => update((c) => ({ ...c, settings: { ...c.settings, ...patch } }));
  const s = career.settings;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Gameplay">
        <Select
          label="Difficulty"
          value={s.difficulty}
          options={DIFFICULTY_LEVELS.map((d) => ({ value: d.id, label: d.label }))}
          onChange={(v) => set({ difficulty: v })}
        />
        <Select
          label="Quarter length in played games"
          value={s.quarterMinutes}
          options={[2, 3, 4, 5, 6, 8].map((m) => ({ value: m, label: `${m} min` }))}
          onChange={(v) => set({ quarterMinutes: v })}
        />
        <Select
          label="When you go to the bench"
          value={s.bench}
          options={[
            { value: "ask", label: "Ask me each time" },
            { value: "watch", label: "Watch from the bench" },
            { value: "skip", label: "Fast-forward until I'm back" },
            { value: "sim", label: "Sim to the end" },
          ]}
          onChange={(v) => set({ bench: v })}
        />
        <Select
          label="Story events"
          value={s.storyFrequency}
          options={[
            { value: "low", label: "Fewer" },
            { value: "normal", label: "Normal" },
            { value: "high", label: "More" },
          ]}
          onChange={(v) => set({ storyFrequency: v })}
        />
      </Panel>
      <Panel title="Save">
        <p className="mb-3 text-sm text-steel">This career autosaves in your browser. Export it to keep a backup or move it to another device.</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              downloadText(`${fileSlug(`${career.player.firstName} ${career.player.lastName}`)}.blcareer`, exportCareer(career));
              toast("Career exported");
            }}
          >
            Export career
          </Button>
          {confirm ? (
            <>
              <Button
                variant="secondary"
                onClick={async () => {
                  await deleteCareer(career.id);
                  close();
                  toast("Career deleted");
                  router.push("/career/");
                }}
              >
                Delete for good
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirm(true)}>
              Delete career
            </Button>
          )}
        </div>
      </Panel>
    </div>
  );
}
