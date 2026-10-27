"use client";
import { useEffect, useState } from "react";
import {
  ACTION_LABELS,
  type ActionName,
  type CameraMode,
  type ColorblindMode,
  DEFAULT_KEYS,
  DEFAULT_PAD,
  type GraphicsPreset,
  PRESETS,
  type PromptStyle,
  detectPreset,
  useSettings,
} from "@/state/settings";
import { DEFAULT_SLIDERS, DIFFICULTY_LEVELS, type Difficulty, type GameplaySliders } from "@/game/sim/state";
import { audio } from "@/audio/engine";
import { Button, PageShell, Panel, Segmented, Select, Slider, Toggle } from "@/ui/kit";
import { toast } from "@/ui/Toaster";

const SLIDERS: [keyof GameplaySliders, string, string?][] = [
  ["shotSuccess", "Shot success"],
  ["threeSuccess", "Three-point success"],
  ["layupSuccess", "Layup and dunk success"],
  ["passAccuracy", "Pass accuracy"],
  ["stealSuccess", "Steal success"],
  ["blockSuccess", "Block success"],
  ["foulFrequency", "Foul frequency"],
  ["speed", "Game speed", "player movement"],
  ["injuryRate", "Injury frequency", "when injuries are on"],
  ["aiAggression", "CPU aggression", "steals, blocks and gambles"],
];

