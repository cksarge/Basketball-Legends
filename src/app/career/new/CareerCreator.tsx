"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { loadLeague } from "@/data/leagues";
import { ARCHETYPES, FACIAL_HAIR, HAIR_COLORS, HAIR_STYLES, SKIN_TONES, archetypesFor, heightStr, overall, randomAppearance } from "@/engine/player";
import { Rng } from "@/engine/rng";
import {
  POSITIONS,
  RATING_GROUPS,
  RATING_LABELS,
  type Appearance,
  type Archetype,
  type Player,
  type Position,
  type RatingKey,
  type Team,
} from "@/engine/types";
import {
  CREATOR_MAX_PER_RATING,
  CREATOR_POINTS,
  DEFAULT_SETTINGS,
  FRESHMAN_AGE,
  HEIGHT_RANGE,
  WINGSPAN_RANGE,
  allocationTotal,
  applyAllocation,
  clampBody,
  computeCaps,
  createCareer,
  defaultBody,
  heightAtAge,
  hometownSchools,
  hometowns,
  potentialFromCaps,
  startingRatings,
  weightRange,
} from "@/career/create";
import type { BodySpec, CareerSettings } from "@/career/types";
import { LEVEL_SHORT } from "@/career/format";
import { DIFFICULTY_LEVELS } from "@/game/sim/state";
import { useCareer } from "@/state/careerStore";
import { Button, PageShell, Panel, Segmented, Select, Slider, Toggle } from "@/ui/kit";
import { toast } from "@/ui/Toaster";

const PlayerPreview = dynamic(() => import("@/game3d/PlayerPreview"), { ssr: false });

const STEPS = ["Player", "Position", "Body", "Look", "Skills", "Start"] as const;
type Step = (typeof STEPS)[number];

const POS_NAMES: Record<Position, string> = { PG: "Point guard", SG: "Shooting guard", SF: "Small forward", PF: "Power forward", C: "Center" };
const SHOE_COLORS = ["#ffffff", "#111111", "#e63946", "#1d3557", "#ffb703", "#2a9d8f", "#8338ec", "#ff006e", "#f4a261"];

/** Signature skills shown under each archetype. */
function archetypeBlurb(a: Archetype) {
  const mods = Object.entries(ARCHETYPES[a].mods) as [RatingKey, number][];
  const up = mods
    .filter(([, v]) => v > 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([k]) => RATING_LABELS[k]);
  return up.join(", ");
}

/** Puts creator points into the archetype's signature skills, best first. */
function autoAllocate(pos: Position, a: Archetype, caps: ReturnType<typeof computeCaps>, base: ReturnType<typeof startingRatings>) {
  const order = (Object.entries(ARCHETYPES[a].mods) as [RatingKey, number][]).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
  const alloc: Partial<Record<RatingKey, number>> = {};
  let left = CREATOR_POINTS;
  for (const [k] of order) {
    const room = Math.min(CREATOR_MAX_PER_RATING, caps[k] - base[k]);
    const add = Math.min(room, left, 9);
    if (add > 0) alloc[k] = add;
    left -= add;
    if (left <= 0) break;
  }
  // spread anything left over the position's core skills
  const core: RatingKey[] =
    pos === "PG" || pos === "SG" ? ["ballHandle", "speed", "iq"] : pos === "SF" ? ["layup", "perimeterD", "iq"] : ["defReb", "strength", "iq"];
  for (const k of core) {
    if (left <= 0) break;
    const add = Math.min(left, CREATOR_MAX_PER_RATING - (alloc[k] ?? 0), caps[k] - base[k] - (alloc[k] ?? 0));
    if (add > 0) alloc[k] = (alloc[k] ?? 0) + add;
    left -= Math.max(0, add);
  }
  return alloc;
}

