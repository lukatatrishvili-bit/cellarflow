'use client';

import React from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  AlertTriangle,
  ArrowLeftRight,
  Box,
  CalendarPlus,
  Check,
  Crosshair,
  Maximize2,
  Minus,
  Move3d,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Wine,
  Wrench,
  X,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import { deriveCellarPlanPositions, floorIdForVessel, normalizeCellarFloors, primaryCellarFloorId } from '../lib/cellarLayout';
import type { CellarFloor, CellarOperationType, Vessel, VesselPlanModel, WineLot } from '../lib/wineryState';
import {
  applyVesselPlan3dSettings,
  VESSEL_PLAN_MODELS,
  vesselPlan3dSettings,
  vesselPlanCollisions,
  vesselPlanGridPosition,
  vesselPlanWorldPosition,
  type VesselPlan3dSettings,
} from '../lib/wineryPlan3d';

interface WineryPlan3DProps {
  lang: Language;
  vessels: Vessel[];
  lots: WineLot[];
  floors?: CellarFloor[];
  selectedVesselId: string | null;
  onSelectVessel: (vesselId: string) => void;
  onUpdateVessels: (vessels: Vessel[]) => void;
  onOpenVessel: (vesselId: string) => void;
  onOpenLot?: (lotId: string) => void;
  onLogOperation?: (vesselId: string, operationType?: CellarOperationType) => void;
  onRecordSanitation?: (vesselId: string) => void;
  onScheduleOperation?: (vesselId: string) => void;
  onPlanTransfer?: (sourceVesselId: string) => void;
  canUpdate: boolean;
}

interface SceneRuntime {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  vesselRoot: THREE.Group;
  floorMesh: THREE.Mesh;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  vesselGroups: Map<string, THREE.Group>;
  animationFrame: number;
  drag: { vesselId: string; x: number; z: number } | null;
  resetCamera: () => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function wineColor(lot: WineLot | undefined): number {
  return ({
    red: 0x7f1d35,
    white: 0xd8bd66,
    amber: 0xc57925,
    rose: 0xdd7790,
    sparkling: 0xd9c68a,
    qvevri: 0xb66d31,
    fortified: 0x7b321e,
    base_wine: 0x94845b,
  } as Record<string, number>)[lot?.wineClass || ''] || 0x7f1d35;
}

function materialColor(vessel: Vessel, model: VesselPlanModel): number {
  if (model === 'barrel') return 0x9b6636;
  if (model === 'qvevri') return 0xa7653f;
  if (model === 'concrete') return 0xa7a7a2;
  if (model === 'plastic' || model === 'portable') return 0xe7edf1;
  if (model === 'insulated') return 0xf4f5f6;
  return vessel.cleaningStatus === 'clean' ? 0xbfc7ce : 0x9ca3aa;
}

function roundedRectTexture(label: string, active: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.fillStyle = active ? '#5b21b6' : 'rgba(255,255,255,.94)';
  context.beginPath();
  context.roundRect(8, 8, 496, 112, 44);
  context.fill();
  context.fillStyle = active ? '#ffffff' : '#172033';
  context.font = '700 52px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label.slice(0, 16), 256, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addLegs(group: THREE.Group, settings: VesselPlan3dSettings, color: number) {
  if (settings.elevationMeters <= 0.05 || settings.model === 'qvevri') return;
  const legHeight = Math.max(0.12, settings.elevationMeters);
  const geometry = new THREE.CylinderGeometry(0.035, 0.05, legHeight, 8);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.6 });
  const x = settings.widthMeters * 0.32;
  const z = settings.depthMeters * 0.32;
  [[-x, -z], [x, -z], [-x, z], [x, z]].forEach(([legX, legZ]) => {
    const leg = new THREE.Mesh(geometry, material);
    leg.position.set(legX, legHeight / 2, legZ);
    leg.castShadow = true;
    group.add(leg);
  });
}

