'use client';

/**
 * The winery plan's renderer.
 *
 * There is exactly one room, one camera, and one set of vessels. The "top-down"
 * plan and the "3D" walkthrough are two poses of that camera, and switching
 * between them is a continuous tween rather than a swap of components — see
 * `lib/wineryScene.ts` for the framing maths that keeps a near-orthographic
 * plan and a perspective orbit on the same camera.
 *
 * Text never goes into the canvas. Labels are DOM nodes the parent renders and
 * this component positions each frame, which keeps Georgian typography, theming
 * and accessibility in the hands of the browser.
 */

import React from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CellarFloor, CellarPlanObject, Vessel, WineLot } from '../lib/wineryState';
import { vesselPlan3dSettings, vesselPlanGridPosition, vesselPlanWorldPosition } from '../lib/wineryPlan3d';
import {
  blendPose,
  easeInOutCubic,
  floorFrameRadius,
  frameDistance,
  horizontalFillLevel,
  ORBIT_FOV,
  orbitPose,
  PLAN_FOV,
  planPose,
  profileFillHeight,
  profileRadiusAt,
  vesselFillRatio,
  vesselFootprintRadius,
  vesselGeometrySignature,
  vesselInletHeight,
  vesselOutletHeight,
  vesselShellSpec,
  wineColorHex,
  type CameraPose,
  type PlanLayer,
  type ProfilePoint,
  type VesselLayerSignal,
  type VesselShellSpec,
} from '../lib/wineryScene';

export type PlanView = 'top-down' | '3d';
export type VesselAccent = 'none' | 'source' | 'destination' | 'candidate' | 'batch' | 'conflict';

export interface WineryPlanCanvasProps {
  view: PlanView;
  floor: CellarFloor;
  vessels: Vessel[];
  lots: WineLot[];
  selectedVesselId: string | null;
  accents: Record<string, VesselAccent>;
  layer: PlanLayer;
  /** What the active layer says about each vessel, keyed by vessel id. */
  signals: Record<string, VesselLayerSignal>;
  /** Vessels to keep lit while a headline filter is on; null means all of them. */
  spotlight: readonly string[] | null;
  /** Hoses to draw: one live transfer being staged, plus recent history. */
  transfers: readonly PlanTransfer[];
  xRay: boolean;
  editing: boolean;
  snapToGrid: boolean;
  reduceMotion: boolean;
  /** Container the parent fills with label chips tagged `data-vessel-label`. */
  overlayRef: React.RefObject<HTMLDivElement | null>;
  onSelectVessel: (vesselId: string, additive: boolean) => void;
  onOpenVessel: (vesselId: string) => void;
  onMoveVessel: (vesselId: string, xGrid: number, yGrid: number) => void;
  onHoverVessel?: (vesselId: string | null) => void;
  /** Reports the dolly as a percentage so an external slider can follow it. */
  onZoomChange?: (percent: number) => void;
  onUnavailable?: () => void;
}

export interface WineryPlanCanvasHandle {
  resetView: () => void;
  zoomTo: (percent: number) => void;
  orbitBy: (radians: number) => void;
  focusVessel: (vesselId: string) => void;
}

/* -------------------------------------------------------------- geometry */

const LATHE_SEGMENTS = 44;
const LIQUID_STATIONS = 64;

function latheFromProfile(profile: ProfilePoint[], segments = LATHE_SEGMENTS): THREE.LatheGeometry {
  return new THREE.LatheGeometry(profile.map(point => new THREE.Vector2(Math.max(point.r, 0), point.y)), segments);
}

/** The wine standing in an upright vessel: the cavity, cut at the fill height. */
function verticalLiquidGeometry(cavity: ProfilePoint[], fillY: number): THREE.LatheGeometry | null {
  const base = cavity[0]?.y ?? 0;
  if (fillY <= base + 0.002) return null;
  const points: ProfilePoint[] = [];
  cavity.forEach(point => { if (point.y < fillY) points.push(point); });
  points.push({ r: Math.max(profileRadiusAt(cavity, fillY), 0.001), y: fillY });
  if (points.length < 2) return null;
  return latheFromProfile(points);
}

/**
 * The wine lying in a vessel on its side. Every station along the axis holds a
 * different circular segment, so the surface narrows towards the heads exactly
 * the way it does in a real barrel.
 */
