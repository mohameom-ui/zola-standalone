// Zola v11: dimensional robot geometry, an unchanged source animation
// skeleton, twenty compact motions, and mood-driven neutral body language.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { scanAsset, GESTURE_REPERTOIRE } from "@/lib/pet/auraCache";

// Rebuilt by isaac/build_character.py with explicit bone weights.
const RIGGED_URL = "/assets/models/zola-anims/v3/zola.glb";
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
  const key = `v11_${name}`;
  const hit = clipCache.get(key);
  if (hit) return hit;
  try {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(`/assets/models/zola-anims/v3/${name}.glb`);
    const clip = gltf.animations[0];
    if (!clip) return null;
    // ROOT MOTION STRIP: retargeted clips carry their own root translation —
    // played here it makes her glide/lurch (the weird moves). The clip stays
    // in place; the world moves her instead.
    clip.tracks = clip.tracks.filter(
      (t) => !(t.name.endsWith(".position") && /hips|pelvis|root|spine_01/i.test(t.name)),
    );
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
  mood,
  flight,
  speaking,
  activity,
  stretchCue,
  onTelemetry,
  gestureApiRef,
  onGestureDone,
  onGestureChange,
}: {
  accentColor: string;
  mood: string;
  flight?: { alt: number; rpm: number; x?: number; y?: number; yaw?: number; pitch?: number; roll?: number };
  speaking?: boolean;
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
    const instance = cloneSkeleton(gltf.scene);
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    instance.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const material of materials) {
        const m = material as THREE.MeshStandardMaterial;
        for (const map of [m.map, m.normalMap, m.roughnessMap, m.emissiveMap]) {
          if (map) { map.anisotropy = maxAniso; map.needsUpdate = true; }
        }
      }
    });
    // The source motion skeleton has a T-pose bind. Its neutral display pose
    // lowers both shoulders in world space without changing the bind matrices.
    instance.updateMatrixWorld(true);
    for (const [name, angle] of [["upperarm_l", -Math.PI / 2], ["upperarm_r", Math.PI / 2]] as const) {
      const bone = instance.getObjectByName(name);
      if (!bone?.parent) continue;
      const world = bone.getWorldQuaternion(new THREE.Quaternion());
      const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      const delta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
      bone.quaternion.copy(parent.multiply(delta.multiply(world)));
      instance.updateMatrixWorld(true);
    }
    return instance;
  }, [gltf, gl]);
  const ringColor = accentColor;
  const ringIntensity = 1.6;
  useEffect(() => {
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material.name === "Zola_Core" && material instanceof THREE.MeshStandardMaterial) {
          material.color.set(accentColor);
          material.emissive.set(accentColor);
        }
      }
    });
  }, [scene, accentColor]);
  const mixer = useMemo(() => new THREE.AnimationMixer(scene), [scene]);
  const neutral = useMemo(() => {
    const poses: { bone: THREE.Bone; position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3 }[] = [];
    scene.traverse((bone) => {
      if (!(bone instanceof THREE.Bone)) return;
      // THE SLIM DESIGN: the head/neck assembly slims down at load — the
      // bulkier humanoid proportions read wrong on a drone-bodied companion
      if (bone.name === "neck_01") bone.scale.set(0.7, 1, 0.7);
      if (/^head$/i.test(bone.name)) bone.scale.set(0.86, 1, 0.86);
      poses.push({ bone, position: bone.position.clone(), rotation: bone.quaternion.clone(), scale: bone.scale.clone() });
    });
    return poses;
  }, [scene]);
  const poseScratch = useMemo(() => ({ position: new THREE.Vector3(), rotation: new THREE.Quaternion(), delta: new THREE.Quaternion(), euler: new THREE.Euler() }), []);

  // THE SOLID BODY: bones needed for the hand-vs-torso penetration guard —
  // her visual clips are retargeted human motion and can fold a hand INTO
  // the torso mesh; the guard pushes it back out through the elbow, every
  // frame, so the body reads solid instead of interpenetrating.
  const solidBones = useMemo(() => {
    const map = new Map<string, THREE.Bone>();
    for (const { bone } of neutral) map.set(bone.name, bone);
    return map;
  }, [neutral]);
  const solidScratch = useMemo(() => ({
    hand: new THREE.Vector3(), elbow: new THREE.Vector3(), mid: new THREE.Vector3(),
    s0: new THREE.Vector3(), s1: new THREE.Vector3(), close: new THREE.Vector3(),
    u: new THREE.Vector3(), w: new THREE.Vector3(), axis: new THREE.Vector3(), corr: new THREE.Quaternion(), pq: new THREE.Quaternion(), fix: new THREE.Quaternion(),
  }), []);
  const guardArm = (side: "l" | "r", R: number) => {
    const s = solidScratch;
    const upper = solidBones.get(`upperarm_${side}`);
    const lower = solidBones.get(`lowerarm_${side}`);
    const hand = solidBones.get(`hand_${side}`) ?? solidBones.get(`palm_${side}`);
    const top = solidBones.get("neck_01");
    const bottom = solidBones.get("spine_01");
    if (!upper || !lower || !hand || !top || !bottom) return;
    top.getWorldPosition(s.s0);
    bottom.getWorldPosition(s.s1);
    lower.getWorldPosition(s.elbow);
    hand.getWorldPosition(s.hand);
    s.mid.copy(s.elbow).add(s.hand).multiplyScalar(0.5); // the forearm's midpoint clips too
    for (const point of [s.hand, s.mid]) {
      // closest point on the spine segment (the torso capsule's axis)
      const seg = s.s1.clone().sub(s.s0);
      const t = THREE.MathUtils.clamp(point.clone().sub(s.s0).dot(seg) / Math.max(seg.lengthSq(), 1e-8), 0, 1);
      s.close.copy(s.s0).addScaledVector(seg, t);
      const dist = point.distanceTo(s.close);
      if (dist >= R) continue;
      const pen = R - dist;
      s.u.copy(s.close).sub(s.elbow);
      if (s.u.lengthSq() < 1e-8) continue;
      s.u.normalize();
      s.w.copy(point).sub(s.elbow);
      if (s.w.lengthSq() < 1e-8) continue;
      s.w.normalize();
      // rotating the forearm about cross(u, w) moves the hand AWAY from the spine
      s.axis.crossVectors(s.u, s.w);
      if (s.axis.lengthSq() < 1e-6) continue;
      s.axis.normalize();
      const theta = Math.min(0.3, 10 * pen);
      s.corr.setFromAxisAngle(s.axis, theta);
      lower.parent!.getWorldQuaternion(s.pq);
      // world-frame correction → the elbow bone's local frame:
      // qLocal' = parentQ⁻¹ · corr · parentQ · qLocal, then ease halfway (no jitter)
      s.fix.copy(s.pq).invert().multiply(s.corr).multiply(s.pq);
      const q = lower.quaternion;
      q.slerp(s.fix.multiply(q), 0.5);
    }
  };

  const activeAction = useRef<THREE.AnimationAction | null>(null);
  const activeName = useRef<string | null>(null);
  const playbackId = useRef(0);
  const gestureTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const gestureQueue = useRef<string[]>([]); // the improv chain lives here
  const sway = useRef({ t: 0 });
  const ringRef = useRef<THREE.Mesh>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const propsRef = useRef<THREE.Group>(null);
  // Mirror the latest HAL pose + the speaking state for the frame loop.
  const flightRef = useRef(flight);
  flightRef.current = flight;
  const speakingRef = useRef(!!speaking);
  speakingRef.current = !!speaking;
  // the talk-expression layer: a gentle conversational nod/sway while she
  // speaks — delta-encoded so it never accumulates under the mixer
  const talkSway = useRef({ yaw: 0, pitch: 0 });

  const clearGestureTimers = () => {
    for (const timer of gestureTimers.current) clearTimeout(timer);
    gestureTimers.current.clear();
  };
  const scheduleGestureStep = (run: () => void, delayMs: number) => {
    const timer = setTimeout(() => {
      gestureTimers.current.delete(timer);
      run();
    }, Math.max(0, delayMs));
    gestureTimers.current.add(timer);
  };

  // Measure actual render frames and sample real WebGL draw/triangle counts.
  const gateRef = useRef({ frames: 0, t: 0 });
  useFrame((_, delta) => {
    const g = gateRef.current;
    g.frames += 1;
    g.t += delta;
    if (g.t >= 5) {
      const info = gl.info.render;
      const measuredFps = g.frames / g.t;
      onTelemetry?.(measuredFps);
      console.log(`[zola-render] fps=${measuredFps.toFixed(1)} drawCalls=${info.calls} triangles=${info.triangles}`);
      g.frames = 0;
      g.t = 0;
    }
  });

  // the procedural balancer — runs whenever no gesture owns her body
  useFrame((_, delta) => {
    mixer.update(delta);
    // THE SOLID BODY: hands never enter the torso — the guard runs after the
    // animation, before the render, every frame
    guardArm("l", 0.105);
    guardArm("r", 0.105);
    // TALKING EXPRESSION on the web body: while she speaks, a soft nod and
    // head turn punctuate the line (the Isaac policy trains the full routine)
    {
      const neck = solidBones.get("neck_01");
      if (neck) {
        const wantYaw = speakingRef.current ? Math.sin(sway.current.t * 2.4) * 0.06 : 0;
        const wantPitch = speakingRef.current ? Math.sin(sway.current.t * 3.7) * 0.035 : 0;
        neck.rotation.y += wantYaw - talkSway.current.yaw;
        neck.rotation.x += wantPitch - talkSway.current.pitch;
        talkSway.current.yaw = wantYaw;
        talkSway.current.pitch = wantPitch;
      }
    }
    // FLIGHT: one body, grounded and airborne — she lifts off her pad with
    // real altitude (cm resolution from the HAL) and her cranial halo —
    // her actual propulsion array — brightens as the motors spool up.
    if (bodyRef.current) {
      const f = flightRef.current;
      const k = 1 - Math.exp(-7 * delta);
      const targetX = THREE.MathUtils.clamp(f?.x ?? 0, -1.6, 1.6) * 0.24;
      const targetZ = THREE.MathUtils.clamp(f?.y ?? 0, -1.6, 1.6) * 0.24;
      const targetYaw = f?.yaw ?? 0;
      bodyRef.current.position.x += (targetX - bodyRef.current.position.x) * k;
      bodyRef.current.position.z += (targetZ - bodyRef.current.position.z) * k;
      bodyRef.current.rotation.y += Math.atan2(
        Math.sin(targetYaw - bodyRef.current.rotation.y),
        Math.cos(targetYaw - bodyRef.current.rotation.y),
      ) * k;
      // GROUNDED BY DEFAULT: she stopped floating — only clearly-airborne
      // altitude lifts her off the pad; a hover-in-place reads as standing
      // with the props spinning (the One-Body Directive, made visible)
      if (f && f.alt > 0.12) {
        const lift = Math.min(f.alt - 0.1, 1.2) * 0.8;
        const spin = Math.min(f.rpm / 12000, 1);
        bodyRef.current.position.y = lift + Math.sin(sway.current.t * 3.1) * 0.012 * (0.3 + spin);
        bodyRef.current.rotation.x = THREE.MathUtils.degToRad(f.pitch ?? 0);
        bodyRef.current.rotation.z = THREE.MathUtils.degToRad(f.roll ?? 0) + Math.sin(sway.current.t * 1.7) * 0.02 * spin;
        if (ringRef.current) {
          const mat = (ringRef.current as THREE.Mesh).material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = Math.max(ringIntensity, 2.5 + spin * 2.5);
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
        bodyRef.current.rotation.x = 0;
        bodyRef.current.rotation.z = 0;
        if (ringRef.current) {
          const mat = (ringRef.current as THREE.Mesh).material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = ringIntensity;
        }
        if (propsRef.current) propsRef.current.visible = true; // the drone is PART of her now — props mounted, still when grounded
      }
    }
    if (activeAction.current) return; // a gesture owns her body right now

    const cfg = MOOD_SWAY[mood] ?? MOOD_SWAY.curious;
    sway.current.t += delta * cfg.speed;

    const t = sway.current.t;
    const k = 1 - Math.exp(-10 * delta);
    // Compose small offsets with the neutral pose. Replacing bind Euler angles
    // with zeros displaced the old torso and erased the shoulder stance.
    for (const pose of neutral) {
      poseScratch.position.copy(pose.position);
      poseScratch.euler.set(0, 0, 0);
      switch (pose.bone.name) {
        case "pelvis":
          poseScratch.position.x += Math.sin(t * .9) * .008 * cfg.amp;
          poseScratch.euler.z = Math.sin(t * .9) * .025 * cfg.amp;
          break;
        case "spine_02": poseScratch.euler.z = -Math.sin(t * .9) * .02 * cfg.amp; break;
        case "spine_03": poseScratch.euler.x = Math.sin(t * 1.4) * .014 * cfg.wobble; break;
        case "upperarm_l": poseScratch.euler.x = Math.sin(t * 1.8) * .025 * cfg.amp; break;
        case "upperarm_r": poseScratch.euler.x = -Math.sin(t * 1.8) * .025 * cfg.amp; break;
        case "Head": poseScratch.euler.z = -Math.sin(t * .9) * .012 * cfg.amp; break;
      }
      poseScratch.delta.setFromEuler(poseScratch.euler);
      poseScratch.rotation.copy(pose.rotation).multiply(poseScratch.delta);
      pose.bone.position.lerp(poseScratch.position, k);
      pose.bone.quaternion.slerp(poseScratch.rotation, k);
      pose.bone.scale.lerp(pose.scale, k);
    }
  });

  // the gesture playback: load the clip, fade in, report when done
  // the MOTOR STATE: the props spin bright during flight-adjacent gestures
  // (march, dance, spin, hover), dim to standby when grounded
  const flightClips = new Set(["march_01", "dance_01", "dance_02", "spin_01"]);
  const playGesture = (name: string, fromQueue = false) => {
    if (name === "improv") {
      playbackId.current += 1;
      clearGestureTimers();
      activeAction.current?.fadeOut(0.2);
      activeAction.current = null;
      activeName.current = null;
      // IMPROV — a fresh chain of 2-3 movements, back to back (ported from
      // the retired GestureStage; there is one body, and it improvises)
      const pool = [...GESTURE_REPERTOIRE].sort(() => Math.random() - 0.5);
      gestureQueue.current = pool.slice(0, 2 + (Math.random() < 0.5 ? 1 : 0));
      const first = gestureQueue.current.shift();
      if (first) playGesture(first, true);
      return;
    }
    if (!GESTURE_REPERTOIRE.includes(name)) return;
    const requestId = ++playbackId.current;
    clearGestureTimers();
    if (!fromQueue) gestureQueue.current = [];
    // THE GLITCH FIX: the previous move keeps playing while the new clip
    // loads — killing it here left a load-gap where she snapped to the base
    // pose and then snapped into the new move (the jerky double-motion you
    // see while she talks). The crossfade happens on arrival instead.
    scanAsset(`movement:${name}`); // the aura ledger counts her movement repertoire
    const flying = flightClips.has(name);
    if (ringRef.current) {
      const mat = (ringRef.current as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = flying ? 4.5 : 0.3; // the halo dims when grounded
    }
    void loadGestureClip(name).then((clip) => {
      if (requestId !== playbackId.current) return; // a newer move replaced this load
      if (!clip) {
        onGestureChange?.(null);
        const next = gestureQueue.current.shift();
        if (next) playGesture(next, true);
        else onGestureDone?.(name);
        return;
      }
      const action = mixer.clipAction(clip);
      // crossfade ON ARRIVAL: the old move fades as the new one fades in —
      // no load-gap, no snap (the glitch while talking is gone)
      activeAction.current?.fadeOut(0.25);
      action.reset().setEffectiveWeight(1).setLoop(THREE.LoopOnce, 1).fadeIn(0.25).play();
      action.clampWhenFinished = true;
      activeAction.current = action;
      activeName.current = name;
      onGestureChange?.(name); // NOW PLAYING rides the HUD
      const dur = clip.duration;
      // GAIT LOOP — while she is strolling, the walk cycles until her brain
      // changes activity; the loop itself performs the clean stop when it does
      const afterClip = () => {
        if (requestId !== playbackId.current || activeName.current !== name) return;
        if (name === "walk_01" && activityRef.current === "walk") {
          action.reset().setEffectiveWeight(1).play();
          scheduleGestureStep(afterClip, dur * 1000);
          return;
        }
        action.fadeOut(0.3);
        activeAction.current = null;
        activeName.current = null;
        onGestureChange?.(null);
        const next = gestureQueue.current.shift(); // the improv chain continues
        if (next) playGesture(next, true);
        else onGestureDone?.(name);
      };
      scheduleGestureStep(afterClip, dur * 1000 - 300);
    });
  };

  useEffect(() => () => {
    playbackId.current += 1;
    clearGestureTimers();
    gestureQueue.current = [];
    mixer.stopAllAction();
    activeAction.current = null;
    activeName.current = null;
    if (gestureApiRef?.current) gestureApiRef.current = null;
  }, [mixer, gestureApiRef]);

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
        bones: Object.fromEntries(neutral.map(({ bone }) => [bone.name, true])),
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
        playbackId.current += 1;
        clearGestureTimers();
        gestureQueue.current = [];
        activeAction.current?.fadeOut(0.2);
        activeAction.current = null;
        activeName.current = null;
        onGestureChange?.(null);
      },
    };
  });

  return (
    <group position={[0, GROUND_OFFSET, 0]}>
      <group ref={bodyRef}>
        <primitive object={scene} />
        {/* the four 2.5-inch folding props at the Quad-Halo corners — the
            visual proxy for her real 1204/1303.5 motors, spinning with the
            live HAL RPM when she flies */}
        <group ref={propsRef}>
          {[[-0.17, 0.17], [0.17, 0.17], [-0.17, -0.17], [0.17, -0.17]].map(([x, z], i) => (
            <mesh key={i} position={[x, 1.0, z]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.11, 0.012, 8, 24]} />
              <meshStandardMaterial color="#9fb2c8" emissive={accentColor} emissiveIntensity={0.25} transparent opacity={0.55} toneMapped={false} />
            </mesh>
          ))}
        </group>
      {/* the Aura-Telemetry glow — on the humanoid body the physical ring
          is retired; her persona light lives as a soft ambient aura */}
      <mesh ref={ringRef} position={[0, 0.97, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.26, 0.02, 16, 48]} />
        <meshStandardMaterial color={ringColor} emissive={ringColor} emissiveIntensity={ringIntensity} toneMapped={false} />
      </mesh>
      </group>
      <mesh position={[0, -0.9, 0]}>
        <torusGeometry args={[0.44, 0.005, 6, 96]} />
        <meshBasicMaterial color={accentColor} transparent opacity={0.42} depthWrite={false} />
      </mesh>
      <mesh position={[0, -0.9, 0]}>
        <torusGeometry args={[0.72, 0.003, 6, 96]} />
        <meshBasicMaterial color="#8ecfff" transparent opacity={0.18} depthWrite={false} />
      </mesh>
      <pointLight position={[0, -0.5, 0.8]} color={ringColor} intensity={1.6} distance={5} decay={1.6} />
    </group>
  );
}

