"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DIFFICULTY_LEVELS } from "@/game/sim/state";
import type { Career, CareerSettings } from "@/career/types";
import { deleteCareer, exportCareer } from "@/career/storage";
import { useCareer } from "@/state/careerStore";
import { Button, Panel, Select } from "@/ui/kit";
import { downloadText, fileSlug } from "@/ui/download";
import { toast } from "@/ui/Toaster";

export const BENCH_OPTIONS = [
  { value: "ask" as const, label: "Ask me each time" },
  { value: "watch" as const, label: "Watch from the bench" },
  { value: "skip" as const, label: "Fast-forward until I'm back" },
  { value: "sim" as const, label: "Sim to the end" },
];

export function SettingsTab({ career }: { career: Career }) {
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
          hint="Simulated games always use full league rules"
          value={s.quarterMinutes}
          options={[2, 3, 4, 5, 6, 8].map((m) => ({ value: m, label: `${m} min` }))}
          onChange={(v) => set({ quarterMinutes: v })}
        />
        <Select label="When you go to the bench" value={s.bench} options={BENCH_OPTIONS} onChange={(v) => set({ bench: v })} />
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
