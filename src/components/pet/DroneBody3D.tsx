// DRONE BODY 3D — v5: THE HYBRID BODY (one body, brain-driven)
// The hangar loads her RIGGED body (65-bone skeleton + generated mesh) and
// runs two layers:
//   1. The procedural balancer — she STANDS on the dock pad: weight-shift
//      sway in the pelvis, counter-rotation in the spine, stabilizing head.
//      Amplitude and character follow her mood (the brain drives balance).
//   2. Brain-commanded gestures — any of the 19 gesture clips play on
//      demand via the CORTEX (featuresRef.gesture); her aura ledger logs
//      every movement choice.
// The halo (rigid, Head-bone parented from iteration 2.5) tracks her head.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { scanAsset, scanWorldManifest, GESTURE_REPERTOIRE, type ScanResult } from "@/lib/pet/auraCache";

// ONE BODY — the humanoid-drone hybrid is her ONLY body
// the quad (zola-drone-body.glb) is retired: she has legs, arms, and
// a cranial halo now — the bipedal frame earns its keep
// the RIGGED base: the textured mesh + 65-bone skeleton + skin (envelope
// weights, exported by Scripts/rig_zola_v2_fixed.py --base). The gesture
// clips bind to it by bone name at runtime.
// v9 — the STUDIO FINISH body: metallic/clearcoat/smooth-shaded material pass
// (geometry and skin weights identical; see Scripts/material_pass_v9.py)
const RIGGED_URL = "/assets/models/zola-anims/v2/rigged_base_v9.glb";
// her feet rest at y=-0.905 in-file; the hangar grid sits at y=-1.05
const GROUND_OFFSET = -0.145;

// her movement vocabulary lives in the aura ledger (the single source of
// truth) — re-exported here for the CORTEX and the gesture stage
export { GESTURE_REPERTOIRE };

export interface GestureApi {
  playGesture: (name: string) => void;
  cancelGesture: () => void;
}

const clipCache = new Map<string, THREE.AnimationClip>();

async function loadGestureClip(name: string): Promise<THREE.AnimationClip | null> {
  const key = `v2_${name}`;
  const hit = clipCache.get(key);
  if (hit) return hit;
  try {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(`/assets/models/zola-anims/v2/v2_${name}.glb`);
    const clip = gltf.animations[0];
    if (!clip) return null;
    clipCache.set(key, clip);
    return clip;
  } catch {
    return null;
  }
}

// the mood → balance-character map (the brain drives how she stands)
const MOOD_SWAY: Record<string, { amp: number; speed: number; wobble: number }> = {
  happy: { amp: 1.2, speed: 1.15, wobble: 0.5 },
  curious: { amp: 0.9, speed: 1.0, wobble: 0.3 },
  excited: { amp: 1.7, speed: 1.5, wobble: 0.9 },
  idle: { amp: 0.7, speed: 0.85, wobble: 0.2 },
  sleepy: { amp: 0.45, speed: 0.6, wobble: 0.1 },
  alarmed: { amp: 1.5, speed: 1.8, wobble: 1.2 },
  sleeping: { amp: 0.3, speed: 0.5, wobble: 0.05 },
};

// her body-language brain bridge: inner state -> targeted movement
const ACTIVITY_GESTURE: Record<string, string[]> = {
  excited: ["dance_01", "dance_02", "spin_01"],
  sleepy: ["mope_01", "stretch_01"],
  sleeping: ["laydown_01"],
  search: ["shrug_01", "crawl_01"],
  walk: ["walk_01"], // ground locomotion — the gait loops while she strolls
};