export function CareerCreator() {
  const router = useRouter();
  const setCareer = useCareer((s) => s.set);
  const [schools, setSchools] = useState<Team[] | null>(null);
  const [step, setStep] = useState<Step>("Player");
  // random per visit, picked after mount so the prerendered page matches the first client render
  const [seed, setSeed] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [hometown, setHometown] = useState("Phoenix, AZ");
  const [schoolId, setSchoolId] = useState("");
  const [anySchool, setAnySchool] = useState(false);
  const [jersey, setJersey] = useState(1);
  const [pos, setPos] = useState<Position>("SG");
  const [archetype, setArchetype] = useState<Archetype>(archetypesFor("SG")[0]);
  const [body, setBody] = useState<BodySpec>(defaultBody("SG"));
  const [appearance, setAppearance] = useState<Appearance>(() => randomAppearance(new Rng(1)));
  const [alloc, setAlloc] = useState<Partial<Record<RatingKey, number>>>({});
  const [settings, setSettings] = useState<CareerSettings>(DEFAULT_SETTINGS);
  const [academics, setAcademics] = useState(0.6);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    loadLeague("hs").then((d) => setSchools(d.teams));
    const s = Math.floor(Math.random() * 2147483646) + 1;
    /* eslint-disable react-hooks/set-state-in-effect */
    setSeed(s);
    setAppearance(randomAppearance(new Rng(s)));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const towns = useMemo(() => (schools ? hometowns(schools) : []), [schools]);
  const local = useMemo(() => (schools ? hometownSchools(schools, hometown) : []), [schools, hometown]);
  const schoolOptions = useMemo(() => {
    if (!schools) return [];
    const list = anySchool ? [...schools].sort((a, b) => a.name.localeCompare(b.name)) : local;
    return list.map((t) => ({ value: t.id, label: `${t.name} ${t.nickname} (${t.tier}${anySchool ? `, ${t.city}` : ""})` }));
  }, [schools, anySchool, local]);
  // keep the school valid for the hometown (or pick the biggest local school)
  const school = useMemo(() => {
    if (!schools) return null;
    return schools.find((t) => t.id === schoolId && (anySchool || local.includes(t))) ?? local[0] ?? schools[0];
  }, [schools, schoolId, anySchool, local]);

  const caps = useMemo(() => computeCaps(pos, archetype, body), [pos, archetype, body]);
  const base = useMemo(() => startingRatings(pos, archetype, caps, new Rng(`${seed}:start`)), [pos, archetype, caps, seed]);
  const ratings = useMemo(() => applyAllocation(base, caps, alloc), [base, caps, alloc]);
  const spent = allocationTotal(alloc);
  const ovr = overall(ratings, pos);
  const potential = potentialFromCaps(pos, caps);

  const choosePos = (p: Position) => {
    setPos(p);
    if (!archetypesFor(p).includes(archetype)) setArchetype(archetypesFor(p)[0]);
    setBody((b) => clampBody(p, { ...b, adultHeightIn: Math.max(b.adultHeightIn, HEIGHT_RANGE[p][0]) }));
    setAlloc({});
  };

  const previewPlayer = useMemo<Player | null>(() => {
    if (!school) return null;
    return {
      id: "preview",
      firstName: firstName || "Your",
      lastName: lastName || "Player",
      pos,
      heightIn: heightAtAge(body.adultHeightIn, FRESHMAN_AGE),
      weightLb: body.weightLb,
      wingspanIn: body.wingspanIn,
      age: FRESHMAN_AGE,
      hometown,
      archetype,
      ratings: base,
      potential,
      jersey,
      teamId: school.id,
      appearance,
      badges: [],
      traits: { workEthic: 0.7, ego: 0.4, loyalty: 0.6, consistency: 0.7 },
    };
    // the 3D model only depends on looks, size, name and number
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [school, firstName, lastName, pos, body.adultHeightIn, jersey, appearance]);

  const canStart = !!school && firstName.trim() && lastName.trim();
  const stepIdx = STEPS.indexOf(step);

  const start = async () => {
    if (!school || !canStart) return;
    setStarting(true);
    try {
      const c = createCareer(
        {
          firstName,
          lastName,
          pos,
          archetype,
          body,
          appearance,
          jersey,
          hometown,
          schoolId: school.id,
          allocation: alloc,
          settings,
          academics,
          startYear: new Date().getFullYear(),
        },
        seed,
      );
      await setCareer(c);
      router.push(`/career/hub/?id=${encodeURIComponent(c.id)}`);
    } catch (e) {
      setStarting(false);
      toast(e instanceof Error ? e.message : "Couldn't save the career", "bad");
    }
  };

  return (
    <PageShell title="Create a player" back="/career/" backLabel="Careers" wide>
      <nav aria-label="Creator steps" className="mb-5 flex flex-wrap gap-1">
        {STEPS.map((s, i) => (
          <button
            key={s}
            onClick={() => setStep(s)}
            aria-current={step === s ? "step" : undefined}
            className={`rounded-[var(--radius-chip)] px-3 py-1.5 text-sm font-semibold ${step === s ? "bg-amber text-navy" : i < stepIdx ? "bg-deck-2 text-net" : "text-steel hover:text-net"}`}
          >
            {i + 1}. {s}
          </button>
        ))}
      </nav>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-5">
          {step === "Player" && (
            <Panel title="Who are you?">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="First name" value={firstName} onChange={setFirstName} />
                <TextField label="Last name" value={lastName} onChange={setLastName} />
              </div>
              <Select label="Hometown" value={hometown} options={towns.map((t) => ({ value: t, label: t }))} onChange={setHometown} />
              <Select
                label="High school"
                hint={anySchool ? "Arizona has open enrollment, so any school will take you" : "Schools in your hometown"}
                value={school?.id ?? ""}
                options={schoolOptions}
                onChange={setSchoolId}
              />
              <Toggle label="Show every school in Arizona" checked={anySchool} onChange={setAnySchool} />
              {school && <SchoolCard team={school} />}
              <div className="flex items-center justify-between gap-6 py-2.5">
                <label htmlFor="jersey">Jersey number</label>
                <input
                  id="jersey"
                  name="jersey"
                  type="number"
                  min={0}
                  max={99}
                  value={jersey}
                  onChange={(e) => setJersey(Math.max(0, Math.min(99, Math.round(Number(e.target.value) || 0))))}
                  className="w-20 rounded-[var(--radius-chip)] bg-deck-2 px-3 py-1.5 text-right text-net ring-1 ring-line"
                />
              </div>
            </Panel>
          )}

          {step === "Position" && (
            <>
              <Panel title="Position">
                <Segmented label="Position" value={pos} options={POSITIONS.map((p) => ({ value: p, label: p }))} onChange={choosePos} />
                <p className="mt-2 text-steel">{POS_NAMES[pos]}</p>
              </Panel>
              <Panel title="Archetype">
                <p className="mb-3 text-sm text-steel">Your archetype shapes your starting ratings and how high each skill can grow.</p>
                <div role="radiogroup" aria-label="Archetype" className="grid gap-2 sm:grid-cols-2">
                  {archetypesFor(pos).map((a) => (
                    <button
                      key={a}
                      role="radio"
                      aria-checked={archetype === a}
                      onClick={() => {
                        setArchetype(a);
                        setAlloc({});
                      }}
                      className={`rounded-[var(--radius-chip)] p-3 text-left ring-1 ${archetype === a ? "bg-amber/15 ring-amber" : "bg-deck-2 ring-line hover:ring-steel"}`}
                    >
                      <span className="block font-display text-xl font-black">{a}</span>
                      <span className="text-sm text-steel">{archetypeBlurb(a)}</span>
                    </button>
                  ))}
                </div>
              </Panel>
            </>
          )}

          {step === "Body" && (
            <Panel title="Body">
              <p className="mb-2 text-sm text-steel">
                You pick the height you grow into by senior year. Taller and heavier players have higher caps for size skills and lower caps for speed and
                handles; a long wingspan helps on defense.
              </p>
              <Slider
                label="Adult height"
                value={body.adultHeightIn}
                min={HEIGHT_RANGE[pos][0]}
                max={HEIGHT_RANGE[pos][1]}
                step={1}
                format={heightStr}
                onChange={(v) => setBody((b) => clampBody(pos, { ...b, adultHeightIn: v, wingspanIn: b.wingspanIn + (v - b.adultHeightIn) }))}
              />
              <Slider
                label="Weight"
                value={body.weightLb}
                min={weightRange(body.adultHeightIn)[0]}
                max={weightRange(body.adultHeightIn)[1]}
                step={1}
                format={(v) => `${v} lb`}
                onChange={(v) => setBody((b) => clampBody(pos, { ...b, weightLb: v }))}
              />
              <Slider
                label="Wingspan"
                value={body.wingspanIn}
                min={body.adultHeightIn + WINGSPAN_RANGE[0]}
                max={body.adultHeightIn + WINGSPAN_RANGE[1]}
                step={1}
                format={heightStr}
                onChange={(v) => setBody((b) => clampBody(pos, { ...b, wingspanIn: v }))}
              />
              <p className="mt-2 text-sm text-steel">
                As a freshman you&apos;re {heightStr(heightAtAge(body.adultHeightIn, FRESHMAN_AGE))}, and you&apos;ll keep growing through high school.
              </p>
              <CapsTable ratings={ratings} caps={caps} />
            </Panel>
          )}

          {step === "Look" && (
            <Panel title="Look">
              <Swatches label="Skin tone" colors={SKIN_TONES} value={appearance.skinTone} onChange={(v) => setAppearance((a) => ({ ...a, skinTone: v }))} />
              <Select
                label="Hair"
                value={appearance.hairStyle}
                options={HAIR_STYLES.map((h, i) => ({ value: i, label: h }))}
                onChange={(v) => setAppearance((a) => ({ ...a, hairStyle: v }))}
              />
              <Swatches label="Hair color" colors={HAIR_COLORS} value={appearance.hairColor} onChange={(v) => setAppearance((a) => ({ ...a, hairColor: v }))} />
              <Select
                label="Facial hair"
                value={appearance.facialHair}
                options={FACIAL_HAIR.map((h, i) => ({ value: i, label: h }))}
                onChange={(v) => setAppearance((a) => ({ ...a, facialHair: v }))}
              />
              <Slider
                label="Face shape"
                value={appearance.faceShape}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => setAppearance((a) => ({ ...a, faceShape: v }))}
              />
              <Swatches
                label="Shoes"
                colors={SHOE_COLORS}
                value={Math.max(0, SHOE_COLORS.indexOf(appearance.shoeColor))}
                onChange={(v) => setAppearance((a) => ({ ...a, shoeColor: SHOE_COLORS[v] }))}
              />
              <Toggle label="Headband" checked={appearance.headband} onChange={(v) => setAppearance((a) => ({ ...a, headband: v }))} />
              <div className="flex items-center justify-between gap-6 py-2.5">
                <span>Arm sleeve</span>
                <Segmented
                  label="Arm sleeve"
                  value={appearance.armSleeve}
                  options={[
                    { value: "none", label: "None" },
                    { value: "left", label: "Left" },
                    { value: "right", label: "Right" },
                  ]}
                  onChange={(v) => setAppearance((a) => ({ ...a, armSleeve: v }))}
                />
              </div>
              <Toggle label="Knee pads" checked={appearance.kneePads} onChange={(v) => setAppearance((a) => ({ ...a, kneePads: v }))} />
              <Button variant="secondary" className="mt-3" onClick={() => setAppearance(randomAppearance(new Rng(Math.random() * 1e9)))}>
                Randomize look
              </Button>
            </Panel>
          )}

          {step === "Skills" && (
            <Panel title="Starting skills">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-steel">
                  <span className="font-display text-2xl font-black text-amber">{CREATOR_POINTS - spent}</span> of {CREATOR_POINTS} points left (up to{" "}
                  {CREATOR_MAX_PER_RATING} per skill)
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" className="!px-3 !py-1.5 !text-base" onClick={() => setAlloc(autoAllocate(pos, archetype, caps, base))}>
                    Auto-fill
                  </Button>
                  <Button variant="ghost" className="!px-3 !py-1.5 !text-base" onClick={() => setAlloc({})}>
                    Reset
                  </Button>
                </div>
              </div>
              {Object.entries(RATING_GROUPS).map(([group, keys]) => (
                <div key={group} className="mb-4">
                  <h3 className="mb-1 font-display text-xl font-black text-steel">{group}</h3>
                  <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    {keys.map((k) => {
                      const add = alloc[k] ?? 0;
                      const canAdd = spent < CREATOR_POINTS && add < CREATOR_MAX_PER_RATING && ratings[k] < caps[k];
                      return (
                        <li key={k} className="flex items-center gap-2">
                          <span className="w-32 flex-none text-sm">{RATING_LABELS[k]}</span>
                          <RatingBar value={ratings[k]} cap={caps[k]} />
                          <button
                            aria-label={`Lower ${RATING_LABELS[k]}`}
                            disabled={add <= 0}
                            onClick={() => setAlloc((a) => ({ ...a, [k]: add - 1 }))}
                            className="h-7 w-7 rounded bg-deck-2 font-bold ring-1 ring-line disabled:opacity-30"
                          >
                            −
                          </button>
                          <span className="w-8 text-center text-sm tabular-nums">{ratings[k]}</span>
                          <button
                            aria-label={`Raise ${RATING_LABELS[k]}`}
                            disabled={!canAdd}
                            onClick={() => setAlloc((a) => ({ ...a, [k]: add + 1 }))}
                            className="h-7 w-7 rounded bg-deck-2 font-bold ring-1 ring-line disabled:opacity-30"
                          >
                            +
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </Panel>
          )}

          {step === "Start" && (
            <Panel title="Career settings">
              <Select
                label="Difficulty"
                value={settings.difficulty}
                options={DIFFICULTY_LEVELS.map((d) => ({ value: d.id, label: d.label }))}
                onChange={(v) => setSettings((s) => ({ ...s, difficulty: v }))}
              />
              <Select
                label="Quarter length in played games"
                hint="Simulated games always use full league rules"
                value={settings.quarterMinutes}
                options={[2, 3, 4, 5, 6, 8].map((m) => ({ value: m, label: `${m} min` }))}
                onChange={(v) => setSettings((s) => ({ ...s, quarterMinutes: v }))}
              />
              <Select
                label="When you go to the bench"
                value={settings.bench}
                options={[
                  { value: "ask", label: "Ask me each time" },
                  { value: "watch", label: "Watch from the bench" },
                  { value: "skip", label: "Fast-forward until I'm back" },
                  { value: "sim", label: "Sim to the end" },
                ]}
                onChange={(v) => setSettings((s) => ({ ...s, bench: v }))}
              />
              <Select
                label="In the classroom"
                hint="Sets your starting grades; school time and finals matter too"
                value={academics}
                options={[
                  { value: 0.3, label: "Struggling" },
                  { value: 0.6, label: "Average" },
                  { value: 0.85, label: "Honor roll" },
                ]}
                onChange={setAcademics}
              />
              <Select
                label="Story events"
                hint="Texts, media moments and choices"
                value={settings.storyFrequency}
                options={[
                  { value: "low", label: "Fewer" },
                  { value: "normal", label: "Normal" },
                  { value: "high", label: "More" },
                ]}
                onChange={(v) => setSettings((s) => ({ ...s, storyFrequency: v }))}
              />
              <p className="mt-3 text-sm text-steel">You can change these later from the career hub.</p>
              {!canStart && <p className="mt-3 text-sm text-bad">Enter a first and last name on the Player step to start.</p>}
            </Panel>
          )}

          <div className="flex justify-between">
            <Button variant="ghost" disabled={stepIdx === 0} onClick={() => setStep(STEPS[stepIdx - 1])}>
              ← Back
            </Button>
            {step === "Start" ? (
              <Button disabled={!canStart || starting} onClick={start}>
                {starting ? "Starting…" : "Start career"}
              </Button>
            ) : (
              <Button onClick={() => setStep(STEPS[stepIdx + 1])}>Next →</Button>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-3 lg:sticky lg:top-20 lg:self-start">
          <div className="aspect-[4/5] overflow-hidden rounded-[var(--radius-panel)] ring-1 ring-line">
            {previewPlayer && school ? <PlayerPreview player={previewPlayer} team={school} /> : <div className="h-full bg-deck" />}
          </div>
          <Panel>
            <p className="font-display text-2xl font-black">
              {firstName || "Your"} {lastName || "Player"} <span className="text-steel">#{jersey}</span>
            </p>
            <p className="text-sm text-steel">
              {pos} · {archetype} · {heightStr(body.adultHeightIn)} adult, {body.weightLb} lb
            </p>
            {school && <p className="text-sm text-steel">{`${school.name} ${school.nickname}`}</p>}
            <div className="mt-3 flex gap-6">
              <Stat label="Overall" value={ovr} />
              <Stat label="Potential" value={potential} />
            </div>
          </Panel>
        </aside>
      </div>
    </PageShell>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 py-1.5">
      <span className="text-sm text-steel">{label}</span>
      <input
        name={label.toLowerCase().replace(/\s+/g, "-")}
        value={value}
        maxLength={20}
        onChange={(e) => onChange(e.target.value.replace(/[^\p{L}\p{M}' .-]/gu, ""))}
        className="rounded-[var(--radius-chip)] bg-deck-2 px-3 py-2 text-net ring-1 ring-line focus:ring-amber"
        autoComplete="off"
      />
    </label>
  );
}

function SchoolCard({ team }: { team: Team }) {
  const levels = team.levels ?? ["varsity", "jv"];
  const first = levels.includes("frso") ? "frso" : levels.includes("jv") ? "jv" : "varsity";
  return (
    <div className="my-2 rounded-[var(--radius-chip)] bg-deck-2 p-3 text-sm ring-1 ring-line">
      <p>
        <span className="font-semibold">
          {team.name} {team.nickname}
        </span>{" "}
        · {team.tier} · {team.city}
      </p>
      <p className="text-steel">
        Teams: {levels.map((l) => (l === "jv2" ? "JV 2" : LEVEL_SHORT[l])).join(", ")}. Most freshmen start on {LEVEL_SHORT[first]}, but a strong tryout can put
        you higher.
      </p>
    </div>
  );
}

function Swatches({ label, colors, value, onChange }: { label: string; colors: string[]; value: number; onChange: (i: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <span>{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap justify-end gap-1.5">
        {colors.map((c, i) => (
          <button
            key={c}
            role="radio"
            aria-checked={value === i}
            aria-label={`${label} ${i + 1}`}
            onClick={() => onChange(i)}
            className={`h-7 w-7 rounded-full ring-2 ${value === i ? "ring-amber" : "ring-line"}`}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}

function RatingBar({ value, cap }: { value: number; cap: number }) {
  return (
    <span className="relative h-2 flex-1 rounded-full bg-navy" role="img" aria-label={`${value} now, can reach ${cap}`}>
      <span className="absolute inset-y-0 left-0 rounded-full bg-line" style={{ width: `${cap}%` }} />
      <span className="absolute inset-y-0 left-0 rounded-full bg-amber" style={{ width: `${value}%` }} />
    </span>
  );
}

function CapsTable({ ratings, caps }: { ratings: Record<RatingKey, number>; caps: Record<RatingKey, number> }) {
  return (
    <div className="mt-4">
      <h3 className="mb-1 font-display text-xl font-black text-steel">How high each skill can grow</h3>
      <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {(Object.keys(RATING_LABELS) as RatingKey[]).map((k) => (
          <li key={k} className="flex items-center gap-2 text-sm">
            <span className="w-32 flex-none">{RATING_LABELS[k]}</span>
            <RatingBar value={ratings[k]} cap={caps[k]} />
            <span className="w-8 text-right tabular-nums text-steel">{caps[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <span className="block font-display text-4xl font-black text-amber">{value}</span>
      <span className="text-xs text-steel">{label}</span>
    </span>
  );
}
