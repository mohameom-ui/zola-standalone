"use client";

// ============================================================================
// DRONE BODY 3D — AURA's generated mesh in a hangar viewport (WAVE 10)
// Renders public/assets/models/zola-drone-body.glb (locally generated via
// Modly / Hunyuan3D, provenance in ZOLA_UPGRADE_NOTES.md). Geometry-only
// mesh: styled with a brushed-alloy material + a synthetic LED ring whose
// emissive color is synced to her persona, like the rest of the panel.
// Non-destructive: sits beside the 2D flight-body canvas, does not replace it.
// ============================================================================

import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const BODY_URL = "/assets/models/zola-body-v2.glb";  // v2: humanoid-drone hybrid (gen-zola-humanoid-v2)

/** Center + normalize the generated mesh so any future export fits the stage. */
function FittedModel({ accentColor }: { accentColor: string }) {
  const gltf = useLoader(GLTFLoader, BODY_URL);
  const inner = useRef<THREE.Group>(null);
  const outer = useRef<THREE.Group>(null);

  useMemo(() => {
    // Normalize: center at origin, scale to a fixed size. Done once on load.
    // The GLB now ships with baked AI textures — keep its own materials.
    const scene = gltf.scene;
    scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
    });
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const s = 1.6 / maxDim;
    scene.scale.setScalar(s);
    scene.position.set(-center.x * s, -center.y * s, -center.z * s);
  }, [gltf.scene]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    // gentle hover bob + slow yaw — she's idling in the hangar
    if (inner.current) inner.current.position.y = Math.sin(t * 1.1) * 0.07;
    if (outer.current) outer.current.rotation.y = t * 0.28;
  });

  return (
    <group ref={outer}>
      <group ref={inner}>
        <primitive object={gltf.scene} />
      </group>
      {/* synthetic LED ring — emissive glow synced to her persona state */}
      <mesh position={[0, -0.55, 0.55]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.45, 0.045, 16, 48]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={3.2}
          toneMapped={false}
        />
      </mesh>
      <pointLight position={[0, -0.5, 0.8]} color={accentColor} intensity={3.4} distance={5} decay={1.6} />
    </group>
  );
}

export default function DroneBody3D({ accentColor = "#35d0a5" }: { accentColor?: string }) {
  return (
    <div className="relative h-[240px] w-full overflow-hidden rounded-lg bg-[#0b0e17]">
      <Canvas
        camera={{ position: [0, 0.7, 3.1], fov: 42 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false }}
        onCreated={({ scene }) => {
          scene.background = new THREE.Color("#0b0e17");
          scene.fog = new THREE.Fog("#0b0e17", 4, 9);
        }}
      >
        <ambientLight intensity={0.35} />
        <directionalLight position={[3, 5, 4]} intensity={1.4} color="#dfe6f2" />
        <directionalLight position={[-4, 2, -3]} intensity={0.5} color={accentColor} />
        {/* hangar floor hint — faint reflective grid reads as "dock pad" */}
        <gridHelper args={[6, 24, "#1c2230", "#141a26"]} position={[0, -1.05, 0]} />
        <Suspense fallback={null}>
          <FittedModel accentColor={accentColor} />
        </Suspense>
      </Canvas>
      <span className="hud-label absolute left-2 top-2 text-[9px] opacity-60">3D HANGAR · GENERATED BODY</span>
    </div>
  );
}