function createVesselGroup(
  vessel: Vessel,
  lot: WineLot | undefined,
  selected: boolean,
  colliding: boolean,
): THREE.Group {
  const settings = vesselPlan3dSettings(vessel);
  const group = new THREE.Group();
  group.userData.vesselId = vessel.id;
  const baseColor = materialColor(vessel, settings.model);
  const material = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: settings.model === 'barrel' || settings.model === 'qvevri' ? 0.72 : 0.28,
    metalness: ['barrel', 'qvevri', 'concrete', 'plastic', 'portable'].includes(settings.model) ? 0.05 : 0.72,
  });
  let body: THREE.Mesh;
  if (settings.model === 'horizontal_tank' || settings.model === 'barrel') {
    body = new THREE.Mesh(
      new THREE.CylinderGeometry(settings.depthMeters / 2, settings.depthMeters / 2, settings.widthMeters, 32),
      material,
    );
    body.rotation.z = Math.PI / 2;
  } else if (settings.model === 'portable' || settings.model === 'concrete') {
    body = new THREE.Mesh(new THREE.BoxGeometry(settings.widthMeters, settings.heightMeters, settings.depthMeters), material);
  } else if (settings.model === 'qvevri') {
    body = new THREE.Mesh(new THREE.SphereGeometry(settings.widthMeters / 2, 32, 24), material);
    body.scale.y = settings.heightMeters / settings.widthMeters;
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(settings.widthMeters * 0.17, settings.widthMeters * 0.28, settings.heightMeters * 0.18, 24),
      material,
    );
    neck.position.y = settings.heightMeters * 0.47;
    group.add(neck);
  } else {
    body = new THREE.Mesh(
      new THREE.CylinderGeometry(settings.widthMeters / 2, settings.widthMeters / 2, settings.heightMeters, 32),
      material,
    );
    body.scale.z = settings.depthMeters / settings.widthMeters;
  }
  body.position.y = settings.elevationMeters + settings.heightMeters / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const jacketed = settings.model === 'closed_top_jacket' || settings.model === 'open_top_jacket';
  if (jacketed) {
    const jacket = new THREE.Mesh(
      new THREE.CylinderGeometry(settings.widthMeters * 0.515, settings.widthMeters * 0.515, settings.heightMeters * 0.42, 32, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x6f7c87, metalness: 0.82, roughness: 0.25, side: THREE.DoubleSide }),
    );
    jacket.position.y = settings.elevationMeters + settings.heightMeters * 0.5;
    jacket.scale.z = settings.depthMeters / settings.widthMeters;
    group.add(jacket);
  }

  const openTop = settings.model === 'open_top' || settings.model === 'open_top_jacket';
  if (openTop) {
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(settings.widthMeters / 2, Math.max(0.025, settings.widthMeters * 0.025), 8, 32),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.85, roughness: 0.2 }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = settings.elevationMeters + settings.heightMeters;
    group.add(rim);
  }

  const fillRatio = clamp(vessel.capacity > 0 ? vessel.currentVolume / vessel.capacity : 0, 0, 1);
  if (fillRatio > 0 && !['horizontal_tank', 'barrel', 'qvevri'].includes(settings.model)) {
    const liquid = new THREE.Mesh(
      new THREE.CylinderGeometry(settings.widthMeters * 0.44, settings.widthMeters * 0.44, 0.035, 32),
      new THREE.MeshStandardMaterial({ color: wineColor(lot), roughness: 0.28, metalness: 0.05 }),
    );
    liquid.scale.z = settings.depthMeters / settings.widthMeters;
    liquid.position.y = settings.elevationMeters + Math.max(0.03, settings.heightMeters * fillRatio);
    group.add(liquid);
  }

  addLegs(group, settings, baseColor);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(Math.hypot(settings.widthMeters, settings.depthMeters) * 0.37, selected ? 0.055 : 0.035, 8, 48),
    new THREE.MeshBasicMaterial({ color: colliding ? 0xfb7185 : selected ? 0x8b5cf6 : 0x334155, transparent: true, opacity: selected || colliding ? 0.95 : 0.35 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.035;
  group.add(ring);

  const labelTexture = roundedRectTexture(vessel.id, selected);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false }));
  label.position.y = Math.max(0.7, settings.elevationMeters + settings.heightMeters + 0.48);
  label.scale.set(2.5, 0.625, 1);
  label.renderOrder = 10;
  group.add(label);
  group.traverse(object => { object.userData.vesselId = vessel.id; });
  group.rotation.y = THREE.MathUtils.degToRad(settings.rotationDegrees);
  return group;
}

