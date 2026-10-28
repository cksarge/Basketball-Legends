"use client";
import dynamic from "next/dynamic";
import { heightStr } from "@/engine/player";
import { RATING_GROUPS, RATING_LABELS, type RatingKey } from "@/engine/types";
import type { Career } from "@/career/types";
import { spendPoint, upgradeCost, XP_PER_POINT } from "@/career/hs/season";
import { useCareer } from "@/state/careerStore";
import { Panel } from "@/ui/kit";

const PlayerPreview = dynamic(() => import("@/game3d/PlayerPreview"), { ssr: false });

export function PlayerTab({ career }: { career: Career }) {
  const team = useCareer((s) => s.team);
  const update = useCareer((s) => s.update);
  const p = career.player;
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-3">
        <div className="aspect-[4/5] overflow-hidden rounded-[var(--radius-panel)] ring-1 ring-line">{team && <PlayerPreview player={p} team={team} />}</div>
        <Panel>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-steel">Height</dt>
            <dd>
              {heightStr(p.heightIn)}
              {p.heightIn < p.body.adultHeightIn && ` (grows to ${heightStr(p.body.adultHeightIn)})`}
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
          </dl>
        </Panel>
      </div>
      <Panel title="Ratings">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-steel">
            Skills grow on their own as you practice and play. Skill points (one per {XP_PER_POINT} XP from games and practice) let you push the ones you care
            about. The dark bar is how high each skill can go.
          </p>
          <p>
            <span className="font-display text-3xl font-black text-amber">{p.skillPoints}</span> <span className="text-sm text-steel">points</span>
            <span className="ml-3 text-sm text-steel">
              {p.xp}/{XP_PER_POINT} XP
            </span>
          </p>
        </div>
        {Object.entries(RATING_GROUPS).map(([group, keys]) => (
          <div key={group} className="mb-4">
            <h3 className="mb-1 font-display text-xl font-black text-steel">{group}</h3>
            <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {keys.map((k: RatingKey) => {
                const cost = upgradeCost(p.ratings[k], p.caps[k]);
                const can = cost <= p.skillPoints;
                return (
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
                    <button
                      aria-label={`Raise ${RATING_LABELS[k]}${Number.isFinite(cost) ? ` for ${cost} point${cost > 1 ? "s" : ""}` : " (maxed)"}`}
                      title={Number.isFinite(cost) ? `${cost} point${cost > 1 ? "s" : ""}` : "Maxed"}
                      disabled={!can}
                      onClick={() => update((c) => spendPoint(c, k))}
                      className="h-7 w-9 rounded bg-deck-2 text-xs font-bold ring-1 ring-line disabled:opacity-30"
                    >
                      +{Number.isFinite(cost) && cost > 1 ? `(${cost})` : ""}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </Panel>
    </div>
  );
}
