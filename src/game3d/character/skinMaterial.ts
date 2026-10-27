// Skin shader: MeshStandardMaterial + baked masks for scalp hair, fades, cornrows,
// waves, brows, stubble/beards, lip tint and cavity darkening.
import * as THREE from "three";

export interface SkinLook {
  tone: THREE.Color;
  hairColor: THREE.Color;
  /** 0..1 weights for each mask channel. */
  scalp: number;
  fade: number;
  cornrows: number;
  waves: number;
  brows: number;
  stubble: number;
  goatee: number;
  mustache: number;
  fullBeard: number;
}

export interface MaskSet {
  A: THREE.Texture;
  B: THREE.Texture;
  C: THREE.Texture;
  D: THREE.Texture;
}

export function createSkinMaterial(masks: MaskSet, look: SkinLook): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: look.tone, roughness: 0.52, metalness: 0 });
  const uniforms = {
    uMaskA: { value: masks.A },
    uMaskB: { value: masks.B },
    uMaskC: { value: masks.C },
    uMaskD: { value: masks.D },
    uHair: { value: look.hairColor.clone() },
    uHairW1: { value: new THREE.Vector4(look.scalp, look.fade, look.cornrows, look.waves) },
    uHairW2: { value: new THREE.Vector4(look.brows, look.stubble, look.goatee, look.mustache) },
    uHairW3: { value: look.fullBeard },
  };
  mat.userData.skinUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vSkinUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvSkinUv = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec2 vSkinUv;
uniform sampler2D uMaskA; uniform sampler2D uMaskB; uniform sampler2D uMaskC; uniform sampler2D uMaskD;
uniform vec3 uHair; uniform vec4 uHairW1; uniform vec4 uHairW2; uniform float uHairW3;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  vec3 mA = texture2D(uMaskA, vSkinUv).rgb;
  vec3 mB = texture2D(uMaskB, vSkinUv).rgb;
  vec3 mC = texture2D(uMaskC, vSkinUv).rgb;
  vec3 mD = texture2D(uMaskD, vSkinUv).rgb;
  float strands = mD.b; // fine noise
  float scalp = max(max(mA.r * uHairW1.x, mA.g * uHairW1.y), max(mD.r * uHairW1.z, mD.g * uHairW1.w));
  float brows = mA.b * uHairW2.x;
  float stub = mB.r * uHairW2.y * 0.55 * smoothstep(0.35, 0.75, strands);
  float beard = max(max(mB.g * uHairW2.z, mB.b * uHairW2.w), mC.r * uHairW3);
  float hair = max(max(scalp * (0.82 + 0.18 * strands), brows * (0.75 + 0.25 * strands)), max(beard * (0.8 + 0.2 * strands), stub));
  // lips: slightly darker and redder
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 0.58, 0.58), mC.g * 0.8);
  // cavity: eye sockets, nostrils, ears
  diffuseColor.rgb *= mix(0.55, 1.0, mC.b);
  diffuseColor.rgb = mix(diffuseColor.rgb, uHair * (0.85 + 0.3 * strands), clamp(hair, 0.0, 1.0));
}`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.85, clamp(max(texture2D(uMaskA, vSkinUv).r * uHairW1.x, texture2D(uMaskC, vSkinUv).r * uHairW3), 0.0, 1.0));`,
      );
  };
  mat.customProgramCacheKey = () => "bl-skin-v1";
  return mat;
}

export function updateSkinLook(mat: THREE.MeshStandardMaterial, look: SkinLook) {
  mat.color.copy(look.tone);
  const u = mat.userData.skinUniforms;
  u.uHair.value.copy(look.hairColor);
  u.uHairW1.value.set(look.scalp, look.fade, look.cornrows, look.waves);
  u.uHairW2.value.set(look.brows, look.stubble, look.goatee, look.mustache);
  u.uHairW3.value = look.fullBeard;
}
