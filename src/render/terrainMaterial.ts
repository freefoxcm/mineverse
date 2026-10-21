import * as THREE from 'three';
import type { TextureAtlas } from './atlas';

export interface TerrainMaterialOptions {
  transparent?: boolean;
  doubleSide?: boolean;
  alphaTest?: number;
  opacity?: number;
}

const VERTEX_SHADER = /* glsl */ `
in vec2 aUv;
in float aLayer;
in vec2 aLight;
in float aShade;
in vec3 aTint;

out vec2 vUv;
out float vLayer;
out vec2 vLight;
out float vShade;
out vec3 vTint;
out float vFogDepth;

void main() {
  vUv = aUv;
  vLayer = aLayer;
  vLight = aLight;
  vShade = aShade;
  vTint = aTint;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uAtlas;
uniform float uDaylight;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uFogColor;
uniform vec3 uSkyTint;
uniform vec3 uBlockTint;
uniform float uAlphaTest;
uniform float uOpacity;
uniform float uUnderwater;
uniform float uTime;
uniform float uWaterLayer;
uniform float uLavaLayer;

in vec2 vUv;
in float vLayer;
in vec2 vLight;
in float vShade;
in vec3 vTint;
in float vFogDepth;

void main() {
  // Water/lava shimmer: tiny animated UV offsets remove the static striped look
  // without needing multi-frame textures.
  vec2 uv = vUv;
  float isWater = step(abs(vLayer - uWaterLayer), 0.5);
  float isLava = step(abs(vLayer - uLavaLayer), 0.5);
  uv.x += isWater * sin(uTime * 0.85 + vUv.y * 11.0) * 0.012;
  uv.y += isWater * cos(uTime * 0.63 + vUv.x * 9.0) * 0.008;
  uv += isLava * vec2(sin(uTime * 0.37) * 0.010, cos(uTime * 0.29) * 0.010);
  vec4 texel = texture(uAtlas, vec3(uv.x, 1.0 - uv.y, vLayer));
  if (texel.a < uAlphaTest) discard;

  float skyLevel = vLight.x;
  float blockLevel = vLight.y;
  float skyCurve = pow(0.8, (1.0 - skyLevel) * 15.0);
  float blockCurve = pow(0.8, (1.0 - blockLevel) * 15.0);
  vec3 light = max(vec3(0.022), max(uSkyTint * skyCurve * uDaylight, uBlockTint * blockCurve));

  vec3 color = texel.rgb * vTint * light * vShade;
  // Slight saturation/contrast lift keeps the pixel palette punchy instead of
  // washing out under the bright daylight lightmap.
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(luma), color, 1.03);
  color = clamp((color - 0.5) * 1.02 + 0.5, 0.0, 1.0);
  color = mix(color, color * vec3(0.55, 0.78, 0.92), uUnderwater * 0.55);

  float fogFactor = smoothstep(uFogNear, uFogFar, vFogDepth);
  color = mix(color, uFogColor, fogFactor);

  gl_FragColor = vec4(color, texel.a * uOpacity);
}
`;

export interface TerrainMaterials {
  opaque: THREE.ShaderMaterial;
  cutout: THREE.ShaderMaterial;
  transparent: THREE.ShaderMaterial;
  all: THREE.ShaderMaterial[];
}

export function createTerrainMaterials(atlas: TextureAtlas): TerrainMaterials {
  const make = (options: TerrainMaterialOptions): THREE.ShaderMaterial =>
    new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas.texture },
        uDaylight: { value: 1 },
        uFogNear: { value: 120 },
        uFogFar: { value: 128 },
        uFogColor: { value: new THREE.Color(0x9fc4ff) },
        uSkyTint: { value: new THREE.Color(0xffffff) },
        uBlockTint: { value: new THREE.Color(0xffb066) },
        uAlphaTest: { value: options.alphaTest ?? 0 },
        uOpacity: { value: options.opacity ?? 1 },
        uUnderwater: { value: 0 },
        uTime: { value: 0 },
        uWaterLayer: { value: 0 },
        uLavaLayer: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: options.transparent ?? false,
      depthWrite: !(options.transparent ?? false),
      side: options.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    });

  const opaque = make({});
  const cutout = make({ alphaTest: 0.5, doubleSide: true });
  const transparent = make({ transparent: true, doubleSide: true, opacity: 0.82 });
  return { opaque, cutout, transparent, all: [opaque, cutout, transparent] };
}