type Tab = "graphics" | "audio" | "gameplay" | "camera" | "controls" | "accessibility" | "presentation";
const TABS: { id: Tab; label: string }[] = [
  { id: "graphics", label: "Graphics" },
  { id: "audio", label: "Audio" },
  { id: "gameplay", label: "Gameplay" },
  { id: "camera", label: "Camera" },
  { id: "controls", label: "Controls" },
  { id: "accessibility", label: "Accessibility" },
  { id: "presentation", label: "Presentation" },
];
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function SettingsView() {
  const [tab, setTab] = useState<Tab>("graphics");
  const st = useSettings();
  const set = st.set;
  const resetTab = () => {
    const section = tab === "controls" ? "controls" : tab;
    st.resetSection(section as never);
    toast(`${TABS.find((t) => t.id === tab)?.label} reset to defaults`, "good");
  };
  return (
    <PageShell
      title="Settings"
      actions={
        <Button variant="ghost" onClick={resetTab}>
          Reset this tab
        </Button>
      }
    >
      <div className="flex flex-col gap-6 md:flex-row">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto md:w-48 md:flex-col">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={`whitespace-nowrap rounded-[var(--radius-chip)] px-3 py-2 text-left font-display text-xl font-bold ${tab === t.id ? "bg-deck-2 text-amber" : "text-steel hover:text-net"}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex-1">
          {tab === "graphics" && (
            <Panel>
              <div className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>Preset</span>
                <div className="flex items-center gap-2">
                  <Segmented<GraphicsPreset>
                    label="Graphics preset"
                    value={st.graphics.preset}
                    onChange={(p) => st.applyPreset(p)}
                    options={(Object.keys(PRESETS) as GraphicsPreset[]).map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))}
                  />
                  <Button
                    variant="ghost"
                    className="!px-2 !text-base"
                    onClick={() => {
                      const p = detectPreset();
                      st.applyPreset(p);
                      toast(`Detected: ${p} preset`);
                    }}
                  >
                    Auto-detect
                  </Button>
                </div>
              </div>
              <Slider
                label="Resolution scale"
                value={st.graphics.resolutionScale}
                min={0.5}
                max={1.5}
                step={0.05}
                onChange={(v) => set("graphics", { resolutionScale: v })}
                format={pct}
              />
              <Toggle label="Shadows" checked={st.graphics.shadows} onChange={(v) => set("graphics", { shadows: v })} />
              <Toggle
                label="Ambient occlusion"
                hint="Soft contact shading"
                checked={st.graphics.ambientOcclusion}
                onChange={(v) => set("graphics", { ambientOcclusion: v })}
              />
              <Toggle label="Bloom" hint="Glow on lights and LED boards" checked={st.graphics.bloom} onChange={(v) => set("graphics", { bloom: v })} />
              <Toggle label="Anti-aliasing" checked={st.graphics.antialias} onChange={(v) => set("graphics", { antialias: v })} />
              <Slider
                label="Crowd density"
                value={st.graphics.crowdDensity}
                min={0}
                max={1}
                onChange={(v) => set("graphics", { crowdDensity: v })}
                format={pct}
              />
              <Select
                label="Frame rate cap"
                value={st.graphics.fpsCap}
                onChange={(v) => set("graphics", { fpsCap: v })}
                options={[
                  { value: 30, label: "30 fps" },
                  { value: 60, label: "60 fps" },
                  { value: 120, label: "120 fps" },
                  { value: 0, label: "Unlimited" },
                ]}
              />
              <Toggle label="Show frame rate" checked={st.graphics.showFps} onChange={(v) => set("graphics", { showFps: v })} />
            </Panel>
          )}
          {tab === "audio" && (
            <Panel>
              {(["master", "sfx", "crowd", "commentary", "music"] as const).map((k) => (
                <Slider
                  key={k}
                  label={{ master: "Master volume", sfx: "Sound effects", crowd: "Crowd", commentary: "Commentary voice", music: "Music" }[k]}
                  value={st.audio[k]}
                  min={0}
                  max={1}
                  onChange={(v) => {
                    set("audio", { [k]: v });
                    audio.unlock();
                    audio.setMix({ ...st.audio, [k]: v });
                    if (k === "sfx" || k === "master") audio.uiSelect();
                  }}
                  format={pct}
                />
              ))}
              <Toggle
                label="Spoken commentary"
                hint="Uses your browser's built-in voice"
                checked={st.audio.voiceCommentary}
                onChange={(v) => set("audio", { voiceCommentary: v })}
              />
              <Toggle label="Mute when the tab is in the background" checked={st.audio.muteOnBlur} onChange={(v) => set("audio", { muteOnBlur: v })} />
            </Panel>
          )}
          {tab === "gameplay" && (
            <Panel>
              <Select<Difficulty>
                label="Difficulty"
                value={st.gameplay.difficulty}
                onChange={(v) => set("gameplay", { difficulty: v })}
                options={DIFFICULTY_LEVELS.map((d) => ({ value: d.id, label: d.label }))}
              />
              <Select
                label="Default quarter length"
                value={st.gameplay.quarterMinutes}
                onChange={(v) => set("gameplay", { quarterMinutes: v })}
                options={[2, 3, 4, 5, 6, 8, 10, 12].map((q) => ({ value: q, label: `${q} minutes` }))}
              />
              <Toggle label="Shot meter" checked={st.gameplay.shotMeter} onChange={(v) => set("gameplay", { shotMeter: v })} />
              <Toggle
                label="Shot feedback"
                hint="Shows how early or late each release was"
                checked={st.gameplay.showShotFeedback}
                onChange={(v) => set("gameplay", { showShotFeedback: v })}
              />
              <Toggle label="Fatigue" checked={st.gameplay.fatigue} onChange={(v) => set("gameplay", { fatigue: v })} />
              <Toggle label="Fouls" checked={st.gameplay.fouls} onChange={(v) => set("gameplay", { fouls: v })} />
              <Toggle label="Injuries" checked={st.gameplay.injuries} onChange={(v) => set("gameplay", { injuries: v })} />
              <Toggle label="Coach makes substitutions" checked={st.gameplay.autoSubs} onChange={(v) => set("gameplay", { autoSubs: v })} />
              <Toggle
                label="Sideline assist"
                hint="Stops you from stepping out of bounds by accident"
                checked={st.gameplay.boundaryAssist}
                onChange={(v) => set("gameplay", { boundaryAssist: v })}
              />
              <Toggle label="Player names over heads" checked={st.gameplay.showPlayerNames} onChange={(v) => set("gameplay", { showPlayerNames: v })} />
              <Toggle label="Controller vibration" checked={st.gameplay.vibration} onChange={(v) => set("gameplay", { vibration: v })} />
            </Panel>
          )}
          {tab === "gameplay" && (
            <Panel title="Gameplay sliders" className="mt-5">
              <p className="mb-2 text-sm text-steel">
                Fine-tune how the game plays for both teams. 100% is the standard balance. They apply to games you play and games you simulate.
              </p>
              {SLIDERS.map(([k, label, hint]) => (
                <Slider
                  key={k}
                  label={hint ? `${label} (${hint})` : label}
                  value={st.gameplay.sliders[k]}
                  min={0.25}
                  max={2}
                  step={0.05}
                  format={pct}
                  onChange={(v) => set("gameplay", { sliders: { ...st.gameplay.sliders, [k]: v } })}
                />
              ))}
              <div className="mt-3 flex justify-end">
                <Button
                  variant="secondary"
                  onClick={() => {
                    set("gameplay", { sliders: { ...DEFAULT_SLIDERS } });
                    toast("Sliders reset", "good");
                  }}
                >
                  Reset sliders
                </Button>
              </div>
            </Panel>
          )}
          {tab === "camera" && (
            <Panel>
              <Select<CameraMode>
                label="Default camera"
                value={st.camera.mode}
                onChange={(v) => set("camera", { mode: v })}
                options={[
                  { value: "broadcast", label: "Broadcast" },
                  { value: "2k", label: "2K" },
                  { value: "low", label: "Low broadcast" },
                  { value: "baseline", label: "Baseline" },
                  { value: "player", label: "Player lock" },
                  { value: "skycam", label: "Skycam" },
                ]}
              />
              <Slider label="Zoom" value={st.camera.zoom} min={0.7} max={1.4} onChange={(v) => set("camera", { zoom: v })} format={(v) => `${v.toFixed(2)}x`} />
              <Slider
                label="Height"
                value={st.camera.height}
                min={0.6}
                max={1.5}
                onChange={(v) => set("camera", { height: v })}
                format={(v) => `${v.toFixed(2)}x`}
              />
              <Toggle label="Camera shake on dunks" checked={st.camera.shake} onChange={(v) => set("camera", { shake: v })} />
            </Panel>
          )}
          {tab === "controls" && <ControlsTab />}
          {tab === "accessibility" && (
            <Panel>
              <Select<ColorblindMode>
                label="Color vision"
                value={st.accessibility.colorblind}
                onChange={(v) => set("accessibility", { colorblind: v })}
                options={[
                  { value: "off", label: "Standard" },
                  { value: "protanopia", label: "Protanopia" },
                  { value: "deuteranopia", label: "Deuteranopia" },
                  { value: "tritanopia", label: "Tritanopia" },
                ]}
              />
              <Slider
                label="Interface size"
                value={st.accessibility.uiScale}
                min={0.85}
                max={1.4}
                onChange={(v) => set("accessibility", { uiScale: v })}
                format={pct}
              />
              <Toggle label="Commentary subtitles" checked={st.accessibility.subtitles} onChange={(v) => set("accessibility", { subtitles: v })} />
              <Toggle
                label="Reduce motion"
                hint="Fewer animations in menus; static menu camera"
                checked={st.accessibility.reducedMotion}
                onChange={(v) => set("accessibility", { reducedMotion: v })}
              />
              <Toggle
                label="High-contrast scoreboard"
                checked={st.accessibility.highContrastHud}
                onChange={(v) => set("accessibility", { highContrastHud: v })}
              />
              <Toggle
                label="Tap instead of hold"
                hint="Shots release automatically at the ideal moment window"
                checked={st.accessibility.holdToTap}
                onChange={(v) => set("accessibility", { holdToTap: v })}
              />
            </Panel>
          )}
          {tab === "presentation" && (
            <Panel>
              <Toggle label="Commentary" checked={st.presentation.commentary} onChange={(v) => set("presentation", { commentary: v })} />
              <Toggle
                label="Automatic instant replays"
                hint="Big plays replay in slow motion. Press the replay button any time to watch the last few seconds."
                checked={st.presentation.replays}
                onChange={(v) => set("presentation", { replays: v })}
              />
              <Toggle
                label="Big-play banners"
                hint="AND ONE, REJECTED, runs and buzzer beaters"
                checked={st.presentation.playBanners}
                onChange={(v) => set("presentation", { playBanners: v })}
              />
              <Toggle
                label="Stat overlays"
                hint="Broadcast-style cards for hot scorers and free-throw shooters"
                checked={st.presentation.statOverlays}
                onChange={(v) => set("presentation", { statOverlays: v })}
              />
              <Toggle
                label="Quarter and timeout screens"
                hint="Stats and substitutions at every break. Off keeps play moving."
                checked={st.presentation.breakScreens}
                onChange={(v) => set("presentation", { breakScreens: v })}
              />
              <Toggle label="Skip intros" checked={st.presentation.skipIntros} onChange={(v) => set("presentation", { skipIntros: v })} />
              <Toggle label="Control hints during games" checked={st.presentation.showTips} onChange={(v) => set("presentation", { showTips: v })} />
              <div className="mt-4 border-t border-line pt-4">
                <Button
                  variant="secondary"
                  onClick={() => {
                    st.resetAll();
                    toast("All settings reset", "good");
                  }}
                >
                  Reset every setting
                </Button>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </PageShell>
  );
}

