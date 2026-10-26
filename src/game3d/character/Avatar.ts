// A renderable player built from the shared rigged GLB, with per-player
// materials (skin, hair, uniform) and procedural, IK-driven animation.
import * as THREE from "three";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Player, Team } from "@/engine/types";
import { HAIR_COLORS, HAIR_STYLES, SKIN_TONES } from "@/engine/player";
import { createSkinMaterial, type MaskSet, type SkinLook } from "./skinMaterial";
import { drawJersey, drawShorts, makeCanvasTexture, type UniformStyle, uniformColors } from "./uniformTexture";

export const MODEL_HEIGHT = 2.0;

/** Hair styles that are geometry (others are painted by the skin shader). */
const HAIR_MESH: Record<number, string> = { 2: "Hair_2", 5: "Hair_5", 6: "Hair_6", 8: "Hair_8", 9: "Hair_9", 10: "Hair_10", 11: "Hair_11" };

interface BoneInfo {
  bone: THREE.Bone;
  restQ: THREE.Quaternion;
  restPos: THREE.Vector3;
  /** Unit direction toward the main child in this bone's local space. */
  restDir: THREE.Vector3;
  length: number;
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

export interface PoseInput {
  /** World transform of the player (already from sim). */
  x: number; y: number; z: number; facing: number;
  vx: number; vz: number;
  action: string; actionT: number; actionDur: number; actionData: Record<string, unknown>;
  hasBall: boolean; dribbling: boolean; hand: 1 | -1;
  ballWorld: THREE.Vector3 | null;
  lookAt: THREE.Vector3 | null;
  stance: boolean; // defensive stance
  stamina: number;
  dt: number;
  heightM: number;
  airborne: boolean;
  celebrate: boolean;
}

export class Avatar {
  root: THREE.Group;
  model: THREE.Object3D;
  bones: Record<string, BoneInfo> = {};
  skinMat!: THREE.MeshStandardMaterial;
  private meshes: Record<string, THREE.SkinnedMesh> = {};
  private jerseyTex: ReturnType<typeof makeCanvasTexture>;
  private shortsTex: ReturnType<typeof makeCanvasTexture>;
  private gait = 0;
  private smooth = { lean: 0, crouch: 0, sideLean: 0, idleT: Math.random() * 10 };
  /** World-space hand positions after posing (for ball attachment). */
  handL = new THREE.Vector3();
  handR = new THREE.Vector3();
  player: Player;
  team: Team;

