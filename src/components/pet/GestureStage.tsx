"use client";

// ============================================================================
// ZOLA GESTURE STAGE — she performs her retargeted mo-cap gestures in a small
// 3D stage. GLBs load on demand from her own server (local only, no CDN) and
// are cached after first load.
//   • "do a trick"  -> IMPROV: a random chain of 2-3 gestures played back-to-back
//   • mood/activity -> targeted body language (excited→dance, sleepy→mope,
//                      sleeping→laydown, search→shrug/crawl)
//   • stretchCue    -> energy pacing: she demonstrates a stretch for you
// ============================================================================

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const LABELS: Record<string, string> = {
  wave: "WAVE", bow: "BOW", spin: "SPIN", stretch: "STRETCH",
  wave_01: "WAVE", wave_02: "WAVE 2", bow_01: "BOW", bow_02: "BOW 2",
  spin_01: "SPIN", stretch_01: "STRETCH",
  dance_01: "DANCE", dance_02: "DANCE 2", shrug_01: "SHRUG", mope_01: "MOPE",
  peekaboo_01: "PEEKABOO", curtsey_01: "CURTSEY", pickup_01: "PICK UP",
  throw_01: "THROW", laydown_01: "LAY DOWN", getup_01: "GET UP",
  rollover_01: "ROLL OVER", crawl_01: "CRAWL", march_01: "MARCH",
};

const label = (g: string) => LABELS[g] ?? g.toUpperCase();

function GestureClip({ url, onNext, isLast }: { url: string; onNext: () => void; isLast: boolean }) {
  const gltf = useLoader(GLTFLoader, url);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  useEffect(() => {
    if (!gltf) return;
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const clip = gltf.animations[0];
    if (clip) {
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      if (!isLast) {
        const done = () => { mixer.removeEventListener("finished", done); onNext(); };
        mixer.addEventListener("finished", done);
      }
    }
    mixerRef.current = mixer;
    return () => { mixer.stopAllAction(); mixer.removeEventListener("finished", () => {}); };
  }, [gltf, isLast, onNext]);

  useFrame((_, dt) => { mixerRef.current?.update(dt); });

  return <primitive object={gltf.scene} />;
}

function StageRig({ children }: { children: React.ReactNode }) {
  // gentle three-point light + slow idle turntable
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (group.current) group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.25) * 0.35;
  });
  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[2, 4, 3]} intensity={1.6} />
      <directionalLight position={[-3, 2, -2]} intensity={0.5} color="#8ecfff" />
      <group ref={group} position={[0, -0.9, 0]}>
        {children}
      </group>
    </>
  );
}

export default function GestureStage({ activity, mood, stretchCue }: { activity: string; mood: string; stretchCue?: number }) {
  const [gestures, setGestures] = useState<string[]>([]);
  const [chain, setChain] = useState<string[]>([]);       // queue of gesture names
  const [current, setCurrent] = useState<string | null>(null); // currently displayed stage content
  const cycleRef = useRef(0);
  const prevState = useRef("");

  useEffect(() => {
    fetch("/api/zola/gestures")
      .then((r) => r.json())
      .then((d: { gestures: string[] }) => setGestures(d.gestures ?? []))
      .catch(() => setGestures([]));
  }, []);

  const rand = (candidates: string[]) => {
    const available = candidates.filter((c) => gestures.includes(c));
    return available.length > 0 ? available[Math.floor(Math.random() * available.length)] : null;
  };

  // BRAIN BRIDGE — her body language follows her inner state
  useEffect(() => {
    const state = `${activity}|${mood}`;
    if (state === prevState.current || gestures.length === 0) return;
    const firstRun = prevState.current === "";
    prevState.current = state;
    if (firstRun) return;
    if (activity === "trick") {
      // IMPROV — a fresh non-repeating chain: 2-3 gestures, back to back
      const pool = [...gestures].sort(() => Math.random() - 0.5);
      const n = 2 + Math.floor(Math.random() * 2);
      setChain(pool.slice(0, Math.min(n, pool.length)));
      setCurrent("__chain__");
    } else if (mood === "excited") {
      const g = rand(["dance_01", "dance_02", "throw_01", "rollover_01"]);
      if (g) { setChain([g]); setCurrent("__chain__"); }
    } else if (mood === "sleeping") {
      const g = rand(["laydown_01"]);
      if (g) { setChain([g]); setCurrent("__chain__"); }
    } else if (mood === "sleepy") {
      const g = rand(["mope_01"]);
      if (g) { setChain([g]); setCurrent("__chain__"); }
    } else if (activity === "search") {
      const g = rand(["shrug_01", "crawl_01"]);
      if (g) { setChain([g]); setCurrent("__chain__"); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, mood, gestures]);

  // ENERGY PACING — when cued, she demonstrates the stretch
  useEffect(() => {
    if (!stretchCue) return;
    const g = rand(["stretch_01"]);
    if (g) { setChain([g, "peekaboo_01"].filter((x) => gestures.includes(x))); setCurrent("__chain__"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stretchCue]);

  const play = (name: string) => {
    setChain([name]);
    setCurrent("__chain__");
    cycleRef.current = (gestures.indexOf(name) + 1) % Math.max(gestures.length, 1);
  };

  const advance = () => setChain((q) => q.slice(1));

  // when the improv chain runs dry, return the stage to idle
  useEffect(() => {
    if (current === "__chain__" && chain.length === 0) setCurrent(null);
  }, [chain, current]);

  const playingLabel = chain.length > 1
    ? `IMPROV: ${chain.map(label).join(" → ")}`
    : chain.length === 1 ? `PLAYING ${label(chain[0])}` : "idle";

  return (
    <div className="glass-soft rounded-xl p-2">
      <div className="hud-label px-1 pb-1">GESTURE STAGE · HER BODY LANGUAGE (mo-cap retargeted, 30 fps)</div>
      <div className="rounded-lg bg-[#0b0e17] overflow-hidden" style={{ height: 260 }}>
        {current === "__chain__" && chain.length > 0 ? (
          <Canvas camera={{ position: [0, 0.4, 2.6], fov: 40 }} dpr={[1, 2]}>
            <StageRig>
              <Suspense fallback={null}>
                <GestureClip
                  key={chain[0] + String(chain.length)}
                  url={`/assets/models/zola-anims/${chain[0]}.glb`}
                  onNext={advance}
                  isLast={chain.length === 1}
                />
              </Suspense>
            </StageRig>
          </Canvas>
        ) : (
          <div className="h-full flex items-center justify-center text-[10px] tracking-widest text-[#5a5f6e] text-center px-4">
            {gestures.length === 0
              ? "NO GESTURES ON FILE — RUN THE RETARGET BATCH"
              : "PICK A GESTURE — OR SAY “DO A TRICK” FOR HER IMPROV"}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2 px-1">
        {gestures.map((g) => (
          <button
            key={g}
            onClick={() => play(g)}
            className={`text-[9px] px-2 py-1 rounded border tracking-widest transition-colors ${
              chain[0] === g ? "border-[#f0b90b] text-[#f0b90b]" : "border-white/15 text-[#8b8f9c] hover:border-white/30"
            }`}
          >
            {label(g)}
          </button>
        ))}
        <span className="text-[9px] text-[#5a5f6e] tracking-wider ml-auto self-center">{playingLabel}</span>
      </div>
    </div>
  );
}