function keyName(code: string) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code.replace("Left", " (L)").replace("Right", " (R)").replace("Arrow", "").replace("Escape", "Esc");
}
const PAD_NAMES = [
  "A / ✕",
  "B / ○",
  "X / □",
  "Y / △",
  "LB / L1",
  "RB / R1",
  "LT / L2",
  "RT / R2",
  "View",
  "Menu",
  "LS",
  "RS",
  "D-pad up",
  "D-pad down",
  "D-pad left",
  "D-pad right",
];

function ControlsTab() {
  const st = useSettings();
  const [listening, setListening] = useState<{ action: ActionName; kind: "key" | "pad" } | null>(null);

  useEffect(() => {
    if (!listening) return;
    if (listening.kind === "key") {
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.code !== "Escape" || listening.action === "pause") {
          st.set("controls", { keys: { ...st.controls.keys, [listening.action]: [e.code] } });
          toast(`${ACTION_LABELS[listening.action]}: ${keyName(e.code)}`, "good");
        }
        setListening(null);
      };
      window.addEventListener("keydown", onKey, { capture: true });
      return () => window.removeEventListener("keydown", onKey, { capture: true });
    }
    let raf = 0;
    const start = performance.now();
    const poll = () => {
      const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected);
      const idx = pad?.buttons.findIndex((b) => b.pressed) ?? -1;
      if (pad && idx >= 0 && performance.now() - start > 250) {
        st.set("controls", { pad: { ...st.controls.pad, [listening.action]: [idx] } });
        toast(`${ACTION_LABELS[listening.action]}: ${PAD_NAMES[idx] ?? `Button ${idx}`}`, "good");
        setListening(null);
        return;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [listening, st]);

  // the same key used for two offense (or two defense) actions is a real conflict
  const offense: ActionName[] = [
    "shoot",
    "pass",
    "lob",
    "bounce",
    "iconPass",
    "dribbleLeft",
    "dribbleRight",
    "dribbleBack",
    "dribbleSpin",
    "pumpFake",
    "post",
    "callScreen",
  ];
  const defense: ActionName[] = ["block", "steal", "intenseD", "switchPlayer", "takeCharge"];
  const shared: ActionName[] = ["up", "down", "left", "right", "sprint", "timeout", "pause", "camera", "replay"];
  const conflicts = new Set<ActionName>();
  for (const group of [offense, defense]) {
    const all = [...group, ...shared];
    for (const a of all) for (const b of all) if (a !== b && st.controls.keys[a]?.some((k) => st.controls.keys[b]?.includes(k))) conflicts.add(a);
  }
  const actions = Object.keys(ACTION_LABELS) as ActionName[];
  return (
    <Panel>
      <Select<PromptStyle>
        label="Button prompts"
        value={st.controls.prompts}
        onChange={(v) => st.set("controls", { prompts: v })}
        options={[
          { value: "auto", label: "Match the last device used" },
          { value: "keyboard", label: "Keyboard" },
          { value: "xbox", label: "Xbox" },
          { value: "playstation", label: "PlayStation" },
        ]}
      />
      <Slider
        label="Stick dead zone"
        value={st.controls.stickDeadzone}
        min={0.05}
        max={0.4}
        step={0.01}
        onChange={(v) => st.set("controls", { stickDeadzone: v })}
        format={pct}
      />
      <p className="mt-4 text-sm text-steel">
        Select a binding, then press the new key or button. Shoot and block share a key on purpose (offense vs. defense), as do pass and steal.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-steel">
            <tr>
              <th className="py-2 font-semibold">Action</th>
              <th className="font-semibold">Keyboard</th>
              <th className="font-semibold">Controller</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a} className="border-t border-line/60">
                <td className="py-1.5 pr-4">
                  {ACTION_LABELS[a]}
                  {conflicts.has(a) && <span className="ml-2 text-xs text-bad">Conflict</span>}
                </td>
                <td className="pr-4">
                  <button
                    onClick={() => setListening({ action: a, kind: "key" })}
                    className={`min-w-24 rounded border px-2 py-1 ${listening?.action === a && listening.kind === "key" ? "border-amber text-amber" : "border-line"}`}
                  >
                    {listening?.action === a && listening.kind === "key" ? "Press a key…" : (st.controls.keys[a] ?? []).map(keyName).join(" / ") || "Unbound"}
                  </button>
                </td>
                <td>
                  <button
                    onClick={() => setListening({ action: a, kind: "pad" })}
                    className={`min-w-28 rounded border px-2 py-1 ${listening?.action === a && listening.kind === "pad" ? "border-amber text-amber" : "border-line"}`}
                  >
                    {listening?.action === a && listening.kind === "pad"
                      ? "Press a button…"
                      : (st.controls.pad[a] ?? []).map((i) => PAD_NAMES[i] ?? `Button ${i}`).join(" / ") ||
                        (a.startsWith("dribble") ? "Right stick" : "Unbound")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            st.set("controls", { keys: DEFAULT_KEYS });
            toast("Keyboard bindings restored", "good");
          }}
        >
          Restore keyboard defaults
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            st.set("controls", { pad: DEFAULT_PAD });
            toast("Controller bindings restored", "good");
          }}
        >
          Restore controller defaults
        </Button>
      </div>
    </Panel>
  );
}