function disposeObject(root: THREE.Object3D) {
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    materials.forEach(material => {
      const map = (material as THREE.MeshBasicMaterial).map;
      map?.dispose();
      material.dispose();
    });
  });
}

function modelLabel(model: VesselPlanModel, ka: boolean) {
  const option = VESSEL_PLAN_MODELS.find(item => item.id === model);
  return option ? (ka ? option.ka : option.en) : model;
}

export default function WineryPlan3D({
  lang,
  vessels,
  lots,
  floors: rawFloors,
  selectedVesselId,
  onSelectVessel,
  onUpdateVessels,
  onOpenVessel,
  onOpenLot,
  onLogOperation,
  onRecordSanitation,
  onScheduleOperation,
  onPlanTransfer,
  canUpdate,
}: WineryPlan3DProps) {
  const ka = lang === 'ka';
  const floors = React.useMemo(() => normalizeCellarFloors(rawFloors), [rawFloors]);
  const [selectedFloorId, setSelectedFloorId] = React.useState(primaryCellarFloorId(floors));
  const [editing, setEditing] = React.useState(false);
  const [draftVessels, setDraftVessels] = React.useState(vessels);
  const [webglUnavailable, setWebglUnavailable] = React.useState(false);
  const [sceneVersion, setSceneVersion] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const runtimeRef = React.useRef<SceneRuntime | null>(null);
  const selectRef = React.useRef(onSelectVessel);
  const moveRef = React.useRef<(vesselId: string, x: number, z: number) => void>(() => undefined);
  const editingRef = React.useRef(editing);
  const floorVesselsRef = React.useRef<Vessel[]>([]);
  const selectedFloor = floors.find(floor => floor.id === selectedFloorId) || floors[0];
  const workingVessels = editing ? draftVessels : vessels;
  const positionedVessels = React.useMemo(() => {
    const positions = deriveCellarPlanPositions(workingVessels);
    return workingVessels.map(vessel => Number.isFinite(vessel.xGrid) && Number.isFinite(vessel.yGrid)
      ? vessel
      : { ...vessel, xGrid: positions[vessel.id].x, yGrid: positions[vessel.id].y });
  }, [workingVessels]);
  const floorVessels = positionedVessels.filter(vessel => floorIdForVessel(vessel, floors) === selectedFloor.id);
  const selectedVessel = positionedVessels.find(vessel => vessel.id === selectedVesselId) || null;
  const selectedLot = selectedVessel?.assignedLotId ? lots.find(lot => lot.id === selectedVessel.assignedLotId) : undefined;
  const collisions = React.useMemo(() => vesselPlanCollisions(floorVessels, selectedFloor), [floorVessels, selectedFloor]);

  selectRef.current = onSelectVessel;
  editingRef.current = editing;
  floorVesselsRef.current = floorVessels;
  moveRef.current = (vesselId, x, z) => {
    const settings = vesselPlan3dSettings(draftVessels.find(vessel => vessel.id === vesselId) || vessels.find(vessel => vessel.id === vesselId)!);
    const boundedX = clamp(x, -selectedFloor.widthMeters / 2 + settings.widthMeters / 2, selectedFloor.widthMeters / 2 - settings.widthMeters / 2);
    const boundedZ = clamp(z, -selectedFloor.heightMeters / 2 + settings.depthMeters / 2, selectedFloor.heightMeters / 2 - settings.depthMeters / 2);
    const grid = vesselPlanGridPosition(boundedX, boundedZ, selectedFloor);
    setDraftVessels(current => current.map(vessel => vessel.id === vesselId ? { ...vessel, ...grid } : vessel));
  };

  React.useEffect(() => {
    if (!editing) setDraftVessels(vessels);
  }, [editing, vessels]);
  React.useEffect(() => {
    if (floors.some(floor => floor.id === selectedFloorId)) return;
    setSelectedFloorId(primaryCellarFloorId(floors));
  }, [floors, selectedFloorId]);
  React.useEffect(() => {
    const vessel = positionedVessels.find(item => item.id === selectedVesselId);
    if (!vessel) return;
    const vesselFloorId = floorIdForVessel(vessel, floors);
    if (vesselFloorId !== selectedFloorId) setSelectedFloorId(vesselFloorId);
  }, [floors, positionedVessels, selectedFloorId, selectedVesselId]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    setWebglUnavailable(false);
    if (typeof window.WebGLRenderingContext === 'undefined') {
      setWebglUnavailable(true);
      return undefined;
    }
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      setWebglUnavailable(true);
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'h-full w-full touch-none';
    container.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9aacb8);
    scene.fog = new THREE.Fog(0x9aacb8, 38, 90);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 180);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = 85;
    controls.maxPolarAngle = Math.PI * 0.485;
    controls.screenSpacePanning = true;
    const resetCamera = () => {
      const extent = Math.max(selectedFloor.widthMeters, selectedFloor.heightMeters);
      camera.position.set(extent * 0.62, extent * 0.72, extent * 0.76);
      controls.target.set(0, 0.7, 0);
      controls.update();
    };
    resetCamera();

    scene.add(new THREE.HemisphereLight(0xe7f5ff, 0x2f3135, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.3);
    sun.position.set(-15, 24, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -35;
    sun.shadow.camera.right = 35;
    sun.shadow.camera.top = 35;
    sun.shadow.camera.bottom = -35;
    scene.add(sun);

    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(selectedFloor.widthMeters, selectedFloor.heightMeters),
      new THREE.MeshStandardMaterial({ color: 0x555960, roughness: 0.92, metalness: 0.02 }),
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);
    const gridSize = Math.max(selectedFloor.widthMeters, selectedFloor.heightMeters);
    const grid = new THREE.GridHelper(gridSize, Math.max(4, Math.round(gridSize / selectedFloor.gridMeters)), 0x89949d, 0x70777d);
    grid.position.y = 0.012;
    grid.scale.x = selectedFloor.widthMeters / gridSize;
    grid.scale.z = selectedFloor.heightMeters / gridSize;
    scene.add(grid);
    const edgeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(selectedFloor.widthMeters, 0.08, selectedFloor.heightMeters));
    const edges = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: 0xc6d0d6 }));
    edges.position.y = 0.02;
    scene.add(edges);

    (selectedFloor.planObjects || []).filter(object => object.kind === 'zone').forEach(object => {
      const zone = new THREE.Mesh(
        new THREE.PlaneGeometry(object.widthMeters, object.heightMeters),
        new THREE.MeshBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
      );
      zone.rotation.x = -Math.PI / 2;
      zone.rotation.z = -THREE.MathUtils.degToRad(object.rotation || 0);
      zone.position.set(object.xMeters - selectedFloor.widthMeters / 2, 0.025, object.yMeters - selectedFloor.heightMeters / 2);
      scene.add(zone);
    });

    const vesselRoot = new THREE.Group();
    scene.add(vesselRoot);
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const runtime: SceneRuntime = {
      scene, camera, renderer, controls, vesselRoot, floorMesh, raycaster, pointer,
      vesselGroups: new Map(), animationFrame: 0, drag: null, resetCamera,
    };
    runtimeRef.current = runtime;

    const setPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
    };
    const vesselIdFrom = (object: THREE.Object3D | undefined): string | undefined => {
      let current = object;
      while (current) {
        if (typeof current.userData.vesselId === 'string') return current.userData.vesselId;
        current = current.parent || undefined;
      }
      return undefined;
    };
    const pointerDown = (event: PointerEvent) => {
      setPointer(event);
      const hit = raycaster.intersectObjects([...runtime.vesselGroups.values()], true)[0];
      const vesselId = vesselIdFrom(hit?.object);
      if (!vesselId) return;
      selectRef.current(vesselId);
      if (!editingRef.current) return;
      const group = runtime.vesselGroups.get(vesselId);
      if (!group) return;
      runtime.drag = { vesselId, x: group.position.x, z: group.position.z };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!runtime.drag) return;
      setPointer(event);
      const floorHit = raycaster.intersectObject(floorMesh, false)[0];
      if (!floorHit) return;
      const group = runtime.vesselGroups.get(runtime.drag.vesselId);
      if (!group) return;
      const vessel = floorVesselsRef.current.find(item => item.id === runtime.drag?.vesselId);
      if (!vessel) return;
      const settings = vesselPlan3dSettings(vessel);
      const x = clamp(floorHit.point.x, -selectedFloor.widthMeters / 2 + settings.widthMeters / 2, selectedFloor.widthMeters / 2 - settings.widthMeters / 2);
      const z = clamp(floorHit.point.z, -selectedFloor.heightMeters / 2 + settings.depthMeters / 2, selectedFloor.heightMeters / 2 - settings.depthMeters / 2);
      group.position.x = x;
      group.position.z = z;
      runtime.drag.x = x;
      runtime.drag.z = z;
    };
    const pointerUp = (event: PointerEvent) => {
      const drag = runtime.drag;
      runtime.drag = null;
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      if (drag) moveRef.current(drag.vesselId, drag.x, drag.z);
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerUp);

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
    const animate = () => {
      runtime.animationFrame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    setSceneVersion(current => current + 1);

    return () => {
      cancelAnimationFrame(runtime.animationFrame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerUp);
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
      container.replaceChildren();
    };
  }, [selectedFloor]); // Recreate only when the physical room changes.

  React.useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    disposeObject(runtime.vesselRoot);
    runtime.vesselRoot.clear();
    runtime.vesselGroups.clear();
    floorVessels.forEach(vessel => {
      const group = createVesselGroup(
        vessel,
        vessel.assignedLotId ? lots.find(lot => lot.id === vessel.assignedLotId) : undefined,
        vessel.id === selectedVesselId,
        collisions.has(vessel.id),
      );
      const position = vesselPlanWorldPosition(vessel, selectedFloor);
      group.position.set(position.x, 0, position.z);
      runtime.vesselRoot.add(group);
      runtime.vesselGroups.set(vessel.id, group);
    });
  }, [collisions, floorVessels, lots, sceneVersion, selectedFloor, selectedVesselId]);

  const beginEditing = () => {
    setDraftVessels(vessels);
    setEditing(true);
  };
  const cancelEditing = () => {
    setDraftVessels(vessels);
    setEditing(false);
  };
  const saveEditing = () => {
    const draftById = new Map(draftVessels.map(vessel => [vessel.id, vessel]));
    const now = new Date().toISOString();
    onUpdateVessels(vessels.map(vessel => {
      const draft = draftById.get(vessel.id);
      if (!draft) return vessel;
      const nextPlan = {
        cellarFloorId: draft.cellarFloorId,
        xGrid: draft.xGrid,
        yGrid: draft.yGrid,
        planModel: draft.planModel,
        planWidthMeters: draft.planWidthMeters,
        planDepthMeters: draft.planDepthMeters,
        planHeightMeters: draft.planHeightMeters,
        planElevationMeters: draft.planElevationMeters,
        planRotationDegrees: draft.planRotationDegrees,
      };
      const changed = Object.entries(nextPlan).some(([key, value]) => vessel[key as keyof Vessel] !== value);
      return changed ? { ...vessel, ...nextPlan, lastModified: now } : vessel;
    }));
    setEditing(false);
  };
  const updateSelected = (patch: Partial<Vessel>) => {
    if (!selectedVessel) return;
    setDraftVessels(current => current.map(vessel => vessel.id === selectedVessel.id ? { ...vessel, ...patch } : vessel));
  };
  const updateSettings = (patch: Partial<VesselPlan3dSettings>) => {
    if (!selectedVessel) return;
    const next = applyVesselPlan3dSettings(selectedVessel, { ...vesselPlan3dSettings(selectedVessel), ...patch });
    setDraftVessels(current => current.map(vessel => vessel.id === selectedVessel.id ? next : vessel));
  };
  const selectFloor = (floorId: string) => {
    setSelectedFloorId(floorId);
    const first = positionedVessels.find(vessel => floorIdForVessel(vessel, floors) === floorId);
    if (first) onSelectVessel(first.id);
  };
  const cameraStep = (direction: -1 | 1) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const offset = runtime.camera.position.clone().sub(runtime.controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), direction * Math.PI / 8);
    runtime.camera.position.copy(runtime.controls.target.clone().add(offset));
    runtime.controls.update();
  };
  const zoomCamera = (factor: number) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const offset = runtime.camera.position.clone().sub(runtime.controls.target).multiplyScalar(factor);
    runtime.camera.position.copy(runtime.controls.target.clone().add(offset));
    runtime.controls.update();
  };
  const toggleFullscreen = () => {
    const element = containerRef.current?.parentElement;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen();
  };
  const settings = selectedVessel ? vesselPlan3dSettings(selectedVessel) : null;
  const worldPosition = selectedVessel ? vesselPlanWorldPosition(selectedVessel, selectedFloor) : null;
  const selectedCollisions = selectedVessel ? collisions.get(selectedVessel.id) || [] : [];

  return (
    <section className="relative min-h-[690px] bg-[#9aacb8]" data-testid="winery-plan-3d">
      <div className="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center gap-2 border-b border-slate-700/60 bg-[#22394c]/94 px-3 py-2 text-white backdrop-blur">
        <div className="flex items-center gap-2">
          <span className={`rounded-md px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${editing ? 'bg-amber-500 text-slate-950' : 'bg-slate-700 text-slate-200'}`}>{editing ? (ka ? 'რედაქტირება' : 'Editing') : (ka ? '3D დათვალიერება' : '3D workspace')}</span>
          <select aria-label={ka ? 'სართულის არჩევა' : 'Select floor'} value={selectedFloor.id} onChange={event => selectFloor(event.target.value)} className="min-h-9 rounded-lg border border-white/15 bg-slate-950/45 px-3 text-[10px] font-bold text-white outline-none">
            {floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}
          </select>
        </div>
        <span className="hidden text-[9px] font-semibold text-slate-300 lg:inline">{editing ? (ka ? 'დააწკაპუნეთ და გადაათრიეთ ჭურჭელი იატაკზე.' : 'Click and drag vessels across the floor. Orbit with the mouse; scroll to zoom.') : (ka ? 'მოატრიალეთ ხედი და აირჩიეთ ჭურჭელი.' : 'Orbit the room and select a vessel to inspect or operate it.')}</span>
        <div className="ml-auto flex items-center gap-1">
          {canUpdate && !editing && <button type="button" onClick={beginEditing} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-[10px] font-black hover:bg-white/15"><Move3d className="h-3.5 w-3.5" />{ka ? '3D რუკის შეცვლა' : 'Edit 3D map'}</button>}
          {editing && <><button type="button" onClick={cancelEditing} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-[10px] font-black text-slate-200 hover:bg-white/10"><X className="h-3.5 w-3.5" />{ka ? 'გაუქმება' : 'Cancel'}</button><button type="button" onClick={saveEditing} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-[10px] font-black text-slate-950 hover:bg-emerald-400"><Save className="h-3.5 w-3.5" />{ka ? 'შენახვა' : 'Done'}</button></>}
        </div>
      </div>

      <div ref={containerRef} className="absolute inset-0" aria-label={ka ? 'მარნის ინტერაქტიული 3D ხედი' : 'Interactive 3D winery view'} />
      {webglUnavailable && <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900 p-6 text-center text-sm font-bold text-slate-200"><div><Box className="mx-auto mb-3 h-10 w-10 text-slate-400" />{ka ? 'ამ მოწყობილობაზე WebGL მიუწვდომელია. გამოიყენეთ ზემოდან ხედი.' : 'WebGL is unavailable on this device. Use the Top-down view instead.'}</div></div>}

      <div className="absolute bottom-3 left-3 z-20 flex overflow-hidden rounded-xl border border-white/15 bg-slate-950/75 text-white shadow-xl backdrop-blur">
        <button type="button" onClick={() => zoomCamera(0.82)} aria-label={ka ? 'მიახლოება' : 'Zoom in'} className="p-2.5 hover:bg-white/10"><Plus className="h-4 w-4" /></button>
        <button type="button" onClick={() => zoomCamera(1.2)} aria-label={ka ? 'დაშორება' : 'Zoom out'} className="border-l border-white/10 p-2.5 hover:bg-white/10"><Minus className="h-4 w-4" /></button>
        <button type="button" onClick={() => cameraStep(-1)} aria-label={ka ? 'მარცხნივ მობრუნება' : 'Rotate left'} className="border-l border-white/10 p-2.5 hover:bg-white/10"><RotateCcw className="h-4 w-4" /></button>
        <button type="button" onClick={() => cameraStep(1)} aria-label={ka ? 'მარჯვნივ მობრუნება' : 'Rotate right'} className="border-l border-white/10 p-2.5 hover:bg-white/10"><RotateCcw className="h-4 w-4 -scale-x-100" /></button>
        <button type="button" onClick={() => runtimeRef.current?.resetCamera()} aria-label={ka ? 'კამერის აღდგენა' : 'Reset camera'} className="border-l border-white/10 p-2.5 hover:bg-white/10"><Crosshair className="h-4 w-4" /></button>
        <button type="button" onClick={toggleFullscreen} aria-label={ka ? 'სრულ ეკრანზე' : 'Fullscreen'} className="border-l border-white/10 p-2.5 hover:bg-white/10"><Maximize2 className="h-4 w-4" /></button>
      </div>

      <aside className="absolute bottom-3 right-3 top-[4.25rem] z-20 flex w-[min(23rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-300/70 bg-white/96 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/96">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div className="flex items-center justify-between gap-3"><strong className="text-xs text-slate-900 dark:text-white">{ka ? 'არჩეული ჭურჭელი' : 'Selected vessel'}</strong>{editing ? <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-[8px] font-black uppercase text-amber-800"><Move3d className="h-3 w-3" />{ka ? 'გადაათრიეთ' : 'Drag to move'}</span> : <span className="text-[8px] font-bold uppercase text-slate-400">{floorVessels.length} {ka ? 'ობიექტი' : 'objects'}</span>}</div>
          <select value={selectedVessel?.id || ''} onChange={event => onSelectVessel(event.target.value)} className="mt-3 min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-black outline-none dark:border-slate-700 dark:bg-slate-950">
            <option value="" disabled>{ka ? 'აირჩიეთ ჭურჭელი' : 'Select a vessel'}</option>
            {floorVessels.map(vessel => <option key={vessel.id} value={vessel.id}>{vessel.id} · {vessel.assignedLotId || (ka ? 'თავისუფალი' : 'available')}</option>)}
          </select>
        </div>

        {selectedVessel && settings ? <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-xl font-black text-slate-950 dark:text-white">{selectedVessel.id}</h2><p className="mt-0.5 text-[10px] font-semibold text-slate-500">{modelLabel(settings.model, ka)} · {selectedVessel.capacity.toLocaleString()} L</p></div>
            <span className={`rounded-lg px-2 py-1 text-[8px] font-black uppercase ${selectedVessel.cleaningStatus === 'clean' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{selectedVessel.cleaningStatus}</span>
          </div>

          {selectedCollisions.length > 0 && <div role="alert" className="mt-3 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[10px] font-bold text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{ka ? `იკვეთება: ${selectedCollisions.join(', ')}` : `Footprint overlaps ${selectedCollisions.join(', ')}. Move or resize before finalizing the room.`}</span></div>}

          <div className="mt-4 grid grid-cols-2 gap-2">
            <MiniFact label={ka ? 'შიგთავსი' : 'Contents'} value={selectedLot?.name || (ka ? 'ცარიელი' : 'Empty')} />
            <MiniFact label={ka ? 'მოცულობა' : 'Volume'} value={`${selectedVessel.currentVolume.toLocaleString()} L`} />
            <MiniFact label={ka ? 'შევსება' : 'Fill'} value={`${Math.round((selectedVessel.currentVolume / selectedVessel.capacity) * 100)}%`} />
            <MiniFact label={ka ? 'ტემპერატურა' : 'Temperature'} value={`${selectedVessel.temperature}°C`} />
          </div>

          <fieldset disabled={!editing} className="mt-4 space-y-3 disabled:opacity-60">
            <label className="block"><FieldLabel>{ka ? 'ჭურჭლის მოდელი' : 'Vessel model'}</FieldLabel><select value={settings.model} onChange={event => updateSettings({ model: event.target.value as VesselPlanModel })} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-950">{VESSEL_PLAN_MODELS.map(model => <option key={model.id} value={model.id}>{ka ? model.ka : model.en}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label={ka ? 'სიგანე, მ' : 'Width, m'} value={settings.widthMeters} onChange={value => updateSettings({ widthMeters: value })} min={0.2} max={20} />
              <NumberField label={ka ? 'სიღრმე, მ' : 'Depth, m'} value={settings.depthMeters} onChange={value => updateSettings({ depthMeters: value })} min={0.2} max={20} />
              <NumberField label={ka ? 'სიმაღლე, მ' : 'Height, m'} value={settings.heightMeters} onChange={value => updateSettings({ heightMeters: value })} min={0.2} max={30} />
              <NumberField label={ka ? 'მიწიდან, მ' : 'From ground, m'} value={settings.elevationMeters} onChange={value => updateSettings({ elevationMeters: value })} min={-10} max={15} />
              <NumberField label="X, m" value={worldPosition?.x || 0} onChange={value => { const grid = vesselPlanGridPosition(value, worldPosition?.z || 0, selectedFloor); updateSelected(grid); }} min={-selectedFloor.widthMeters / 2} max={selectedFloor.widthMeters / 2} />
              <NumberField label="Y, m" value={worldPosition?.z || 0} onChange={value => { const grid = vesselPlanGridPosition(worldPosition?.x || 0, value, selectedFloor); updateSelected(grid); }} min={-selectedFloor.heightMeters / 2} max={selectedFloor.heightMeters / 2} />
            </div>
            <label className="block"><div className="flex items-center justify-between"><FieldLabel>{ka ? 'მობრუნება' : 'Rotation'}</FieldLabel><span className="text-[9px] font-mono font-bold text-slate-500">{Math.round(settings.rotationDegrees)}°</span></div><input type="range" min="0" max="359" step="1" value={settings.rotationDegrees} onChange={event => updateSettings({ rotationDegrees: Number(event.target.value) })} className="mt-2 w-full accent-violet-600" /></label>
            <label className="block"><FieldLabel>{ka ? 'სართული' : 'Floor assignment'}</FieldLabel><select value={floorIdForVessel(selectedVessel, floors)} onChange={event => { updateSelected({ cellarFloorId: event.target.value }); setSelectedFloorId(event.target.value); }} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold dark:border-slate-700 dark:bg-slate-950">{floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name}</option>)}</select></label>
          </fieldset>

          {!editing && <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
            {selectedLot && onOpenLot && <Action icon={Wine} label={ka ? 'პარტიის გახსნა' : 'Open wine lot'} onClick={() => onOpenLot(selectedLot.id)} />}
            {onLogOperation && <Action icon={Wrench} label={ka ? 'ოპერაციის ჩაწერა' : 'Record operation'} onClick={() => onLogOperation(selectedVessel.id)} />}
            {onScheduleOperation && <Action icon={CalendarPlus} label={ka ? 'სამუშაოს დანიშვნა' : 'Assign work'} onClick={() => onScheduleOperation(selectedVessel.id)} />}
            {selectedVessel.currentVolume > 0 && onPlanTransfer && <Action icon={ArrowLeftRight} label={ka ? 'გადატანის დაწყება' : 'Start transfer'} onClick={() => onPlanTransfer(selectedVessel.id)} />}
            {selectedVessel.currentVolume <= 0 && selectedVessel.cleaningStatus !== 'clean' && onRecordSanitation && <Action icon={ShieldCheck} label={ka ? 'სანიტარიის ჩაწერა' : 'Record sanitation'} onClick={() => onRecordSanitation(selectedVessel.id)} />}
            <Action icon={Check} label={ka ? 'ჭურჭლის დეტალები' : 'Vessel details'} onClick={() => onOpenVessel(selectedVessel.id)} />
          </div>}
        </div> : <div className="flex flex-1 items-center justify-center p-8 text-center text-xs font-semibold text-slate-500">{ka ? 'აირჩიეთ ჭურჭელი 3D რუკაზე.' : 'Select a vessel in the 3D room to inspect, operate, or edit it.'}</div>}
      </aside>
    </section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-500">{children}</span>;
}

function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number }) {
  return <label><FieldLabel>{label}</FieldLabel><input type="number" value={Number(value.toFixed(2))} min={min} max={max} step="0.1" onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next); }} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-950" /></label>;
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800"><span className="block text-[7px] font-black uppercase tracking-wider text-slate-500">{label}</span><strong className="mt-0.5 block truncate text-[10px] text-slate-900 dark:text-white">{value}</strong></div>;
}

function Action({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-left text-[9px] font-black text-slate-700 hover:border-violet-300 hover:text-violet-800 dark:border-slate-700 dark:text-slate-200"><Icon className="h-3.5 w-3.5 shrink-0" />{label}</button>;
}