export default function DroneBody3D({
  accentColor = "#35d0a5",
  mood = "curious",
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
  flight?: { alt: number; rpm: number; x?: number; y?: number; yaw?: number; pitch?: number; roll?: number };
  speech?: string | null;
  onPet?: () => void;
  activity?: string;
  stretchCue?: number;
  onTelemetry?: (fps: number) => void;
  gestureApiRef?: React.MutableRefObject<GestureApi | null>;
  onGestureDone?: (name: string) => void;
  onGestureChange?: (name: string | null) => void;
}) {
  const [fpsLive, setFpsLive] = useState<number | null>(null);
  const tierLabel = fpsLive === null ? "MEASURING" : fpsLive >= 55 ? "SMOOTH" : fpsLive >= 30 ? "MID" : "LOW";

  return (
    <div
      className="zola-avatar-canvas relative h-full min-h-[300px] w-full overflow-hidden cursor-pointer"
      onClick={onPet}
      title="Interact with Zola — she responds with motion and voice"
    >
      <Canvas camera={{ position: [0, 0.18, 2.85], fov: 43 }} dpr={[1, 1.5]} gl={{ antialias: true }}
        onCreated={({ gl }) => { gl.toneMappingExposure = 1.55; }}>
        {/* THE STUDIO — a photographic three-point rig: warm key, HER color as
          the rim (she is lit by her own theme), cool fill; fog for depth; a
          contact shadow so she stands ON the floor, not above it */}
        <fog attach="fog" args={["#0a1119", 7, 15]} />
        <hemisphereLight args={["#536b87", "#070a10", 0.72]} />
        <directionalLight position={[2.5, 4.5, 3.5]} intensity={2.8} color="#edf4ff" />
        <directionalLight position={[-3.5, 1.6, -4]} intensity={2.4} color={accentColor} />
        <directionalLight position={[0, 1.2, 4.5]} intensity={0.85} color="#8ecfff" />
        <gridHelper args={[6, 24, "#1d3642", "#111e29"]} position={[0, -1.05, 0]} />
        {/* contact shadow — grounds her silhouette */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.049, 0]}>
          <circleGeometry args={[0.55, 48]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.5} depthWrite={false} />
        </mesh>
        <Suspense fallback={null}>
          <SceneRig
            accentColor={accentColor}
            mood={mood}
            flight={flight}
            speaking={!!speech}
            activity={activity}
            stretchCue={stretchCue}
            onTelemetry={setFpsLive}
            gestureApiRef={gestureApiRef}
            onGestureDone={onGestureDone}
            onGestureChange={onGestureChange}
          />
        </Suspense>
      </Canvas>
      <span className="hud-label absolute left-6 top-6 text-[9px] opacity-80">FULL-BODY MOTION RIG</span>
      {flight && flight.alt > 0.02 && (
        <span className="hud-label absolute left-6 top-12 text-[9px] text-[#35d0a5]">
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
        VIEWPORT · {fpsLive === null ? "MEASURING" : `${Math.round(fpsLive)} FPS · ${tierLabel}`}
      </span>
      <span className="hud-label absolute left-6 bottom-6 text-[9px] opacity-75">HANDS · ARMS · LEGS</span>
      <span className="hud-label absolute right-6 bottom-6 text-[9px] opacity-75">20 MOTION CLIPS</span>
    </div>
  );
}