function horizontalLiquidGeometry(cavity: ProfilePoint[], surfaceX: number): THREE.BufferGeometry | null {
  const base = cavity[0]?.y ?? 0;
  const top = cavity[cavity.length - 1]?.y ?? 0;
  const length = top - base;
  if (length <= 0) return null;
  const arcSteps = 24;
  const stations: Array<{ y: number; r: number; phi: number; halfWidth: number }> = [];
  for (let index = 0; index <= LIQUID_STATIONS; index += 1) {
    const y = base + (index / LIQUID_STATIONS) * length;
    const r = profileRadiusAt(cavity, y);
    const cosine = r > 0 ? Math.max(-1, Math.min(1, surfaceX / r)) : 1;
    stations.push({ y, r, phi: Math.acos(cosine), halfWidth: Math.sqrt(Math.max(0, r * r - surfaceX * surfaceX)) });
  }
  if (!stations.some(station => station.phi > 0.001)) return null;

  const positions: number[] = [];
  const pushTriangle = (a: number[], b: number[], c: number[]) => { positions.push(...a, ...b, ...c); };
  for (let index = 0; index < stations.length - 1; index += 1) {
    const near = stations[index];
    const far = stations[index + 1];
    if (near.phi <= 0.0001 && far.phi <= 0.0001) continue;
    for (let step = 0; step < arcSteps; step += 1) {
      const u0 = (step / arcSteps) * 2 - 1;
      const u1 = ((step + 1) / arcSteps) * 2 - 1;
      const point = (station: typeof near, u: number) => {
        const angle = u * station.phi;
        return [station.r * Math.cos(angle), station.y, station.r * Math.sin(angle)];
      };
      pushTriangle(point(near, u0), point(far, u0), point(far, u1));
      pushTriangle(point(near, u0), point(far, u1), point(near, u1));
    }
    // The free surface: a ribbon joining the two chords.
    const nearLeft = [surfaceX, near.y, -near.halfWidth];
    const nearRight = [surfaceX, near.y, near.halfWidth];
    const farLeft = [surfaceX, far.y, -far.halfWidth];
    const farRight = [surfaceX, far.y, far.halfWidth];
    pushTriangle(nearLeft, farRight, farLeft);
    pushTriangle(nearLeft, nearRight, farRight);
  }
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/* -------------------------------------------------------------- materials */

interface ShellLook {
  kind: string;
  xRay: boolean;
  clean: boolean;
  /** Layer colour washed over the shell, as hex. */
  tint: number;
  /** 0-1 strength of that wash. */
  tintStrength: number;
  /** Faded out because a headline filter is spotlighting other vessels. */
  dim: boolean;
}

interface MaterialLibrary {
  shell: (look: ShellLook) => THREE.MeshStandardMaterial;
  interior: (kind: string) => THREE.MeshStandardMaterial;
  liquid: (color: number) => THREE.MeshPhysicalMaterial;
  surface: (color: number) => THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial;
  hardware: THREE.MeshStandardMaterial;
  gasket: THREE.MeshStandardMaterial;
  dispose: () => void;
}

const SHELL_BASE: Record<string, { color: number; roughness: number; metalness: number }> = {
  steel: { color: 0xc3ccd4, roughness: 0.24, metalness: 0.95 },
  wood: { color: 0x8a5730, roughness: 0.82, metalness: 0.02 },
  clay: { color: 0xa2673f, roughness: 0.93, metalness: 0.01 },
  concrete: { color: 0xb0aea6, roughness: 0.88, metalness: 0.02 },
  plastic: { color: 0xdde5ec, roughness: 0.38, metalness: 0.03 },
};

function createMaterials(timeUniform: { value: number }): MaterialLibrary {
  const cache = new Map<string, THREE.Material>();
  const remember = <T extends THREE.Material>(key: string, build: () => T): T => {
    const existing = cache.get(key);
    if (existing) return existing as T;
    const created = build();
    cache.set(key, created);
    return created;
  };

  const shell = ({ kind, xRay, clean, tint, tintStrength, dim }: ShellLook) => {
    // Strength is bucketed so a room of tanks shares a handful of materials
    // instead of minting one per vessel on every re-render.
    const strength = dim ? 0 : Math.round(Math.min(1, Math.max(0, tintStrength)) * 8) / 8;
    const wash = strength > 0 ? tint : 0;
    return remember(`shell:${kind}:${xRay}:${clean}:${wash}:${strength}:${dim}`, () => {
      const base = SHELL_BASE[kind] || SHELL_BASE.steel;
      const color = new THREE.Color(clean ? base.color : new THREE.Color(base.color).multiplyScalar(0.88).getHex());
      if (strength > 0) color.lerp(new THREE.Color(tint), strength * 0.5);
      const transparent = xRay || dim;
      return new THREE.MeshStandardMaterial({
        color: color.getHex(),
        roughness: clean ? base.roughness : Math.min(1, base.roughness + 0.16),
        metalness: dim ? Math.min(base.metalness, 0.3) : base.metalness,
        // The wash has to survive an unlit corner of the room, so part of it
        // goes into emissive rather than the base colour alone.
        emissive: strength > 0 ? new THREE.Color(tint).multiplyScalar(strength * 0.3).getHex() : 0x000000,
        transparent,
        // Oak, clay and concrete need more of the shell left standing than
        // steel does, or an x-rayed barrel is just a puddle of wine on legs.
        opacity: dim ? 0.18 : xRay ? (kind === 'steel' || kind === 'plastic' ? 0.3 : 0.62) : 1,
        depthWrite: !transparent,
        side: THREE.FrontSide,
      });
    });
  };

  const interior = (kind: string) => remember(`interior:${kind}`, () => {
    const base = SHELL_BASE[kind] || SHELL_BASE.steel;
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(base.color).multiplyScalar(0.42).getHex(),
      roughness: 0.75,
      metalness: kind === 'steel' ? 0.5 : 0.05,
      side: THREE.BackSide,
    });
  });

  const liquid = (color: number) => remember(`liquid:${color}`, () => new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.2,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.25,
    // Wine in a dim cellar reads as a black hole without a little self-glow.
    emissive: new THREE.Color(color).multiplyScalar(0.16).getHex(),
    side: THREE.DoubleSide,
  }));

  const surface = (color: number) => remember(`surface:${color}`, () => {
    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.08).getHex(),
      roughness: 0.08,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      emissive: new THREE.Color(color).multiplyScalar(0.12).getHex(),
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = shaderProgram => {
      shaderProgram.uniforms.uTime = timeUniform;
      shaderProgram.vertexShader = shaderProgram.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vRipple;')
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        float rippleRadius = length( position.xy );
        float rippleTaper = clamp( 1.0 - rippleRadius * rippleRadius * 4.0, 0.0, 1.0 );
        float ripplePhaseA = uTime * 1.7 + position.x * 5.6;
        float ripplePhaseB = uTime * 2.3 + position.y * 6.4;
        objectNormal = normalize( vec3( -cos( ripplePhaseA ) * 0.09 * rippleTaper, -cos( ripplePhaseB ) * 0.11 * rippleTaper, 1.0 ) );
        vRipple = ( sin( ripplePhaseA ) + sin( ripplePhaseB ) ) * 0.5 * rippleTaper;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.z += vRipple * 0.004;`);
    };
    material.customProgramCacheKey = () => 'winery-wine-surface';
    return material;
  });

  const glass = remember('glass', () => new THREE.MeshPhysicalMaterial({
    color: 0xdfeaf2, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.24, depthWrite: false,
  }));
  const hardware = remember('hardware', () => new THREE.MeshStandardMaterial({
    color: 0x8d979f, roughness: 0.32, metalness: 0.9,
  }));
  const gasket = remember('gasket', () => new THREE.MeshStandardMaterial({
    color: 0x2b3138, roughness: 0.85, metalness: 0.05,
  }));

  return {
    shell,
    interior,
    liquid,
    surface,
    glass,
    hardware,
    gasket,
    dispose: () => { cache.forEach(material => material.dispose()); cache.clear(); },
  };
}

/* ---------------------------------------------------------------- vessels */

interface VesselNode {
  group: THREE.Group;
  axisGroup: THREE.Group;
  spec: VesselShellSpec;
  signature: string;
  /** The outer skin, restyled when the layer, x-ray or filter changes. */
  shellMeshes: THREE.Mesh[];
  /** Fittings hidden while the vessel is dimmed by a filter. */
  details: THREE.Object3D[];
  clean: boolean;
  liquidHolder: THREE.Group;
  liquidMesh: THREE.Mesh | null;
  surfaceMesh: THREE.Mesh | null;
  gaugeMesh: THREE.Mesh;
  ringMesh: THREE.Mesh;
  sightColumn: THREE.Mesh | null;
  footprintRadius: number;
  wineColor: number;
  displayRatio: number;
  targetRatio: number;
  labelHeight: number;
}

const ACCENT_COLOR: Record<VesselAccent, number> = {
  none: 0x93a3b1,
  source: 0x8b5cf6,
  destination: 0x22d3ee,
  candidate: 0x38bdf8,
  batch: 0x0ea5e9,
  conflict: 0xfb7185,
};

function buildHardware(node: VesselNode, spec: VesselShellSpec, materials: MaterialLibrary) {
  const { axisGroup } = node;
  const maxRadius = Math.max(spec.crossRadiusA, spec.crossRadiusB);
  const detail = (object: THREE.Object3D, parent: THREE.Object3D) => {
    parent.add(object);
    node.details.push(object);
  };

  if (spec.jacketed && spec.axis === 'vertical') {
    // Two narrow cooling bands rather than one tall sleeve. A full-height
    // jacket is truer to the hardware but hides the half of the shell where
    // the wine level actually is, which is the point of the whole view.
    [0.34, 0.62].forEach(fraction => {
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(maxRadius * 1.04, maxRadius * 1.04, spec.axisLength * 0.11, 40, 1, true),
        materials.hardware,
      );
      band.position.y = spec.axisLength * fraction;
      band.castShadow = true;
      detail(band, axisGroup);
    });
  }

  if (spec.openTop && spec.axis === 'vertical') {
    const rimRadius = profileRadiusAt(spec.outer, spec.axisLength);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(rimRadius, Math.max(0.018, maxRadius * 0.028), 8, 40),
      materials.hardware,
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = spec.axisLength;
    detail(rim, axisGroup);
  } else if (spec.axis === 'vertical') {
    // Closed tanks get a manway with a hinge, which is what reads as "tank"
    // from directly above once the plan camera flattens the room.
    const collarRadius = Math.max(0.1, maxRadius * 0.3);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(collarRadius, collarRadius, 0.07, 20), materials.hardware);
    collar.position.y = spec.axisLength + 0.03;
    collar.castShadow = true;
    detail(collar, axisGroup);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(collarRadius * 1.12, collarRadius * 1.12, 0.03, 20), materials.gasket);
    lid.position.y = spec.axisLength + 0.08;
    detail(lid, axisGroup);
  }

  if (spec.axis === 'horizontal') {
    [0.22, 0.78].forEach(fraction => {
      const hoop = new THREE.Mesh(
        new THREE.TorusGeometry(maxRadius * 1.01, maxRadius * 0.05, 8, 28),
        spec.material === 'wood' ? materials.gasket : materials.hardware,
      );
      hoop.rotation.y = Math.PI / 2;
      hoop.position.y = spec.axisLength * fraction;
      detail(hoop, axisGroup);
    });
  }

  if (spec.legs) {
    const legHeight = Math.max(0.14, node.group.userData.elevation as number);
    const geometry = new THREE.CylinderGeometry(0.032, 0.045, legHeight, 8);
    const offset = maxRadius * 0.72;
    [[-offset, -offset], [offset, -offset], [-offset, offset], [offset, offset]].forEach(([x, z]) => {
      const leg = new THREE.Mesh(geometry, materials.hardware);
      leg.position.set(x, legHeight / 2, z);
      leg.castShadow = true;
      detail(leg, node.group);
    });
  }
}

function buildVesselNode(
  vessel: Vessel,
  lot: WineLot | undefined,
  materials: MaterialLibrary,
  xRay: boolean,
): VesselNode {
  const settings = vesselPlan3dSettings(vessel);
  const spec = vesselShellSpec(vessel, settings);
  const group = new THREE.Group();
  group.userData.vesselId = vessel.id;
  group.userData.elevation = settings.elevationMeters;
  group.rotation.y = THREE.MathUtils.degToRad(settings.rotationDegrees);

  const axisGroup = new THREE.Group();
  const maxRadius = Math.max(spec.crossRadiusA, spec.crossRadiusB) || 0.5;
  if (spec.axis === 'horizontal') {
    axisGroup.rotation.z = -Math.PI / 2;
    axisGroup.position.set(-spec.axisLength / 2, settings.elevationMeters + spec.crossRadiusB, 0);
    axisGroup.scale.set(spec.crossRadiusB / maxRadius, 1, spec.crossRadiusA / maxRadius);
  } else {
    axisGroup.position.y = settings.elevationMeters;
    axisGroup.scale.set(spec.crossRadiusA / maxRadius, 1, spec.crossRadiusB / maxRadius);
  }
  group.add(axisGroup);

  const clean = vessel.cleaningStatus === 'clean';
  const plainShell = { kind: spec.material, xRay, clean, tint: 0, tintStrength: 0, dim: false };
  const shellMeshes: THREE.Mesh[] = [];
  // The inner wall is opaque, so it hides with the fittings when a filter
  // ghosts the vessel — otherwise a dimmed barrel still shows its oak lining.
  const interiorMeshes: THREE.Mesh[] = [];
  if (spec.form === 'box') {
    const box = new THREE.BoxGeometry(settings.widthMeters, settings.heightMeters, settings.depthMeters);
    const body = new THREE.Mesh(box, materials.shell(plainShell));
    body.position.y = settings.heightMeters / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    body.renderOrder = 3;
    axisGroup.add(body);
    shellMeshes.push(body);
    const inner = new THREE.Mesh(box.clone(), materials.interior(spec.material));
    inner.position.y = settings.heightMeters / 2;
    inner.scale.setScalar(0.985);
    axisGroup.add(inner);
    interiorMeshes.push(inner);
  } else {
    const outerGeometry = latheFromProfile(spec.outer);
    const body = new THREE.Mesh(outerGeometry, materials.shell(plainShell));
    body.castShadow = true;
    body.receiveShadow = true;
    body.renderOrder = 3;
    axisGroup.add(body);
    shellMeshes.push(body);
    const inner = new THREE.Mesh(latheFromProfile(spec.cavity), materials.interior(spec.material));
    inner.renderOrder = 1;
    axisGroup.add(inner);
    interiorMeshes.push(inner);
  }

  const liquidHolder = new THREE.Group();
  liquidHolder.renderOrder = 2;
  axisGroup.add(liquidHolder);

  const node: VesselNode = {
    group,
    axisGroup,
    spec,
    signature: vesselGeometrySignature(vessel),
    shellMeshes,
    details: [...interiorMeshes],
    clean,
    liquidHolder,
    liquidMesh: null,
    surfaceMesh: null,
    gaugeMesh: new THREE.Mesh(new THREE.RingGeometry(0.1, 0.11, 8), materials.hardware),
    ringMesh: new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 8, 48), materials.hardware),
    sightColumn: null,
    footprintRadius: vesselFootprintRadius(settings),
    wineColor: wineColorHex(lot?.wineClass),
    displayRatio: vesselFillRatio(vessel),
    targetRatio: vesselFillRatio(vessel),
    labelHeight: Math.max(0.5, settings.elevationMeters + settings.heightMeters) + 0.32,
  };

  buildHardware(node, spec, materials);

  if (spec.sightGlass) {
    // A level gauge on the shell, so the fill stays readable even when the
    // x-ray shell is switched off and the tank is honest opaque steel.
    const glassHeight = spec.axisLength * 0.72;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, glassHeight, 12), materials.glass);
    tube.position.set(maxRadius * 1.02, settings.elevationMeters + spec.axisLength * 0.5, 0);
    tube.renderOrder = 4;
    group.add(tube);
    node.details.push(tube);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 12), materials.liquid(node.wineColor));
    column.position.x = maxRadius * 1.02;
    column.userData.gaugeHeight = glassHeight;
    column.userData.gaugeBase = settings.elevationMeters + spec.axisLength * 0.14;
    group.add(column);
    node.details.push(column);
    node.sightColumn = column;
  }

  // Floor gauge: an arc under the vessel that fills with the wine level. It is
  // the one fill cue that survives being looked at from straight overhead.
  const gaugeInner = node.footprintRadius * 1.08;
  const gaugeOuter = node.footprintRadius * 1.17;
  const track = new THREE.Mesh(
    new THREE.RingGeometry(gaugeInner, gaugeOuter, 56),
    new THREE.MeshBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.34, side: THREE.DoubleSide }),
  );
  track.rotation.x = -Math.PI / 2;
  track.position.y = 0.014;
  group.add(track);

  node.gaugeMesh = new THREE.Mesh(
    new THREE.RingGeometry(gaugeInner, gaugeOuter, 56, 1, Math.PI / 2, 0.001),
    new THREE.MeshBasicMaterial({ color: node.wineColor, transparent: true, opacity: 0.96, side: THREE.DoubleSide }),
  );
  node.gaugeMesh.rotation.x = -Math.PI / 2;
  node.gaugeMesh.position.y = 0.018;
  group.add(node.gaugeMesh);

  node.ringMesh = new THREE.Mesh(
    new THREE.TorusGeometry(gaugeOuter + 0.05, 0.022, 8, 56),
    new THREE.MeshBasicMaterial({ color: ACCENT_COLOR.none, transparent: true, opacity: 0.4 }),
  );
  node.ringMesh.rotation.x = Math.PI / 2;
  node.ringMesh.position.y = 0.026;
  group.add(node.ringMesh);

  group.traverse(object => { object.userData.vesselId = vessel.id; });
  return node;
}

function applyFill(node: VesselNode, ratio: number, materials: MaterialLibrary) {
  node.displayRatio = ratio;
  node.liquidHolder.children.slice().forEach(child => {
    node.liquidHolder.remove(child);
    (child as THREE.Mesh).geometry?.dispose();
  });
  node.liquidMesh = null;
  node.surfaceMesh = null;

  const gauge = node.gaugeMesh;
  gauge.geometry.dispose();
  const inner = node.footprintRadius * 1.08;
  const outer = node.footprintRadius * 1.17;
  gauge.geometry = new THREE.RingGeometry(inner, outer, 56, 1, Math.PI / 2, Math.max(0.0005, ratio * Math.PI * 2));
  gauge.visible = ratio > 0.001;

  if (node.sightColumn) {
    const height = Math.max(0.001, (node.sightColumn.userData.gaugeHeight as number) * ratio);
    node.sightColumn.scale.y = height;
    node.sightColumn.position.y = (node.sightColumn.userData.gaugeBase as number) + height / 2;
    node.sightColumn.visible = ratio > 0.002;
  }

  if (ratio <= 0.001) return;
  const { spec } = node;

  if (spec.form === 'box') {
    const cavityHeight = spec.axisLength - 0.04;
    const height = Math.max(0.004, cavityHeight * ratio);
    const width = spec.crossRadiusA * 1.94;
    const depth = spec.crossRadiusB * 1.94;
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials.liquid(node.wineColor));
    body.position.y = 0.02 + height / 2;
    node.liquidHolder.add(body);
    node.liquidMesh = body;
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(width, depth, 12, 12), materials.surface(node.wineColor));
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = 0.02 + height;
    node.liquidHolder.add(surface);
    node.surfaceMesh = surface;
    return;
  }

  if (spec.axis === 'horizontal') {
    const level = horizontalFillLevel(spec.cavity, ratio);
    const geometry = horizontalLiquidGeometry(spec.cavity, -level);
    if (!geometry) return;
    const body = new THREE.Mesh(geometry, materials.liquid(node.wineColor));
    node.liquidHolder.add(body);
    node.liquidMesh = body;
    return;
  }

  const fillY = profileFillHeight(spec.cavity, ratio);
  const geometry = verticalLiquidGeometry(spec.cavity, fillY);
  if (!geometry) return;
  const body = new THREE.Mesh(geometry, materials.liquid(node.wineColor));
  node.liquidHolder.add(body);
  node.liquidMesh = body;
  const surfaceRadius = Math.max(0.02, profileRadiusAt(spec.cavity, fillY));
  const surface = new THREE.Mesh(new THREE.CircleGeometry(surfaceRadius, 40, 0, Math.PI * 2), materials.surface(node.wineColor));
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = fillY;
  node.liquidHolder.add(surface);
  node.surfaceMesh = surface;
}

/* ------------------------------------------------------------------ scene */

interface Runtime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  vesselRoot: THREE.Group;
  fixtureRoot: THREE.Group;
  transferRoot: THREE.Group;
  flowTexture: THREE.Texture;
  groundPlane: THREE.Mesh;
  sun: THREE.DirectionalLight;
  nodes: Map<string, VesselNode>;
  materials: MaterialLibrary;
  timeUniform: { value: number };
  frame: number;
  lastFrameAt: number;
  /** Bounding radius of the room, used to scale fog and shadows. */
  extent: number;
  pose: CameraPose;
  tween: { from: CameraPose; to: CameraPose; start: number; duration: number } | null;
  planZoom: number;
  orbitZoom: number;
  reportedZoom: number;
  savedOrbit: { azimuth: number; polar: number; targetX: number; targetZ: number };
  view: PlanView;
  drag: { vesselId: string; moved: boolean; pointerId: number } | null;
  press: { x: number; y: number; at: number; vesselId: string | null } | null;
  disposed: boolean;
}

/** The pose this view settles into, framed for the canvas's current aspect. */
function poseFor(runtime: Runtime, floor: CellarFloor, zoom = 1): CameraPose {
  return runtime.view === 'top-down'
    ? planPose(floor, zoom, runtime.camera.aspect)
    : orbitPose(floor, runtime.savedOrbit, zoom, runtime.camera.aspect);
}

/** Frame radius a pose of zoom 1 would use for the current view. */
function baseFrameRadius(runtime: Runtime, floor: CellarFloor): number {
  return poseFor(runtime, floor).frameRadius;
}

/** World radius the camera currently frames, derived from its dolly and lens. */
function liveFrameRadius(runtime: Runtime): number {
  const distance = runtime.camera.position.distanceTo(runtime.controls.target);
  return distance * Math.sin((runtime.camera.fov * Math.PI) / 360);
}

/**
 * Depth haze measured from the subject, not from the camera. Scaling the fog
 * with the camera distance instead would wash the whole room out the moment
 * the plan camera pulls back to a few hundred metres.
 */
function applyFog(runtime: Runtime, distance: number) {
  const fog = runtime.scene.fog as THREE.Fog | null;
  if (!fog) return;
  fog.near = distance + runtime.extent * 0.3;
  fog.far = distance + runtime.extent * 3.2;
}

function applyPose(runtime: Runtime, pose: CameraPose) {
  const { camera, controls } = runtime;
  const distance = frameDistance(pose.frameRadius, pose.fov);
  camera.fov = pose.fov;
  camera.near = Math.max(0.05, distance * 0.02);
  camera.far = distance * 3 + pose.frameRadius * 8;
  camera.updateProjectionMatrix();
  const target = new THREE.Vector3(pose.targetX, pose.targetY, pose.targetZ);
  const offset = new THREE.Vector3().setFromSphericalCoords(distance, pose.polar, pose.azimuth);
  camera.position.copy(target).add(offset);
  controls.target.copy(target);
  camera.lookAt(target);
  applyFog(runtime, distance);
  runtime.pose = pose;
}

function constrainControls(runtime: Runtime) {
  const { controls } = runtime;
  const plan = runtime.view === 'top-down';
  const distance = frameDistance(runtime.pose.frameRadius, runtime.pose.fov);
  controls.enableRotate = !plan;
  controls.minPolarAngle = plan ? 0 : 0.08;
  controls.maxPolarAngle = plan ? 0.0001 : Math.PI * 0.49;
  controls.minDistance = plan ? distance * 0.18 : 1.8;
  controls.maxDistance = plan ? distance * 4 : Math.max(12, runtime.pose.frameRadius * 8);
  controls.screenSpacePanning = plan;
  controls.update();
}

function gradientTexture(top: string, bottom: string): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 8, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function floorTexture(floor: CellarFloor): THREE.CanvasTexture {
  const pixelsPerMetre = 32;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(16, Math.round(floor.gridMeters * pixelsPerMetre));
  canvas.height = canvas.width;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#565f6a';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(226,235,242,.1)';
  context.lineWidth = 1.5;
  context.strokeRect(0.75, 0.75, canvas.width - 1.5, canvas.height - 1.5);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(floor.widthMeters / floor.gridMeters, floor.heightMeters / floor.gridMeters);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const ZONE_COLOR: Record<string, number> = {
  general: 0x94a3b8, receiving: 0xa3e635, fermentation: 0xa78bfa, aging: 0xfbbf24,
  bottling: 0x38bdf8, laboratory: 0x22d3ee, storage: 0xfb923c, utility: 0xa8a29e,
};

const FIXTURE_COLOR: Record<string, number> = {
  door: 0xfcd34d, drain: 0x38bdf8, water: 0x22d3ee, power: 0xfbbf24, pump: 0xa3a3a3, press: 0xf97316,
};

function buildFixtures(root: THREE.Group, floor: CellarFloor) {
  (floor.planObjects || []).forEach((object: CellarPlanObject) => {
    const x = object.xMeters - floor.widthMeters / 2;
    const z = object.yMeters - floor.heightMeters / 2;
    if (object.kind === 'zone') {
      const color = ZONE_COLOR[object.zoneUse || 'general'] || ZONE_COLOR.general;
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(object.widthMeters, object.heightMeters),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
      );
      plate.rotation.x = -Math.PI / 2;
      plate.rotation.z = -THREE.MathUtils.degToRad(object.rotation || 0);
      plate.position.set(x, 0.008, z);
      plate.renderOrder = -1;
      root.add(plate);
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(object.widthMeters, object.heightMeters)),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }),
      );
      border.rotation.copy(plate.rotation);
      border.position.set(x, 0.01, z);
      root.add(border);
      return;
    }
    const height = object.kind === 'press' || object.kind === 'pump' ? 0.9 : 0.12;
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(object.widthMeters, height, object.heightMeters),
      new THREE.MeshStandardMaterial({ color: FIXTURE_COLOR[object.kind] || 0x94a3b8, roughness: 0.6, metalness: 0.25 }),
    );
    block.position.set(x, height / 2, z);
    block.rotation.y = -THREE.MathUtils.degToRad(object.rotation || 0);
    block.castShadow = height > 0.3;
    block.receiveShadow = true;
    root.add(block);
  });
}

function disposeTree(root: THREE.Object3D) {
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
  });
}

/**
 * Hoses own their materials rather than drawing from the shared cache, because
 * each carries the colour of the wine moving through it.
 */
function disposeTransfers(runtime: Runtime) {
  runtime.transferRoot.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach(material => material?.dispose());
  });
  runtime.transferRoot.clear();
}

/* --------------------------------------------------------------- transfers */

export interface PlanTransfer {
  sourceId: string;
  destinationId: string;
  /** Wine colour of the source, as hex. */
  color: number;
  /** Faded and static: a transfer that already happened. */
  historic?: boolean;
}

/** Repeating chevrons that scroll along the hose to show which way wine runs. */
function flowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 16;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 64, 16);
  context.fillStyle = 'rgba(0,0,0,.55)';
  context.beginPath();
  context.moveTo(8, 2);
  context.lineTo(26, 8);
  context.lineTo(8, 14);
  context.lineTo(16, 8);
  context.closePath();
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The hose. It leaves the source at its racking valve, arcs over the room, and
 * drops into the destination's inlet — the same two heights the gravity-versus-
 * pump readout is computed from, so the picture and the number agree.
 */
function buildTransferHose(
  from: THREE.Vector3,
  to: THREE.Vector3,
  color: number,
  texture: THREE.Texture,
  historic: boolean,
): THREE.Group {
  const group = new THREE.Group();
  const apex = Math.max(from.y, to.y) + (historic ? 0.9 : 1.8);
  const curve = new THREE.CatmullRomCurve3([
    from,
    new THREE.Vector3(from.x, from.y + (apex - from.y) * 0.72, from.z),
    new THREE.Vector3((from.x + to.x) / 2, apex, (from.z + to.z) / 2),
    new THREE.Vector3(to.x, to.y + (apex - to.y) * 0.82, to.z),
    to,
  ], false, 'catmullrom', 0.35);

  // Wine is dark by nature and the cellar floor is mid-grey, so the hose keeps
  // the wine's hue but is lifted towards white, and a live one gets a pale
  // casing behind it the way a route is drawn on a map.
  const tint = new THREE.Color(color).lerp(new THREE.Color(0xffffff), historic ? 0.32 : 0.45).getHex();
  const radius = historic ? 0.045 : 0.12;
  const geometry = new THREE.TubeGeometry(curve, 72, radius, 10, false);
  const material = historic
    ? new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.5, depthWrite: false })
    : new THREE.MeshBasicMaterial({ color: tint, map: texture });
  if (!historic) {
    material.map!.repeat.set(Math.max(3, Math.round(curve.getLength() * 1.6)), 1);
  }
  const hose = new THREE.Mesh(geometry, material);
  hose.renderOrder = 6;
  group.add(hose);

  if (!historic) {
    // Outline drawn as the back faces of a slightly fatter tube. A translucent
    // sleeve would paint over the hose instead of behind it: the hose is
    // opaque, so it renders in the opaque pass and every transparent object
    // lands on top of it whatever its render order says.
    const outline = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 48, radius * 1.8, 8, false),
      new THREE.MeshBasicMaterial({ color: 0x111c2b, side: THREE.BackSide }),
    );
    outline.renderOrder = 5;
    group.add(outline);

    // An arrowhead at the receiving end, so direction survives being read from
    // straight overhead where the arc flattens into a line.
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 0.48, 14),
      new THREE.MeshBasicMaterial({ color: tint }),
    );
    const tangent = curve.getTangentAt(0.985).normalize();
    head.position.copy(to).addScaledVector(tangent, -0.2);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    head.renderOrder = 6;
    group.add(head);
  }
  return group;
}

/* ----------------------------------------------------------------- labels */

interface LabelCandidate {
  chip: HTMLElement;
  caption: HTMLElement | null;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  priority: number;
  dimmed: boolean;
}

const COLLAPSED_WIDTH = 24;
const COLLAPSED_HEIGHT = 20;

const overlaps = (
  placed: Array<[number, number, number, number]>,
  x: number, y: number, width: number, height: number,
) => placed.some(([left, top, right, bottom]) => (
  x - width / 2 < right && x + width / 2 > left && y - height / 2 < bottom && y + height / 2 > top
));

/**
 * Projects the DOM chips onto their vessels and thins them out where they would
 * pile up. A chip that cannot fit at full size shrinks to its wine-colour dot
 * before it is dropped, so a crowded corner of the cellar still shows what is
 * standing there.
 */
function placeLabels(
  runtime: Runtime,
  overlay: HTMLElement,
  canvas: HTMLElement,
  projection: THREE.Vector3,
) {
  const { camera } = runtime;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const planShare = THREE.MathUtils.clamp((ORBIT_FOV - camera.fov) / (ORBIT_FOV - PLAN_FOV), 0, 1);
  const candidates: LabelCandidate[] = [];

  for (let index = 0; index < overlay.children.length; index += 1) {
    const chip = overlay.children[index] as HTMLElement;
    const vesselId = chip.dataset.vesselLabel;
    if (!vesselId) continue;
    const node = runtime.nodes.get(vesselId);
    if (!node) { chip.style.opacity = '0'; chip.style.pointerEvents = 'none'; continue; }
    if (chip.dataset.projected !== '1') {
      // The chip ships with percentage coordinates so it lands sensibly in
      // server markup and on devices without WebGL; once the camera owns it,
      // that static offset has to go or the two stack.
      chip.style.left = '0px';
      chip.style.top = '0px';
      chip.dataset.projected = '1';
    }
    // Overhead, the label belongs on the vessel; from an angle it lifts clear
    // of the tank so it does not sit over the wine.
    projection
      .set(node.group.position.x, node.labelHeight * (1 - planShare * 0.92), node.group.position.z)
      .project(camera);
    if (projection.z > 1) { chip.style.opacity = '0'; chip.style.pointerEvents = 'none'; continue; }

    const caption = chip.querySelector<HTMLElement>('[data-chip-caption]');
    if (caption) caption.style.display = '';
    const signature = `${chip.dataset.caption || ''}`;
    if (chip.dataset.sizedFor !== signature) {
      chip.dataset.sizedFor = signature;
      chip.dataset.chipWidth = String(chip.offsetWidth);
      chip.dataset.chipHeight = String(chip.offsetHeight);
    }
    candidates.push({
      chip,
      caption,
      x: (projection.x * 0.5 + 0.5) * width,
      y: (-projection.y * 0.5 + 0.5) * height,
      width: Number(chip.dataset.chipWidth) || 90,
      height: Number(chip.dataset.chipHeight) || 22,
      depth: projection.z,
      priority: Number(chip.dataset.chipPriority) || 0,
      dimmed: chip.dataset.chipDimmed === '1',
    });
  }

  candidates.sort((left, right) => right.priority - left.priority || left.depth - right.depth);
  const placed: Array<[number, number, number, number]> = [];
  candidates.forEach(candidate => {
    const { chip, caption } = candidate;
    let boxWidth = candidate.width;
    let boxHeight = candidate.height;
    let visible = true;
    if (overlaps(placed, candidate.x, candidate.y, boxWidth, boxHeight)) {
      boxWidth = COLLAPSED_WIDTH;
      boxHeight = COLLAPSED_HEIGHT;
      if (caption) caption.style.display = 'none';
      visible = !overlaps(placed, candidate.x, candidate.y, boxWidth, boxHeight);
    }
    chip.style.transform = `translate3d(${Math.round(candidate.x)}px, ${Math.round(candidate.y)}px, 0) translate(-50%, -50%)`;
    chip.style.opacity = visible ? (candidate.dimmed ? '0.3' : '1') : '0';
    chip.style.pointerEvents = visible ? 'auto' : 'none';
    chip.style.zIndex = String(1000 - Math.round(candidate.depth * 900));
    if (!visible) return;
    placed.push([
      candidate.x - boxWidth / 2,
      candidate.y - boxHeight / 2,
      candidate.x + boxWidth / 2,
      candidate.y + boxHeight / 2,
    ]);
  });
}

/* -------------------------------------------------------------- component */

const WineryPlanCanvas = React.forwardRef<WineryPlanCanvasHandle, WineryPlanCanvasProps>(function WineryPlanCanvas({
  view,
  floor,
  vessels,
  lots,
  selectedVesselId,
  accents,
  layer,
  signals,
  spotlight,
  transfers,
  xRay,
  editing,
  snapToGrid,
  reduceMotion,
  overlayRef,
  onSelectVessel,
  onOpenVessel,
  onMoveVessel,
  onHoverVessel,
  onZoomChange,
  onUnavailable,
}, ref) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const runtimeRef = React.useRef<Runtime | null>(null);
  const [ready, setReady] = React.useState(0);

  // Callbacks and fast-changing inputs are read through refs so the scene is
  // built once per room rather than once per render.
  const handlers = React.useRef({ onSelectVessel, onOpenVessel, onMoveVessel, onHoverVessel, onZoomChange });
  handlers.current = { onSelectVessel, onOpenVessel, onMoveVessel, onHoverVessel, onZoomChange };
  const editingRef = React.useRef(editing);
  editingRef.current = editing;
  const snapRef = React.useRef(snapToGrid);
  snapRef.current = snapToGrid;
  const floorRef = React.useRef(floor);
  floorRef.current = floor;
  const viewRef = React.useRef(view);
  const reduceMotionRef = React.useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      onUnavailable?.();
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.className = 'h-full w-full touch-none outline-none';
    container.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    const backdrop = gradientTexture('#8ea0ad', '#4a565f');
    scene.background = backdrop;
    scene.fog = new THREE.Fog(0x66727d, 20, 60);

    const environment = new THREE.PMREMGenerator(renderer);
    environment.compileEquirectangularShader();
    const room = new RoomEnvironment();
    const envTexture = environment.fromScene(room, 0.04).texture;
    scene.environment = envTexture;
    scene.environmentIntensity = 0.7;
    room.dispose?.();
    environment.dispose();

    const camera = new THREE.PerspectiveCamera(ORBIT_FOV, 1, 0.1, 400);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.zoomSpeed = 0.9;

    scene.add(new THREE.HemisphereLight(0xdff0ff, 0x2c2f33, 1.05));
    const sun = new THREE.DirectionalLight(0xfff4e2, 2.6);
    sun.position.set(-floor.widthMeters * 0.45, Math.max(14, floor.widthMeters * 0.8), floor.heightMeters * 0.55);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const shadowExtent = Math.max(floor.widthMeters, floor.heightMeters) * 0.72;
    sun.shadow.camera.left = -shadowExtent;
    sun.shadow.camera.right = shadowExtent;
    sun.shadow.camera.top = shadowExtent;
    sun.shadow.camera.bottom = -shadowExtent;
    sun.shadow.camera.far = shadowExtent * 4;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    scene.add(sun.target);

    const surroundings = new THREE.Mesh(
      new THREE.PlaneGeometry(floor.widthMeters * 6, floor.heightMeters * 6),
      new THREE.MeshStandardMaterial({ color: 0x4a525b, roughness: 1, metalness: 0 }),
    );
    surroundings.rotation.x = -Math.PI / 2;
    surroundings.position.y = -0.04;
    surroundings.receiveShadow = true;
    scene.add(surroundings);

    const slab = floorTexture(floor);
    const groundPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(floor.widthMeters, floor.heightMeters),
      new THREE.MeshStandardMaterial({ map: slab, color: 0xffffff, roughness: 0.72, metalness: 0.04 }),
    );
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.receiveShadow = true;
    scene.add(groundPlane);

    // A kerb framing the slab, built as four rails. A single box with an
    // invisible cut-out would still write depth across the whole floor and
    // swallow everything lying on it, the fill gauges included.
    const kerbMaterial = new THREE.MeshStandardMaterial({ color: 0x7d868f, roughness: 0.85, metalness: 0.05 });
    const kerbThickness = 0.26;
    const kerbHeight = 0.2;
    ([
      [0, (floor.heightMeters + kerbThickness) / 2, floor.widthMeters + kerbThickness * 2, kerbThickness],
      [0, -(floor.heightMeters + kerbThickness) / 2, floor.widthMeters + kerbThickness * 2, kerbThickness],
      [(floor.widthMeters + kerbThickness) / 2, 0, kerbThickness, floor.heightMeters],
      [-(floor.widthMeters + kerbThickness) / 2, 0, kerbThickness, floor.heightMeters],
    ] as Array<[number, number, number, number]>).forEach(([x, z, width, depth]) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(width, kerbHeight, depth), kerbMaterial);
      rail.position.set(x, kerbHeight / 2, z);
      rail.receiveShadow = true;
      rail.castShadow = true;
      scene.add(rail);
    });

    // Setting-out lines. A repeating texture blurs away at plan distance, so
    // the grid is drawn as geometry and stays crisp at every zoom.
    const gridPoints: number[] = [];
    const halfWidth = floor.widthMeters / 2;
    const halfDepth = floor.heightMeters / 2;
    for (let x = -halfWidth; x <= halfWidth + 1e-6; x += floor.gridMeters) {
      gridPoints.push(x, 0, -halfDepth, x, 0, halfDepth);
    }
    for (let z = -halfDepth; z <= halfDepth + 1e-6; z += floor.gridMeters) {
      gridPoints.push(-halfWidth, 0, z, halfWidth, 0, z);
    }
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3));
    const grid = new THREE.LineSegments(
      gridGeometry,
      new THREE.LineBasicMaterial({ color: 0xdce6ee, transparent: true, opacity: 0.1, depthWrite: false }),
    );
    grid.position.y = 0.006;
    scene.add(grid);

    const fixtureRoot = new THREE.Group();
    scene.add(fixtureRoot);
    buildFixtures(fixtureRoot, floor);

    const vesselRoot = new THREE.Group();
    scene.add(vesselRoot);
    const transferRoot = new THREE.Group();
    scene.add(transferRoot);
    const flow = flowTexture();

    const timeUniform = { value: 0 };
    const runtime: Runtime = {
      renderer, scene, camera, controls, vesselRoot, fixtureRoot, groundPlane, sun,
      transferRoot, flowTexture: flow,
      nodes: new Map(), materials: createMaterials(timeUniform), timeUniform,
      frame: 0, lastFrameAt: performance.now(), extent: floorFrameRadius(floor),
      pose: planPose(floor), tween: null, planZoom: 1, orbitZoom: 1, reportedZoom: 100,
      savedOrbit: { azimuth: -0.7, polar: 1.02, targetX: 0, targetZ: 0 },
      view: viewRef.current, drag: null, press: null, disposed: false,
    };
    runtimeRef.current = runtime;

    /* ------------------------------------------------------------ pointer */
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const setPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
    };
    const vesselAt = (): string | null => {
      const hit = raycaster.intersectObjects([...runtime.nodes.values()].map(node => node.group), true)[0];
      let current: THREE.Object3D | null = hit?.object || null;
      while (current) {
        if (typeof current.userData.vesselId === 'string') return current.userData.vesselId;
        current = current.parent;
      }
      return null;
    };

    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      setPointer(event);
      const vesselId = vesselAt();
      runtime.press = { x: event.clientX, y: event.clientY, at: performance.now(), vesselId };
      if (!vesselId || !editingRef.current) return;
      runtime.drag = { vesselId, moved: false, pointerId: event.pointerId };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const pointerMove = (event: PointerEvent) => {
      setPointer(event);
      if (!runtime.drag) {
        if (!handlers.current.onHoverVessel) return;
        const hovered = vesselAt();
        renderer.domElement.style.cursor = hovered ? (editingRef.current ? 'grab' : 'pointer') : '';
        handlers.current.onHoverVessel(hovered);
        return;
      }
      const node = runtime.nodes.get(runtime.drag.vesselId);
      if (!node) return;
      const point = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(dragPlane, point)) return;
      const activeFloor = floorRef.current;
      const settings = { widthMeters: node.footprintRadius, depthMeters: node.footprintRadius };
      let x = THREE.MathUtils.clamp(point.x, -activeFloor.widthMeters / 2 + settings.widthMeters / 2, activeFloor.widthMeters / 2 - settings.widthMeters / 2);
      let z = THREE.MathUtils.clamp(point.z, -activeFloor.heightMeters / 2 + settings.depthMeters / 2, activeFloor.heightMeters / 2 - settings.depthMeters / 2);
      if (snapRef.current) {
        const grid = activeFloor.gridMeters;
        x = Math.round((x + activeFloor.widthMeters / 2) / grid) * grid - activeFloor.widthMeters / 2;
        z = Math.round((z + activeFloor.heightMeters / 2) / grid) * grid - activeFloor.heightMeters / 2;
      }
      node.group.position.x = x;
      node.group.position.z = z;
      runtime.drag.moved = true;
    };

    const pointerUp = (event: PointerEvent) => {
      const drag = runtime.drag;
      const press = runtime.press;
      runtime.drag = null;
      runtime.press = null;
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      if (drag?.moved) {
        const node = runtime.nodes.get(drag.vesselId);
        if (node) {
          const grid = vesselPlanGridPosition(node.group.position.x, node.group.position.z, floorRef.current);
          handlers.current.onMoveVessel(drag.vesselId, grid.xGrid, grid.yGrid);
        }
        return;
      }
      if (!press?.vesselId) return;
      const travelled = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      if (travelled > 6 || performance.now() - press.at > 600) return;
      handlers.current.onSelectVessel(press.vesselId, event.shiftKey || event.metaKey || event.ctrlKey);
    };

    const doubleClick = (event: MouseEvent) => {
      setPointer(event as unknown as PointerEvent);
      const vesselId = vesselAt();
      if (vesselId) handlers.current.onOpenVessel(vesselId);
    };

    const element = renderer.domElement;
    element.addEventListener('pointerdown', pointerDown);
    element.addEventListener('pointermove', pointerMove);
    element.addEventListener('pointerup', pointerUp);
    element.addEventListener('pointercancel', pointerUp);
    element.addEventListener('pointerleave', () => handlers.current.onHoverVessel?.(null));
    element.addEventListener('dblclick', doubleClick);

    /* ------------------------------------------------------------- resize */
    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    // Framing needs the real aspect, so the opening pose waits for the layout.
    applyPose(runtime, poseFor(runtime, floor));
    constrainControls(runtime);

    /* -------------------------------------------------------------- frame */
    const projection = new THREE.Vector3();
    const animate = () => {
      runtime.frame = requestAnimationFrame(animate);
      const now = performance.now();
      const delta = Math.min(0.1, (now - runtime.lastFrameAt) / 1000);
      runtime.lastFrameAt = now;
      runtime.timeUniform.value += delta;
      // Chevrons run from source to destination, at a pace that reads as a
      // pump rather than a barber's pole.
      runtime.flowTexture.offset.x -= delta * 0.55;

      if (runtime.tween) {
        const elapsed = (performance.now() - runtime.tween.start) / runtime.tween.duration;
        const eased = easeInOutCubic(elapsed);
        applyPose(runtime, blendPose(runtime.tween.from, runtime.tween.to, eased));
        if (elapsed >= 1) {
          runtime.tween = null;
          controls.enabled = true;
          constrainControls(runtime);
        }
      } else {
        controls.update();
        const live = liveFrameRadius(runtime);
        const zoomFactor = live / baseFrameRadius(runtime, floorRef.current);
        if (runtime.view === '3d') {
          runtime.savedOrbit = {
            azimuth: controls.getAzimuthalAngle(),
            polar: controls.getPolarAngle(),
            targetX: controls.target.x,
            targetZ: controls.target.z,
          };
          runtime.orbitZoom = zoomFactor;
        } else {
          runtime.planZoom = zoomFactor;
        }
        runtime.pose = { ...runtime.pose, frameRadius: live, targetX: controls.target.x, targetZ: controls.target.z };
        const percent = Math.round(100 / Math.max(zoomFactor, 0.01));
        if (percent !== runtime.reportedZoom) {
          runtime.reportedZoom = percent;
          handlers.current.onZoomChange?.(percent);
        }
        const distance = camera.position.distanceTo(controls.target);
        applyFog(runtime, distance);
        camera.near = Math.max(0.05, distance * 0.02);
        camera.far = distance * 3 + live * 8;
        camera.updateProjectionMatrix();
      }

      // Ease the wine towards its true level so an operation reads as a pour.
      runtime.nodes.forEach(node => {
        if (Math.abs(node.targetRatio - node.displayRatio) < 0.0015) return;
        const step = reduceMotionRef.current ? 1 : Math.min(1, delta * 3.4);
        applyFill(node, node.displayRatio + (node.targetRatio - node.displayRatio) * step, runtime.materials);
      });

      // A steep key light. Raking sunlight reads well in the orbit but smears
      // long ghost shadows across the plan when the camera is straight above.
      sun.target.position.set(controls.target.x, 0, controls.target.z);
      sun.position.set(controls.target.x - 9, 30, controls.target.z + 11);

      renderer.render(scene, camera);

      const overlay = overlayRef.current;
      if (overlay) placeLabels(runtime, overlay, element, projection);
    };
    animate();
    setReady(current => current + 1);

    return () => {
      runtime.disposed = true;
      cancelAnimationFrame(runtime.frame);
      observer.disconnect();
      element.removeEventListener('pointerdown', pointerDown);
      element.removeEventListener('pointermove', pointerMove);
      element.removeEventListener('pointerup', pointerUp);
      element.removeEventListener('pointercancel', pointerUp);
      element.removeEventListener('dblclick', doubleClick);
      controls.dispose();
      disposeTree(scene);
      disposeTransfers(runtime);
      flow.dispose();
      runtime.materials.dispose();
      backdrop.dispose();
      slab.dispose();
      envTexture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      container.replaceChildren();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
    // The room is the scene: rebuild only when the physical space changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor.id, floor.widthMeters, floor.heightMeters, floor.gridMeters, floor.planObjects]);

  /* ------------------------------------------------------------- vessels */
  React.useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const seen = new Set<string>();
    vessels.forEach(vessel => {
      seen.add(vessel.id);
      const lot = vessel.assignedLotId ? lots.find(item => item.id === vessel.assignedLotId) : undefined;
      const signature = vesselGeometrySignature(vessel);
      const existing = runtime.nodes.get(vessel.id);
      const ratio = vesselFillRatio(vessel);
      if (existing && existing.signature === signature) {
        existing.targetRatio = ratio;
        const position = vesselPlanWorldPosition(vessel, floor);
        if (!runtime.drag || runtime.drag.vesselId !== vessel.id) {
          existing.group.position.set(position.x, 0, position.z);
        }
        existing.group.rotation.y = THREE.MathUtils.degToRad(vesselPlan3dSettings(vessel).rotationDegrees);
        return;
      }
      if (existing) {
        runtime.vesselRoot.remove(existing.group);
        disposeTree(existing.group);
      }
      const node = buildVesselNode(vessel, lot, runtime.materials, xRay);
      const position = vesselPlanWorldPosition(vessel, floor);
      node.group.position.set(position.x, 0, position.z);
      applyFill(node, ratio, runtime.materials);
      node.targetRatio = ratio;
      runtime.vesselRoot.add(node.group);
      runtime.nodes.set(vessel.id, node);
    });
    runtime.nodes.forEach((node, id) => {
      if (seen.has(id)) return;
      runtime.vesselRoot.remove(node.group);
      disposeTree(node.group);
      runtime.nodes.delete(id);
    });
  }, [vessels, lots, floor, xRay, ready]);

  /* ----------------------------------------- selection, layers and filters */
  React.useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const lit = spotlight ? new Set(spotlight) : null;
    runtime.nodes.forEach((node, id) => {
      const accent = accents[id] || 'none';
      const selected = id === selectedVesselId;
      const signal = signals[id];
      // A staged transfer outranks the filter, because those vessels are the
      // action in flight. Selection does not: a full tank has no business
      // staying lit under "clean capacity" just because the panel is on it.
      // Its ring stays bright instead, so it is still findable while dimmed.
      const marked = accent !== 'none';
      const dimmed = Boolean(lit) && !lit!.has(id) && !marked;
      const tone = accent !== 'none'
        ? ACCENT_COLOR[accent]
        : selected ? 0xa78bfa : signal?.tone ?? ACCENT_COLOR.none;
      const attention = marked || selected ? 1 : signal?.attention ?? 0.3;

      const ring = node.ringMesh.material as THREE.MeshBasicMaterial;
      ring.color.setHex(tone);
      ring.opacity = selected || marked ? 0.95 : dimmed ? 0.12 : 0.2 + attention * 0.76;
      node.ringMesh.scale.setScalar(selected ? 1.08 : 1);
      const gauge = node.gaugeMesh.material as THREE.MeshBasicMaterial;
      gauge.color.setHex(layer === 'contents' ? node.wineColor : tone);
      gauge.opacity = dimmed ? 0.18 : 0.96;

      // Wine class already colours the wine itself, so the contents layer
      // leaves the shell alone; the operational layers wash it.
      const tintStrength = layer === 'contents' || marked || selected ? 0 : (signal?.attention ?? 0) * 0.9;
      const material = runtime.materials.shell({
        kind: node.spec.material,
        xRay,
        clean: node.clean,
        tint: tone,
        tintStrength,
        dim: dimmed,
      });
      node.shellMeshes.forEach(mesh => { mesh.material = material; });
      node.liquidHolder.visible = !dimmed;
      node.details.forEach(object => { object.visible = !dimmed; });
    });
  }, [accents, layer, signals, spotlight, selectedVesselId, xRay, ready]);

  /* ----------------------------------------------------------- transfers */
  React.useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      containerRef.current?.setAttribute('data-transfer-hoses', '0');
      return;
    }
    disposeTransfers(runtime);
    const byId = new Map(vessels.map(vessel => [vessel.id, vessel]));
    let drawn = 0;
    transfers.forEach(transfer => {
      const source = runtime.nodes.get(transfer.sourceId);
      const destination = runtime.nodes.get(transfer.destinationId);
      const sourceVessel = byId.get(transfer.sourceId);
      const destinationVessel = byId.get(transfer.destinationId);
      if (!source || !destination || !sourceVessel || !destinationVessel) return;
      const from = new THREE.Vector3(
        source.group.position.x,
        vesselOutletHeight(sourceVessel),
        source.group.position.z,
      );
      const to = new THREE.Vector3(
        destination.group.position.x,
        vesselInletHeight(destinationVessel),
        destination.group.position.z,
      );
      runtime.transferRoot.add(
        buildTransferHose(from, to, transfer.color, runtime.flowTexture, Boolean(transfer.historic)),
      );
      drawn += 1;
    });
    // How many hoses reached the scene, reported on the container. The banner
    // can name a route the room failed to draw, and nothing else about the
    // WebGL layer is observable from outside it.
    containerRef.current?.setAttribute('data-transfer-hoses', String(drawn));
  }, [transfers, vessels, floor, ready]);

  /* -------------------------------------------------------------- camera */
  React.useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.view === view) return;
    const from = runtime.pose;
    runtime.view = view;
    viewRef.current = view;
    const to = poseFor(runtime, floor, view === 'top-down' ? runtime.planZoom : runtime.orbitZoom);
    runtime.controls.enabled = false;
    runtime.tween = { from, to, start: performance.now(), duration: reduceMotion ? 1 : 900 };
  }, [view, floor, reduceMotion]);

  React.useImperativeHandle(ref, () => ({
    resetView: () => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      runtime.planZoom = 1;
      runtime.orbitZoom = 1;
      runtime.savedOrbit = { azimuth: -0.7, polar: 1.02, targetX: 0, targetZ: 0 };
      const to = poseFor(runtime, floor);
      runtime.controls.enabled = false;
      runtime.tween = { from: runtime.pose, to, start: performance.now(), duration: reduceMotion ? 1 : 620 };
    },
    zoomTo: percent => {
      const runtime = runtimeRef.current;
      if (!runtime || runtime.tween) return;
      const wanted = baseFrameRadius(runtime, floor) * (100 / Math.max(percent, 10));
      const factor = wanted / Math.max(liveFrameRadius(runtime), 0.001);
      const offset = runtime.camera.position.clone().sub(runtime.controls.target).multiplyScalar(factor);
      runtime.camera.position.copy(runtime.controls.target.clone().add(offset));
      runtime.controls.update();
    },
    orbitBy: radians => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      if (runtime.view === 'top-down') return;
      const offset = runtime.camera.position.clone().sub(runtime.controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), radians);
      runtime.camera.position.copy(runtime.controls.target.clone().add(offset));
      runtime.controls.update();
    },
    focusVessel: vesselId => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const node = runtime.nodes.get(vesselId);
      if (!node) return;
      const to: CameraPose = {
        ...runtime.pose,
        targetX: node.group.position.x,
        targetZ: node.group.position.z,
        frameRadius: Math.max(node.footprintRadius * 3.4, runtime.pose.frameRadius * 0.42),
      };
      runtime.controls.enabled = false;
      runtime.tween = { from: runtime.pose, to, start: performance.now(), duration: reduceMotion ? 1 : 560 };
    },
  }), [floor, reduceMotion]);

  return <div ref={containerRef} className="absolute inset-0" data-testid="winery-plan-canvas" />;
});

export default WineryPlanCanvas;
