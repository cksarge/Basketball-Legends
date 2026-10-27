"use client";
// Dev tool: look around every Blender venue dressed for any team, from the game's camera spots.
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { courtFor } from "@/game/court";
import type { LeagueId, Team } from "@/engine/types";
import { loadLeague } from "@/data/leagues";
import { Arena } from "@/game3d/Arena";
import { Hoop } from "@/game3d/Hoop";
import { ALL_VARIANTS, pickVariant, variant, venueClearance, venueInterior, type VariantId, type VenueVariant } from "@/game3d/arena/variants";
import type { CourtSpec } from "@/game/court";

const SPOTS: Record<string, [number, number, number]> = {
  broadcast: [0, 9.5, 24.6],
  "2k": [0, 7.5, 20.6],
  baseline: [-18.8, 6, 0],
  courtside: [-4, 2.3, 10.97],
  overview: [0, 30, 60],
};

function Env() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
  }, [gl, scene]);
  return null;
}

/** Same placement rules as CameraRig: above the stands, inside the walls, lens widened when pulled in. */
function Spot({ spot, venue, court }: { spot: string; venue: VenueVariant | null; court: CourtSpec }) {
  const { camera } = useThree();
  useEffect(() => {
    const p = new THREE.Vector3(...SPOTS[spot]);
    const look = new THREE.Vector3(0, 1.1, 0);
    let fov = 30;
    if (venue && spot !== "overview") {
      p.y = Math.max(p.y, venueClearance(venue, court, p.x, p.y, p.z));
      const box = venueInterior(venue, court);
      const before = p.distanceTo(look);
      p.set(THREE.MathUtils.clamp(p.x, -box.x, box.x), Math.min(p.y, box.y), THREE.MathUtils.clamp(p.z, -box.z, box.z));
      fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * (before / p.distanceTo(look))));
    }
    camera.position.copy(p);
    (camera as THREE.PerspectiveCamera).fov = fov;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    camera.lookAt(look);
  }, [camera, spot, venue, court]);
  return null;
}

export function VenueLab() {
  if (process.env.NODE_ENV === "production")
    return <main className="grid min-h-dvh place-items-center text-steel">Developer tools are only available in development builds.</main>;
  return <Lab />;
}

function Lab() {
  const [league, setLeague] = useState<LeagueId>("hs");
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");
  const [vid, setVid] = useState<VariantId | "auto">("auto");
  const [spot, setSpot] = useState("broadcast");
  useEffect(() => {
    loadLeague(league).then((d) => {
      setTeams(d.teams);
      setTeamId(d.teams[0].id);
    });
  }, [league]);
  const team = teams.find((t) => t.id === teamId);
  const kind = league === "hs" ? "gym" : league;
  const venue = useMemo(() => (team ? variant(vid === "auto" ? pickVariant(kind, team) : vid) : null), [team, vid, kind]);
  const court = useMemo(() => courtFor(league), [league]);
  const excite = useRef(0.3);
  const score = useRef({ h: 54, a: 49, period: "Q3", clock: "4:12" });
  const clock = useRef({ shot: 24, game: 720 });
  const ball = useRef<THREE.Vector3 | null>(null);
  const shake = useRef([0, 0]);
  return (
    <div className="fixed inset-0 bg-black">
      <div className="absolute left-2 top-2 z-10 flex flex-wrap gap-2 rounded bg-black/70 p-2 text-sm text-white">
        <select id="lab-league" value={league} onChange={(e) => setLeague(e.target.value as LeagueId)} className="bg-slate-800">
          {["hs", "college", "pro"].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <select id="lab-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className="max-w-60 bg-slate-800">
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} {t.nickname} ({t.arena.capacity})
            </option>
          ))}
        </select>
        <select id="lab-venue" value={vid} onChange={(e) => setVid(e.target.value as VariantId)} className="bg-slate-800">
          <option value="auto">auto</option>
          {ALL_VARIANTS.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select id="lab-spot" value={spot} onChange={(e) => setSpot(e.target.value)} className="bg-slate-800">
          {Object.keys(SPOTS).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span id="lab-current">{venue?.id}</span>
      </div>
      <Canvas
        camera={{ fov: 30, near: 0.5, far: 400 }}
        gl={{ antialias: true }}
        onCreated={({ gl, camera, scene }) => {
          gl.toneMapping = THREE.NoToneMapping;
          (window as unknown as { __lab: unknown }).__lab = { camera, scene };
        }}
      >
        <color attach="background" args={["#05070a"]} />
        <Env />
        <hemisphereLight args={["#cfd9ff", "#1a1410", 0.6]} />
        <directionalLight position={[3, 26, 6]} intensity={2.2} />
        {venue &&
          [-10, 0, 10].map((x) => <pointLight key={x} position={[x, venue.lightY, 0]} intensity={venue.kind === "gym" ? 90 : 260} distance={46} decay={2} />)}
        <Spot spot={spot} venue={venue} court={court} />
        <OrbitControls target={[0, 1.1, 0]} ref={(c) => void ((window as unknown as { __ctl: unknown }).__ctl = c)} />
        <Suspense fallback={null}>
          {team && venue && (
            <>
              <Arena court={court} home={team} away={team} venue={venue} quality="high" crowdDensity={0.8} exciteRef={excite} scoreRef={score} />
              {([1, -1] as const).map((side) => (
                <Hoop
                  key={side}
                  court={court}
                  side={side}
                  team={team}
                  ceilingHung={venue.kind === "gym"}
                  mountY={venue.girderY}
                  ballRef={ball}
                  clockRef={clock}
                  rimShake={shake}
                />
              ))}
            </>
          )}
        </Suspense>
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.5} luminanceThreshold={0.85} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.AGX} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