  constructor(gltf: GLTF, masks: MaskSet, player: Player, team: Team, style: UniformStyle) {
    this.player = player;
    this.team = team;
    this.root = new THREE.Group();
    this.model = skeletonClone(gltf.scene);
    this.root.add(this.model);
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.frustumCulled = false;
        m.castShadow = true;
        m.receiveShadow = true;
        this.meshes[m.name] = m;
      }
      const b = o as THREE.Bone;
      if (b.isBone) {
        this.bones[b.name] = { bone: b, restQ: b.quaternion.clone(), restPos: b.position.clone(), restDir: new THREE.Vector3(0, 1, 0), length: 0.1 };
      }
    });
    // rest directions from primary children
    const primaryChild: Record<string, string> = {
      hips: "spine", spine: "chest", chest: "upperchest", upperchest: "neck", neck: "head",
      clavicleL: "upperarmL", upperarmL: "forearmL", forearmL: "handL", handL: "middle1L",
      clavicleR: "upperarmR", upperarmR: "forearmR", forearmR: "handR", handR: "middle1R",
      thighL: "shinL", shinL: "footL", footL: "toeL", thighR: "shinR", shinR: "footR", footR: "toeR",
      middle1L: "middle2L", middle1R: "middle2R", index1L: "index2L", index1R: "index2R", ring1L: "ring2L", ring1R: "ring2R",
      pinky1L: "pinky2L", pinky1R: "pinky2R", thumb1L: "thumb2L", thumb2L: "thumb3L", thumb1R: "thumb2R", thumb2R: "thumb3R",
    };
    for (const [n, c] of Object.entries(primaryChild)) {
      const b = this.bones[n], ch = this.bones[c];
      if (b && ch) {
        b.restDir.copy(ch.restPos).normalize();
        b.length = ch.restPos.length();
      }
    }
    this.jerseyTex = makeCanvasTexture(1024, 512);
    this.shortsTex = makeCanvasTexture(512, 256);
    this.applyLook(masks, style);
  }

  /** Materials, hair, morphs and uniform for this player. */
  applyLook(masks: MaskSet, style: UniformStyle) {
    const p = this.player, ap = p.appearance;
    const styleName = HAIR_STYLES[ap.hairStyle] ?? "Short";
    const tone = new THREE.Color(SKIN_TONES[ap.skinTone] ?? SKIN_TONES[4]).convertSRGBToLinear();
    const hairColor = new THREE.Color(HAIR_COLORS[ap.hairColor] ?? HAIR_COLORS[0]).convertSRGBToLinear();
    const fh = ap.facialHair;
    const look: SkinLook = {
      tone, hairColor,
      scalp: ["Buzz", "Short", "Twists", "Afro", "Locs", "Man Bun", "Mohawk", "Curly Top"].includes(styleName) ? 1 : styleName === "Waves" ? 0 : 0,
      fade: styleName === "Fade" || styleName === "Curly Top" ? 1 : 0,
      cornrows: styleName === "Braids" ? 1 : 0,
      waves: styleName === "Waves" ? 1 : 0,
      brows: 1,
      stubble: fh === 1 || fh === 3 || fh === 5 ? 1 : 0.25,
      goatee: fh === 2 ? 1 : 0,
      mustache: fh === 4 ? 1 : 0,
      fullBeard: fh === 3 ? 0.75 : fh === 5 ? 1 : 0,
    };
    this.skinMat = createSkinMaterial(masks, look);
    const body = this.meshes.Body;
    if (body) {
      const mats = Array.isArray(body.material) ? body.material : [body.material];
      body.material = mats.map((m) => (m.name === "Skin" ? this.skinMat : m.clone()));
    }
    // hair geometry
    for (const [idx, name] of Object.entries(HAIR_MESH)) {
      const m = this.meshes[name];
      if (!m) continue;
      m.visible = Number(idx) === ap.hairStyle;
      if (m.visible) {
        m.material = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.92, side: THREE.DoubleSide });
      }
    }
    // uniform
    const col = uniformColors(this.team, style);
    drawJersey(this.jerseyTex.canvas, this.team, style, p.jersey, p.lastName);
    this.jerseyTex.tex.needsUpdate = true;
    drawShorts(this.shortsTex.canvas, this.team, style);
    this.shortsTex.tex.needsUpdate = true;
    const cloth = (tex: THREE.Texture) => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, side: THREE.DoubleSide, sheen: 0 } as THREE.MeshStandardMaterialParameters);
    if (this.meshes.Jersey) this.meshes.Jersey.material = cloth(this.jerseyTex.tex);
    if (this.meshes.Shorts) this.meshes.Shorts.material = cloth(this.shortsTex.tex);
    if (this.meshes.Socks) this.meshes.Socks.material = new THREE.MeshStandardMaterial({ color: new THREE.Color(col.trim === col.base ? "#ffffff" : style === "away" ? col.base : "#f4f4f4"), roughness: 0.95, side: THREE.DoubleSide });
    if (this.meshes.Shoes) {
      const shoe = this.meshes.Shoes;
      const mats = Array.isArray(shoe.material) ? shoe.material : [shoe.material];
      shoe.material = mats.map((m) => {
        const c = m.clone() as THREE.MeshStandardMaterial;
        if (m.name === "Upper") c.color = new THREE.Color(ap.shoeColor).convertSRGBToLinear();
        return c;
      });
    }
    const accColor = new THREE.Color(col.trim);
    const acc = (name: string, on: boolean) => {
      const m = this.meshes[name];
      if (!m) return;
      m.visible = on;
      if (on) m.material = new THREE.MeshStandardMaterial({ color: accColor, roughness: 0.9, side: THREE.DoubleSide });
    };
    acc("Acc_Headband", ap.headband);
    acc("Acc_SleeveL", ap.armSleeve === "left");
    acc("Acc_SleeveR", ap.armSleeve === "right");
    acc("Acc_KneeL", ap.kneePads);
    acc("Acc_KneeR", ap.kneePads);
    // morphs: build (lean/heavy from weight per inch) and face blend
    const bmi = p.weightLb / p.heightIn;
    const heavy = THREE.MathUtils.clamp((bmi - 2.85) / 0.45, 0, 1);
    const lean = THREE.MathUtils.clamp((2.65 - bmi) / 0.35, 0, 1);
    const f = ap.faceShape;
    const faceW = [Math.max(0, 1 - Math.abs(f - 0.0) * 3), Math.max(0, 1 - Math.abs(f - 0.5) * 3), Math.max(0, 1 - Math.abs(f - 1.0) * 3)];
    const sum = faceW.reduce((a, b) => a + b, 0) || 1;
    for (const m of Object.values(this.meshes)) {
      const dict = m.morphTargetDictionary;
      const inf = m.morphTargetInfluences;
      if (!dict || !inf) continue;
      const set = (k: string, v: number) => { if (dict[k] !== undefined) inf[dict[k]] = v; };
      set("Lean", lean);
      set("Heavy", heavy);
      // face targets are absolute shapes relative to the neutral mix; blend away from neutral
      set("FaceA", (faceW[0] / sum - 1 / 3) * 1.2 + 0.0);
      set("FaceB", (faceW[1] / sum - 1 / 3) * 1.2);
      set("FaceC", (faceW[2] / sum - 1 / 3) * 1.2);
    }
  }

  setUniformStyle(masks: MaskSet, style: UniformStyle) { this.applyLook(masks, style); }

  dispose() {
    this.jerseyTex.tex.dispose();
    this.shortsTex.tex.dispose();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((x) => x.dispose());
      }
    });
  }

  // ---------------------------------------------------------------- posing
  private b(name: string) { return this.bones[name]; }

  private resetPose() {
    for (const k in this.bones) {
      const info = this.bones[k];
      info.bone.quaternion.copy(info.restQ);
      info.bone.position.copy(info.restPos);
    }
  }

  /** Rotate a bone by a rotation expressed in world space (about its pivot). */
  private rotateWorld(name: string, qWorld: THREE.Quaternion) {
    const info = this.bones[name];
    if (!info) return;
    const parent = info.bone.parent!;
    parent.getWorldQuaternion(_q);
    _q2.copy(_q).invert().multiply(qWorld).multiply(_q);
    info.bone.quaternion.premultiply(_q2);
    info.bone.updateMatrixWorld(true);
  }

  /** Point a bone's main axis along a world direction (minimal swing from rest). */
  private aim(name: string, dirWorld: THREE.Vector3) {
    const info = this.bones[name];
    if (!info) return;
    const bone = info.bone;
    const parent = bone.parent!;
    parent.getWorldQuaternion(_q);
    _q2.copy(_q).multiply(info.restQ); // rest world orientation under the current parent
    _v.copy(info.restDir).applyQuaternion(_q2);
    _q3.setFromUnitVectors(_v.normalize(), _v2.copy(dirWorld).normalize());
    _q3.multiply(_q2); // desired world orientation
    bone.quaternion.copy(_q.invert().multiply(_q3));
    bone.updateMatrixWorld(true);
  }

  private worldPos(name: string, out: THREE.Vector3) {
    return this.bones[name]?.bone.getWorldPosition(out) ?? out.set(0, 0, 0);
  }

  /** Two-bone IK: upper -> lower -> end, reaching `target` with the joint bending toward `pole`. */
  private ik2(upper: string, lower: string, target: THREE.Vector3, pole: THREE.Vector3) {
    const A = this.worldPos(upper, new THREE.Vector3());
    const scale = this.root.scale.x;
    const la = this.bones[upper].length * scale * this.modelScale();
    const lb = this.bones[lower].length * scale * this.modelScale();
    const toT = new THREE.Vector3().subVectors(target, A);
    let d = toT.length();
    d = THREE.MathUtils.clamp(d, Math.abs(la - lb) + 1e-3, la + lb - 1e-4);
    const dir = toT.normalize();
    // angle at A via law of cosines
    const cosA = THREE.MathUtils.clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    // bend plane from pole
    const poleDir = new THREE.Vector3().subVectors(pole, A);
    const perp = poleDir.sub(dir.clone().multiplyScalar(poleDir.dot(dir)));
    if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1);
    perp.normalize();
    const joint = A.clone().addScaledVector(dir, cosA * la).addScaledVector(perp, sinA * la);
    this.aim(upper, joint.clone().sub(A));
    const J = this.worldPos(lower, new THREE.Vector3());
    const end = A.clone().addScaledVector(dir, d);
    this.aim(lower, end.sub(J));
  }

  /** Bone lengths are in model space; the cloned scene may carry an internal scale. */
  private _ms = -1;
  private modelScale() {
    if (this._ms < 0) {
      const s = new THREE.Vector3();
      this.bones.hips.bone.parent!.getWorldScale(s);
      this._ms = s.x / (this.root.scale.x || 1);
    }
    return this._ms;
  }

  /** Model-space point (relative to the player's root and facing) to world. */
  private toWorld(x: number, y: number, z: number, out = new THREE.Vector3()) {
    out.set(x, y, z);
    return this.root.localToWorld(out);
  }

  update(p: PoseInput) {
    const s = this.smooth;
    const dt = Math.min(p.dt, 0.05);
    s.idleT += dt;
    this.root.position.set(p.x, 0, p.z);
    this.root.rotation.set(0, p.facing, 0);
    const scale = p.heightM / MODEL_HEIGHT;
    this.root.scale.setScalar(scale);
    this.root.updateMatrixWorld(true);
    this.resetPose();
    this.model.updateMatrixWorld(true);

    // local velocity (model space, per model unit)
    const cos = Math.cos(-p.facing), sin = Math.sin(-p.facing);
    const lvx = (p.vx * cos + p.vz * sin) / scale;
    const lvz = (-p.vx * sin + p.vz * cos) / scale;
    const speed = Math.hypot(p.vx, p.vz);
    const act = p.action;
    const tN = p.actionDur > 0 ? THREE.MathUtils.clamp(p.actionT / p.actionDur, 0, 1) : 0;

    // ----- body posture
    const targetCrouch = p.stance ? 0.22 : act === "post" ? 0.18 : p.dribbling ? 0.1 : act === "fall" ? 0 : 0.03 + Math.min(speed, 8) * 0.008;
    s.crouch = THREE.MathUtils.damp(s.crouch, p.airborne ? 0.02 : targetCrouch, 10, dt);
    const targetLean = THREE.MathUtils.clamp(lvz * 0.035, -0.12, 0.3) + (p.stance ? 0.18 : 0) + (p.dribbling ? 0.1 : 0);
    s.lean = THREE.MathUtils.damp(s.lean, targetLean, 8, dt);
    s.sideLean = THREE.MathUtils.damp(s.sideLean, THREE.MathUtils.clamp(-lvx * 0.03, -0.15, 0.15), 8, dt);

    // gait phase
    const strideLen = 1.1 + Math.min(speed, 9) * 0.16;
    const moving = speed > 0.25 && !p.airborne && act !== "fall";
    if (moving) this.gait = (this.gait + (speed / strideLen) * dt) % 1;
    const bob = moving ? Math.abs(Math.cos(this.gait * Math.PI * 2)) * 0.03 * Math.min(1, speed / 4) : Math.sin(s.idleT * 2.2) * 0.004;

    const hips = this.b("hips");
    const rootY = (p.y / scale) - s.crouch * 0.55 - bob;
    hips.bone.position.copy(hips.restPos);
    // hips parent may be the armature node: move along its local up
    hips.bone.position.y += rootY * (1 / (this.modelScale() || 1));
    // fall: rotate the whole body back
    if (act === "fall") {
      const k = Math.min(1, p.actionT / 0.45);
      this.model.rotation.x = -k * 1.25;
      this.model.position.y = k * 0.12;
      this.model.position.z = -k * 0.4;
    } else {
      this.model.rotation.x = 0;
      this.model.position.set(0, 0, 0);
    }
    this.model.updateMatrixWorld(true);
    const qModel = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.facing, 0));
    const worldRot = (x: number, y: number, z: number) => {
      const e = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "YXZ"));
      return qModel.clone().multiply(e).multiply(qModel.clone().invert());
    };
    // spine lean and twist
    const twistToBall = 0;
    this.rotateWorld("hips", worldRot(s.lean * 0.4, (moving ? Math.sin(this.gait * Math.PI * 2) * 0.12 : 0), s.sideLean * 0.5));
    this.rotateWorld("spine", worldRot(s.lean * 0.35, twistToBall, s.sideLean * 0.3));
    this.rotateWorld("chest", worldRot(s.lean * 0.25 + Math.sin(s.idleT * 2.2) * 0.01, moving ? -Math.sin(this.gait * Math.PI * 2) * 0.16 : 0, 0));

    // ----- legs
    const hipW = 0.11, stanceW = p.stance ? 0.24 : act === "post" ? 0.2 : 0.13;
    const dirX = speed > 0.1 ? lvx / (Math.hypot(lvx, lvz) || 1) : 0;
    const dirZ = speed > 0.1 ? lvz / (Math.hypot(lvx, lvz) || 1) : 1;
    const half = strideLen / scale / 4;
    for (const [side, sign, off] of [["L", 1, 0], ["R", -1, 0.5]] as const) {
      const ph = (this.gait + off) * Math.PI * 2;
      let fx = sign * stanceW, fz = 0.02, fy = 0.09;
      if (moving) {
        const sw = Math.sin(ph), cw = Math.cos(ph);
        const amp = half * Math.min(1, speed / 1.5);
        fx += dirX * amp * sw;
        fz += dirZ * amp * sw;
        fy += Math.max(0, cw) * (0.08 + Math.min(speed, 8) * 0.018);
      } else if (p.stance) {
        fz += sign * 0.06;
      }
      if (p.airborne) {
        // tuck legs while in the air
        fy = 0.09 + 0.25 + (p.y / scale) * 0.2;
        fz = 0.08 + (side === "L" ? 0.12 : -0.02);
        fx = sign * 0.14;
      }
      if (act === "layup" || act === "dunk") {
        // one-leg takeoff: drive knee up
        if (side === (p.hand === 1 ? "L" : "R") && p.airborne) { fy += 0.35; fz += 0.25; }
      }
      const footT = this.toWorld(fx, fy + (p.y / scale), fz, new THREE.Vector3());
      if (!p.airborne) footT.y = fy * scale; // planted relative to the floor
      const knee = this.toWorld(sign * hipW, 0.6 + p.y / scale, 1.2, new THREE.Vector3());
      this.ik2(`thigh${side}`, `shin${side}`, footT, knee);
      // foot flat, pointing along facing (toe slightly out)
      const fwd = new THREE.Vector3(Math.sin(p.facing + sign * 0.15), p.airborne ? -0.6 : -0.08, Math.cos(p.facing + sign * 0.15));
      this.aim(`foot${side}`, fwd);
    }

    // ----- arms
    const ball = p.ballWorld;
    const H = (y: number) => y; // model-space height helper
    const armPole = (sign: number) => this.toWorld(sign * 0.6, 0.9, -0.6, new THREE.Vector3());
    const setHand = (side: "L" | "R", target: THREE.Vector3, pole?: THREE.Vector3) => {
      this.ik2(`upperarm${side}`, `forearm${side}`, target, pole ?? armPole(side === "L" ? 1 : -1));
    };
    const swing = (side: "L" | "R", sign: number) => {
      const ph = this.gait * Math.PI * 2 + (side === "L" ? Math.PI : 0);
      const amp = moving ? Math.min(0.32, speed * 0.05) : 0;
      return this.toWorld(sign * 0.3, H(1.0) + (moving ? 0.08 + Math.max(0, Math.sin(ph)) * amp * 0.5 : 0) + rootY, 0.06 + Math.sin(ph) * amp, new THREE.Vector3());
    };
    const shoot = (sign: number) => sign; void shoot;
    const sh = p.hand === 1 ? "R" : "L"; // shooting / dribble hand (hand: 1 = right)
    const off = sh === "R" ? "L" : "R";
    const shSign = sh === "L" ? 1 : -1;

    const shootingActs = ["jumper", "fadeaway", "floater", "hook", "freeThrow"];
    if (shootingActs.includes(act)) {
      const rel = Number(p.actionData.release ?? 0.45) || 0.45;
      const released = !!p.actionData.released || p.actionT > rel + 0.02;
      const k = THREE.MathUtils.clamp(p.actionT / Math.max(0.05, rel), 0, 1);
      if (!released) {
        // gather at chest -> set point above the forehead
        const y = THREE.MathUtils.lerp(1.2, act === "hook" ? 2.0 : 1.95, k * k) + rootY;
        const z = THREE.MathUtils.lerp(0.3, act === "fadeaway" ? 0.1 : 0.2, k);
        setHand(sh, this.toWorld(shSign * 0.06, y - 0.05, z, new THREE.Vector3()));
        setHand(off, this.toWorld(-shSign * 0.14, y + 0.02, z + 0.02, new THREE.Vector3()));
      } else {
        // follow through: shooting arm up and out, wrist snapped
        setHand(sh, this.toWorld(shSign * 0.1, 2.28 + rootY, 0.42, new THREE.Vector3()), this.toWorld(shSign * 0.5, 1.6, -0.3, new THREE.Vector3()));
        setHand(off, this.toWorld(-shSign * 0.3, 1.95 + rootY, 0.18, new THREE.Vector3()));
        this.rotateWorld(`hand${sh}`, worldRot(0.9, 0, 0));
      }
    } else if (act === "layup" || act === "dunk") {
      const rel = Number(p.actionData.release ?? 0.5) || 0.5;
      const k = THREE.MathUtils.clamp(p.actionT / rel, 0, 1);
      const top = act === "dunk" ? 2.45 : 2.3;
      setHand(sh, this.toWorld(shSign * 0.12, THREE.MathUtils.lerp(1.25, top, k) + rootY, THREE.MathUtils.lerp(0.25, 0.45, k), new THREE.Vector3()));
      setHand(off, k < 0.7 ? this.toWorld(-shSign * 0.12, 1.3 + rootY + k * 0.5, 0.3, new THREE.Vector3()) : swing(off, -shSign));
      if (act === "dunk" && p.actionT > rel) setHand(sh, this.toWorld(shSign * 0.12, 2.35 + rootY, 0.35, new THREE.Vector3()));
    } else if (act === "block" || act === "rebound") {
      const up = Math.sin(Math.PI * Math.min(1, tN * 1.3));
      setHand("R", this.toWorld(-0.18, 1.5 + up * 0.85 + rootY, 0.25, new THREE.Vector3()));
      setHand("L", act === "rebound" ? this.toWorld(0.18, 1.5 + up * 0.85 + rootY, 0.25, new THREE.Vector3()) : swing("L", 1));
    } else if (act === "pass") {
      const k = THREE.MathUtils.clamp(p.actionT / Math.max(0.05, Number(p.actionData.release ?? 0.15)), 0, 1.4);
      const lob = p.actionData.kind === "lob" || p.actionData.kind === "alley";
      const y = (lob ? 1.65 : 1.25) + rootY;
      const z = 0.25 + Math.min(1, k) * 0.35;
      setHand("R", this.toWorld(-0.12 * (1 + k * 0.4), y, z, new THREE.Vector3()));
      setHand("L", this.toWorld(0.12 * (1 + k * 0.4), y, z, new THREE.Vector3()));
    } else if (act === "steal") {
      const k = Math.sin(Math.PI * tN);
      setHand(sh, this.toWorld(shSign * 0.15, 0.95 + rootY, 0.3 + k * 0.45, new THREE.Vector3()));
      setHand(off, swing(off, -shSign));
    } else if (p.celebrate) {
      const pump = Math.abs(Math.sin(s.idleT * 6));
      setHand("R", this.toWorld(-0.25, 1.9 + pump * 0.35 + rootY, 0.1, new THREE.Vector3()));
      setHand("L", swing("L", 1));
    } else if (p.hasBall) {
      // dribbling: hand follows the ball on top; off-arm protects
      if (p.dribbling && ball) {
        const top = this.toWorld(0, 0, 0, new THREE.Vector3());
        void top;
        const handT = ball.clone();
        handT.y = Math.max(ball.y + 0.12 * scale, 0.6 * scale);
        setHand(sh, handT, this.toWorld(shSign * 0.7, 1.0, -0.4, new THREE.Vector3()));
        setHand(off, this.toWorld(-shSign * 0.38, 1.1 + rootY, 0.32, new THREE.Vector3()), this.toWorld(-shSign * 0.8, 1.0, 0, new THREE.Vector3()));
      } else {
        // holding the ball at the chest / hip (triple threat)
        const y = (act === "post" ? 1.1 : 1.15) + rootY;
        setHand("R", this.toWorld(-0.12, y, 0.32, new THREE.Vector3()));
        setHand("L", this.toWorld(0.12, y + 0.02, 0.32, new THREE.Vector3()));
      }
    } else if (p.stance) {
      const flick = Math.sin(s.idleT * 5) * 0.04;
      setHand("R", this.toWorld(-0.55, 1.25 + rootY + flick, 0.25, new THREE.Vector3()), this.toWorld(-0.9, 1.0, -0.2, new THREE.Vector3()));
      setHand("L", this.toWorld(0.5, 1.55 + rootY - flick, 0.28, new THREE.Vector3()), this.toWorld(0.9, 1.0, -0.2, new THREE.Vector3()));
    } else if (act === "screen") {
      setHand("R", this.toWorld(-0.08, 0.95 + rootY, 0.18, new THREE.Vector3()));
      setHand("L", this.toWorld(0.08, 0.95 + rootY, 0.18, new THREE.Vector3()));
    } else if (act === "fall") {
      setHand("R", this.toWorld(-0.45, 0.5, -0.4, new THREE.Vector3()));
      setHand("L", this.toWorld(0.45, 0.5, -0.4, new THREE.Vector3()));
    } else {
      setHand("L", swing("L", 1));
      setHand("R", swing("R", -1));
      if (!moving) {
        // relaxed hands on knees when tired
        if (p.stamina < 0.45) {
          setHand("L", this.toWorld(0.16, 0.62 + rootY, 0.2, new THREE.Vector3()));
          setHand("R", this.toWorld(-0.16, 0.62 + rootY, 0.2, new THREE.Vector3()));
          this.rotateWorld("spine", worldRot(0.5, 0, 0));
        }
      }
    }

    // fingers: curl slightly; more when holding the ball
    const curl = p.hasBall ? 0.35 : 0.55;
    for (const side of ["L", "R"] as const) {
      for (const f of ["index", "middle", "ring", "pinky"]) {
        for (const seg of [1, 2]) {
          const info = this.bones[`${f}${seg}${side}`];
          if (info) info.bone.quaternion.multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), curl * (seg === 1 ? 0.6 : 0.9)));
        }
      }
    }

    // ----- head look-at
    if (p.lookAt) {
      const headP = this.worldPos("head", new THREE.Vector3());
      const toL = new THREE.Vector3().subVectors(p.lookAt, headP);
      const yaw = THREE.MathUtils.clamp(Math.atan2(toL.x, toL.z) - p.facing, -1.1, 1.1);
      const wrapped = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      const pitch = THREE.MathUtils.clamp(-Math.atan2(toL.y, Math.hypot(toL.x, toL.z)), -0.6, 0.5);
      this.rotateWorld("neck", worldRot(pitch * 0.4, THREE.MathUtils.clamp(wrapped, -1, 1) * 0.45, 0));
      this.rotateWorld("head", worldRot(pitch * 0.5, THREE.MathUtils.clamp(wrapped, -1, 1) * 0.45, 0));
    }

    this.model.updateMatrixWorld(true);
    this.worldPos(`middle1L`, this.handL);
    this.worldPos(`middle1R`, this.handR);
  }
}

export { _v3 };