function SceneRig({
  accentColor,
  fps,
  mood,
  flight,
  activity,
  stretchCue,
  onTelemetry,
  gestureApiRef,
  onGestureDone,
  onGestureChange,
}: {
  accentColor: string;
  fps: number;
  mood: string;
  flight?: { alt: number; rpm: number; flying?: boolean };
  activity?: string;
  stretchCue?: number;
  onTelemetry?: (fps: number) => void;
  gestureApiRef?: React.MutableRefObject<GestureApi | null>;
  onGestureDone?: (name: string) => void;
  onGestureChange?: (name: string | null) => void;
}) {
  const gl = useThree((s) => s.gl);
  const gltf = useLoader(GLTFLoader, RIGGED_URL);
  const scene = useMemo(() => {
    // texture sampling: max anisotropy on every map — her 1024px bake
    // stops smearing at glancing angles (the real fix for texture murk
    // until the forge honors a 2048 re-bake)
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    gltf.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m) return;
      for (const map of [m.map, m.normalMap, m.roughnessMap, m.emissiveMap]) {
        if (map) { map.anisotropy = maxAniso; map.minFilter = THREE.LinearMipmapLinearFilter; map.needsUpdate = true; }
      }
    });
    return gltf.scene;
  }, [gltf, gl]);

  // THE HYBRID BODY — she is human-shaped and machine-honest. Gold servo
  // caps anchor to her REAL bones (they ride every gesture), and cyan
  // trace nodes mark the spine bus her UART mapping runs along.
  useEffect(() => {
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.35 });
    const servoCap = (r: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, r * 0.8, 12), gold);
      m.rotation.z = Math.PI / 2;
      return m;
    };
    const servoJoints: [string, number][] = [
      ["upperarm_l", 0.024], ["upperarm_r", 0.024],
      ["lowerarm_l", 0.018], ["lowerarm_r", 0.018],
      ["thigh_l", 0.026], ["thigh_r", 0.026],
      ["calf_l", 0.02], ["calf_r", 0.02],
    ];
    const added: THREE.Object3D[] = [];
    for (const [name, r] of servoJoints) {
      const bone = scene.getObjectByName(name);
      if (!bone) continue;
      const cap = servoCap(r);
      bone.add(cap);
      added.push(cap);
    }
    // v5 note: the spine trace nodes are retired on the humanoid body —
    // dots floating on a dress read as debris, not circuitry. The servo
    // caps stay, at companion scale: subtle, not surgical.
    return () => { for (const a of added) a.removeFromParent(); };
  }, [scene]);
  const mixer = useMemo(() => new THREE.AnimationMixer(scene), [scene]);
  const bones = useMemo(
    () => ({
      pelvis: scene.getObjectByName("pelvis"),
      spine: scene.getObjectByName("spine_02"),
      spineTop: scene.getObjectByName("spine_03"),
      head: scene.getObjectByName("Head"),
      upperArmL: scene.getObjectByName("upperarm_l"),
      upperArmR: scene.getObjectByName("upperarm_r"),
    }),
    [scene],
  );

  const activeAction = useRef<THREE.AnimationAction | null>(null);
  const activeName = useRef<string | null>(null);
  const gestureQueue = useRef<string[]>([]); // the improv chain lives here
  const sway = useRef({ t: 0 });
  const ringRef = useRef<THREE.Mesh>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const propsRef = useRef<THREE.Group>(null);
  // the HAL streams at state-change cadence — mirror it so useFrame reads
  // the latest flight state without re-binding the frame callback
  const flightRef = useRef(flight);
  flightRef.current = flight;

  // THE HANGAR GATE — honest renderer telemetry, printed from inside the
  // live frame loop every 5 s: [hangar-gate] perf: fps drawCalls triangles.
  // Rule 2: every number real, straight from the WebGL renderer info.
  const gateRef = useRef({ frames: 0, t: 0 });
  useFrame((_, delta) => {
    const g = gateRef.current;
    g.frames += 1;
    g.t += delta;
    if (g.t >= 5) {
      const info = gl.info.render;
      console.log(`[hangar-gate] perf: fps=${(g.frames / g.t).toFixed(1)} drawCalls=${info.calls} triangles=${info.triangles}`);
      g.frames = 0;
      g.t = 0;
    }
  });

  // the procedural balancer — runs whenever no gesture owns her body
  useFrame((_, delta) => {
    mixer.update(delta);
    // FLIGHT: one body, grounded and airborne — she lifts off her pad with
    // real altitude (cm resolution from the HAL) and her cranial halo —
    // her actual propulsion array — brightens as the motors spool up.
    if (bodyRef.current) {
      const f = flightRef.current;
      if (f && f.alt > 0.02) {
        const lift = Math.min(f.alt, 1.2) * 0.8;
        const spin = Math.min(f.rpm / 12000, 1);
        bodyRef.current.position.y = lift + Math.sin(sway.current.t * 3.1) * 0.012 * (0.3 + spin);
        bodyRef.current.rotation.z = Math.sin(sway.current.t * 1.7) * 0.02 * spin; // gentle hover drift
        if (ringRef.current) {
          const mat = (ringRef.current as THREE.Mesh).material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 2.5 + spin * 2.5);
        }
        // the Quad-Halo's four rotor discs — visible ONLY airborne, spin
        // rate follows the real HAL RPM (her motors, made visible)
        if (propsRef.current) {
          propsRef.current.visible = true;
          const discSpin = f.rpm * delta * 0.004;
          for (const disc of propsRef.current.children) disc.rotation.y += discSpin;
        }
      } else {
        bodyRef.current.position.y = 0;
        bodyRef.current.rotation.z = 0;
        if (propsRef.current) propsRef.current.visible = false; // her fans STOP when she is not flying (owner directive)
      }
    }
    if (activeAction.current) return; // a gesture owns her body right now

    const cfg = MOOD_SWAY[mood] ?? MOOD_SWAY.curious;
    sway.current.t += delta * cfg.speed;

    const t = sway.current.t;
    // EXPONENTIAL SMOOTHING — every joint eases toward its target instead
    // of snapping: after a gesture ends she flows back into her sway, no
    // teleporting limbs, no glitch-pop between states
    const k = 1 - Math.exp(-10 * delta);
    type Axis = "x" | "y" | "z" | "rz" | "rx";
    const ease = (obj: THREE.Object3D, prop: Axis, target: number) => {
      if (prop === "rz") obj.rotation.z += (target - obj.rotation.z) * k;
      else if (prop === "rx") obj.rotation.x += (target - obj.rotation.x) * k;
      else obj.position[prop] += (target - obj.position[prop]) * k;
    };
    // weight-shift: the pelvis drifts side to side, slight vertical bob
    if (bones.pelvis) {
      ease(bones.pelvis, "x", Math.sin(t * 0.9) * 0.012 * cfg.amp);
      ease(bones.pelvis, "y", Math.abs(Math.sin(t * 1.8)) * 0.006 * cfg.amp);
      ease(bones.pelvis, "rz", Math.sin(t * 0.9) * 0.045 * cfg.amp);
    }
    // the spine counter-rotates — she stays over her feet
    if (bones.spine) ease(bones.spine, "rz", -Math.sin(t * 0.9) * 0.03 * cfg.amp);
    if (bones.spineTop) ease(bones.spineTop, "rx", Math.sin(t * 1.4) * 0.02 * cfg.wobble);
    // the arms hang with a subtle pendulum
    if (bones.upperArmL) ease(bones.upperArmL, "rx", Math.sin(t * 1.8) * 0.05 * cfg.amp);
    if (bones.upperArmR) ease(bones.upperArmR, "rx", -Math.sin(t * 1.8) * 0.05 * cfg.amp);
    // the head stabilizes — her gaze stays level (that's the balance)
    if (bones.head) ease(bones.head, "rz", -Math.sin(t * 0.9) * 0.02 * cfg.amp);
  });

  // the gesture playback: load the clip, fade in, report when done
  // the MOTOR STATE: the props spin bright during flight-adjacent gestures
  // (march, dance, spin, hover), dim to standby when grounded
  const flightClips = new Set(["march_01", "dance_01", "dance_02", "spin_01"]);
  const playGesture = (name: string) => {
    if (name === "improv") {
      // IMPROV — a fresh chain of 2-3 movements, back to back (ported from
      // the retired GestureStage; there is one body, and it improvises)
      const pool = [...GESTURE_REPERTOIRE].sort(() => Math.random() - 0.5);
      gestureQueue.current = pool.slice(0, 2 + (Math.random() < 0.5 ? 1 : 0));
      const first = gestureQueue.current.shift();
      if (first) playGesture(first);
      return;
    }
    if (!GESTURE_REPERTOIRE.includes(name)) return;
    scanAsset(`movement:${name}`); // the aura ledger counts her movement repertoire
    const flying = flightClips.has(name);
    if (ringRef.current) {
      const mat = (ringRef.current as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = flying ? 4.5 : 0.3; // the halo dims when grounded
    }
    void loadGestureClip(name).then((clip) => {
      if (!clip) return;
      activeAction.current?.fadeOut(0.25);
      const action = mixer.clipAction(clip);
      action.reset().setEffectiveWeight(0).fadeIn(0.25).play();
      activeAction.current = action;
      activeName.current = name;
      onGestureChange?.(name); // NOW PLAYING rides the HUD
      const dur = clip.duration;
      // GAIT LOOP — while she is strolling, the walk cycles until her brain
      // changes activity; the loop itself performs the clean stop when it does
      const afterClip = () => {
        if (activeName.current !== name) return;
        if (name === "walk_01" && activityRef.current === "walk") {
          action.reset().setEffectiveWeight(1).play();
          window.setTimeout(afterClip, dur * 1000);
          return;
        }
        action.fadeOut(0.3);
        activeAction.current = null;
        activeName.current = null;
        onGestureChange?.(null);
        const next = gestureQueue.current.shift(); // the improv chain continues
        if (next) playGesture(next);
        else onGestureDone?.(name);
      };
      window.setTimeout(afterClip, ((dur - 0.3) * 1000) | 0);
    });
  };

  // THE BRAIN BRIDGE — her body language follows her inner state (the
  // retired GestureStage's last live feature, now on the ONE body)
  const prevBridge = useRef<string | null>(null);
  const activityRef = useRef(activity); // the gait loop reads the CURRENT activity
  useEffect(() => { activityRef.current = activity; }, [activity]);
  useEffect(() => {
    const state = `${activity ?? ""}|${mood}`;
    if (prevBridge.current === null) { prevBridge.current = state; return; } // settle first, perform later
    if (prevBridge.current === state) return;
    prevBridge.current = state;
    const pool = ACTIVITY_GESTURE[activity ?? ""] ?? [];
    const candidates = pool.filter((c) => c !== activeName.current);
    const pick = candidates.length
      ? candidates[Math.floor(Math.random() * candidates.length)]
      : stretchCue
        ? "stretch_01"
        : null;
    if (pick) playGesture(pick);
  }, [activity, mood, stretchCue]);

  // the audit hook: a real window handle for headless rig verification
  // (bones bound, mixer alive, gesture triggering) — the provenance rule
  // demands verifiable claims, this makes the rig's state inspectable
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as Record<string, unknown>).__ZOLA_RIG = {
        bones: Object.fromEntries(Object.entries(bones).map(([k, v]) => [k, !!v])),
        hasMixer: !!mixer,
        playGesture: (name: string) => playGesture(name),
        mixerTime: () => mixer.time,
      };
    }
  });

  // expose the CORTEX handle
  useEffect(() => {
    if (!gestureApiRef) return;
    gestureApiRef.current = {
      playGesture,
      cancelGesture: () => {
        activeAction.current?.fadeOut(0.2);
        activeAction.current = null;
        activeName.current = null;
      },
    };
  });

  // the LED ring — reactive to persona, fps, and the motor state
  const tier = fps >= 55 ? "buttery" : fps >= 30 ? "mid" : "critical";
  const ringColor = tier === "buttery" ? accentColor : tier === "mid" ? "#f0b90b" : "#ff4d4f";
  const ringIntensity = tier === "buttery" ? 3.2 : tier === "mid" ? 2.2 : 3.8;

  return (
    <group position={[0, GROUND_OFFSET, 0]}>
      <group ref={bodyRef}>
        <primitive object={scene} />
        {/* the four 2.5-inch folding props at the Quad-Halo corners — the
            visual proxy for her real 1204/1303.5 motors, spinning with the
            live HAL RPM when she flies */}
        <group ref={propsRef} visible={false}>
          {[[-0.17, 0.17], [0.17, 0.17], [-0.17, -0.17], [0.17, -0.17]].map(([x, z], i) => (
            <mesh key={i} position={[x, 0.88, z]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.11, 0.012, 8, 24]} />
              <meshStandardMaterial color="#9fb2c8" emissive={accentColor} emissiveIntensity={0.25} transparent opacity={0.55} toneMapped={false} />
            </mesh>
          ))}
        </group>
      </group>
      {/* the Aura-Telemetry glow — on the humanoid body the physical ring
          is retired; her persona light lives as a soft ambient aura */}
      <mesh ref={ringRef} visible={false} position={[0, 0.87, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.26, 0.02, 16, 48]} />
        <meshStandardMaterial color={ringColor} emissive={ringColor} emissiveIntensity={ringIntensity} toneMapped={false} />
      </mesh>
      <pointLight position={[0, -0.5, 0.8]} color={ringColor} intensity={1.6} distance={5} decay={1.6} />
    </group>
  );
}

