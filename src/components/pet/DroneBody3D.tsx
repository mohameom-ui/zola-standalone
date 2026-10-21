// DRONE BODY 3D — v3: BRAIN-DRIVEN BODY CONTROL
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
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { scanAsset, scanWorldManifest, GESTURE_REPERTOIRE, type ScanResult } from "@/lib/pet/auraCache";

// ONE BODY — the v2.1 humanoid-drone hybrid is her ONLY body
// the quad (zola-drone-body.glb) is retired: she has legs, arms, and
// a cranial halo now — the bipedal frame earns its keep
// the RIGGED base: the textured mesh + 65-bone skeleton + skin (envelope
// weights, exported by Scripts/rig_zola_v2_fixed.py --base). The gesture
// clips bind to it by bone name at runtime.
const RIGGED_URL = "/assets/models/zola-anims/v2/rigged_base.glb";
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

function SceneRig({
  accentColor,
  fps,
  mood,
  flight,
  onTelemetry,
  gestureApiRef,
  onGestureDone,
}: {
  accentColor: string;
  fps: number;
  mood: string;
  flight?: { alt: number; rpm: number; flying?: boolean };
  onTelemetry?: (fps: number) => void;
  gestureApiRef?: React.MutableRefObject<GestureApi | null>;
  onGestureDone?: (name: string) => void;
}) {
  const gltf = useLoader(GLTFLoader, RIGGED_URL);
  const scene = useMemo(() => gltf.scene, [gltf]);
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
  const sway = useRef({ t: 0 });
  const ringRef = useRef<THREE.Mesh>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const propsRef = useRef<THREE.Group>(null);
  // the HAL streams at state-change cadence — mirror it so useFrame reads
  // the latest flight state without re-binding the frame callback
  const flightRef = useRef(flight);
  flightRef.current = flight;

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
    // weight-shift: the pelvis drifts side to side, slight vertical bob
    if (bones.pelvis) {
      bones.pelvis.position.x = Math.sin(t * 0.9) * 0.012 * cfg.amp;
      bones.pelvis.position.y = Math.abs(Math.sin(t * 1.8)) * 0.006 * cfg.amp;
      bones.pelvis.rotation.z = Math.sin(t * 0.9) * 0.045 * cfg.amp;
    }
    // the spine counter-rotates — she stays over her feet
    if (bones.spine) bones.spine.rotation.z = -Math.sin(t * 0.9) * 0.03 * cfg.amp;
    if (bones.spineTop) bones.spineTop.rotation.x = Math.sin(t * 1.4) * 0.02 * cfg.wobble;
    // the arms hang with a subtle pendulum
    if (bones.upperArmL) bones.upperArmL.rotation.x = Math.sin(t * 1.8) * 0.05 * cfg.amp;
    if (bones.upperArmR) bones.upperArmR.rotation.x = -Math.sin(t * 1.8) * 0.05 * cfg.amp;
    // the head stabilizes — her gaze stays level (that's the balance)
    if (bones.head) bones.head.rotation.z = -Math.sin(t * 0.9) * 0.02 * cfg.amp;
  });

  // the gesture playback: load the clip, fade in, report when done
  // the MOTOR STATE: the props spin bright during flight-adjacent gestures
  // (march, dance, spin, hover), dim to standby when grounded
  const flightClips = new Set(["march_01", "dance_01", "dance_02", "spin_01"]);
  const playGesture = (name: string) => {
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
      const dur = clip.duration;
      window.setTimeout(() => {
        if (activeName.current !== name) return;
        action.fadeOut(0.3);
        activeAction.current = null;
        activeName.current = null;
        onGestureDone?.(name);
      }, ((dur - 0.3) * 1000) | 0);
    });
  };

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
      {/* the Aura-Telemetry ring — her cranial halo LEDs, emissive glow
          synced to her persona + motor state (she spans y -0.905..0.87
          in-file, so the cranium sits at ~0.87; the ring wraps her halo) */}
      <mesh ref={ringRef} position={[0, 0.87, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.26, 0.02, 16, 48]} />
        <meshStandardMaterial
          color={ringColor}
          emissive={ringColor}
          emissiveIntensity={ringIntensity}
          toneMapped={false}
        />
      </mesh>
      <pointLight position={[0, -0.5, 0.8]} color={ringColor} intensity={3.4} distance={5} decay={1.6} />
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
  onTelemetry,
  gestureApiRef,
  onGestureDone,
}: {
  accentColor?: string;
  mood?: string;
  fps?: number;
  flight?: { alt: number; rpm: number; flying?: boolean };
  speech?: string | null;
  onPet?: () => void;
  onTelemetry?: (fps: number) => void;
  gestureApiRef?: React.MutableRefObject<GestureApi | null>;
  onGestureDone?: (name: string) => void;
}) {
  const [fpsLive, setFpsLive] = useState(fps);
  // NEURAL_AURA_CACHE — her first scan target is always herself
  const [scan] = useState<ScanResult | null>(() => {
    try {
      return scanAsset("zola-body-v2");
    } catch {
      return null;
    }
  });
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
      className="relative h-[240px] w-full overflow-hidden rounded-lg bg-[#0b0e17] cursor-pointer"
      onClick={onPet}
      title="pet her — she responds with body and voice"
    >
      <Canvas camera={{ position: [0, 0.4, 2.6], fov: 40 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <ambientLight intensity={0.35} />
        <directionalLight position={[3, 5, 4]} intensity={1.4} color="#dfe6f2" />
        <directionalLight position={[-4, 2, -3]} intensity={0.5} color={accentColor} />
        <gridHelper args={[6, 24, "#1c2230", "#141a26"]} position={[0, -1.05, 0]} />
        <Suspense fallback={null}>
          <SceneRig
            accentColor={accentColor}
            fps={fpsLive}
            mood={mood}
            flight={flight}
            onTelemetry={setFpsLive}
            gestureApiRef={gestureApiRef}
            onGestureDone={onGestureDone}
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