export default function DroneBody3D({
  accentColor = "#35d0a5",
  mood = "curious",
  fps = 60,
  flight,
  speech,
  onPet,
  activity,
  stretchCue,
  onTelemetry,
  gestureApiRef,
  onGestureDone,
  onGestureChange,
}: {
  accentColor?: string;
  mood?: string;
  fps?: number;
  flight?: { alt: number; rpm: number; flying?: boolean };
  speech?: string | null;
  onPet?: () => void;
  activity?: string;
  stretchCue?: number;
  onTelemetry?: (fps: number) => void;
  gestureApiRef?: React.MutableRefObject<GestureApi | null>;
  onGestureDone?: (name: string) => void;
  onGestureChange?: (name: string | null) => void;
}) {
  const [fpsLive, setFpsLive] = useState(fps);
  // NEURAL_AURA_CACHE — her first scan target is always herself.
  // scanAsset MUTATES the encounter ledger, so it must never run during
  // render: the old useState initializer ran it on the server AND the client
  // with different ledger states — the source of the hydration mismatch
  const [scan, setScan] = useState<ScanResult | null>(null);
  useEffect(() => {
    try {
      setScan(scanAsset("zola-body-v2"));
    } catch {
      setScan(null);
    }
  }, []);
  // WORLD SCAN — the Optic-Rizz Array audits her whole domain on mount
  const [worldLine, setWorldLine] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void scanWorldManifest().then(({ scanned, fresh }) => {
      if (!alive) return;
      const latest = scanned[scanned.length - 1];
      setWorldLine(`WORLD SCAN: ${scanned.length} assets audited · ${fresh} new to the ledger · last: ${latest?.verdict ?? "-"}`);
    });
    return () => { alive = false; };
  }, []);
  const tierLabel = fpsLive >= 55 ? "AURA FARMING" : fpsLive >= 30 ? "MID" : "CRITICAL";
  const tier = fpsLive >= 55 ? "buttery" : fpsLive >= 30 ? "mid" : "critical";
  const ringColor = tier === "buttery" ? accentColor : tier === "mid" ? "#f0b90b" : "#ff4d4f";
  const ringIntensity = tier === "buttery" ? 3.2 : tier === "mid" ? 2.2 : 3.8;

  return (
    <div
      className="relative h-[240px] w-full overflow-hidden rounded-lg bg-[#141a28] cursor-pointer"
      onClick={onPet}
      title="pet her — she responds with body and voice"
    >
      <Canvas camera={{ position: [0, 0.4, 2.6], fov: 40 }} dpr={[1, 2]} gl={{ antialias: true }}
        onCreated={({ gl }) => { gl.toneMappingExposure = 1.55; }}>
        {/* THE STUDIO — a photographic three-point rig: warm key, HER color as
          the rim (she is lit by her own theme), cool fill; fog for depth; a
          contact shadow so she stands ON the floor, not above it */}
        <fog attach="fog" args={["#10141f", 7, 15]} />
        <hemisphereLight args={["#3a4a6b", "#0a0c12", 0.55]} />
        <directionalLight position={[2.5, 4.5, 3.5]} intensity={2.4} color="#fff2dc" />
        <directionalLight position={[-3.5, 1.6, -4]} intensity={2.2} color={accentColor} />
        <directionalLight position={[0, 1.2, 4.5]} intensity={0.55} color="#8ecfff" />
        <gridHelper args={[6, 24, "#1c2230", "#141a26"]} position={[0, -1.05, 0]} />
        {/* contact shadow — grounds her silhouette */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.049, 0]}>
          <circleGeometry args={[0.55, 48]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.5} depthWrite={false} />
        </mesh>
        <Suspense fallback={null}>
          <SceneRig
            accentColor={accentColor}
            fps={fpsLive}
            mood={mood}
            flight={flight}
            activity={activity}
            stretchCue={stretchCue}
            onTelemetry={setFpsLive}
            gestureApiRef={gestureApiRef}
            onGestureDone={onGestureDone}
            onGestureChange={onGestureChange}
          />
        </Suspense>
      </Canvas>
      <span className="hud-label absolute left-2 top-2 text-[9px] opacity-60">3D HANGAR · ONE BODY · BRAIN-DRIVEN</span>
      {flight && flight.alt > 0.02 && (
        <span className="hud-label absolute left-2 top-7 text-[9px] text-[#35d0a5]">
          AIRBORNE · {flight.alt.toFixed(2)} m · {Math.round(flight.rpm)} RPM
        </span>
      )}
      {speech && (
        <div className="absolute left-1/2 top-6 -translate-x-1/2 max-w-[92%] px-2 py-1 rounded-md border text-[10px] leading-snug bg-[rgba(10,13,22,0.88)] text-[#e9e7dc] whitespace-pre-wrap text-center"
          style={{ borderColor: accentColor }}>
          {speech}
        </div>
      )}
      <span className="hud-label absolute right-2 top-2 text-[9px] opacity-70">
        AURA-TELEMETRY · {Math.round(fpsLive)} FPS · {tierLabel}
      </span>
      {worldLine && (
        <span className="hud-label absolute bottom-6 left-2 right-2 text-[9px] opacity-70 truncate">{worldLine}</span>
      )}
      {scan && (
        <span className="hud-label absolute bottom-2 left-2 right-2 text-[9px] opacity-80 truncate">
          [HUD_TARGET_ID: {scan.id}] encounters {scan.encounters} — "{scan.verdict}"
        </span>
      )}
    </div>
  );
}
