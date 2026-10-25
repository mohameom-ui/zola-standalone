// ZolaDesignLayer — THE V12 CANON DESIGN MODULE (the new 3D build).
//
// One clean module owning every canon detail of her look, mounted on her
// rig bones so it moves with every gesture and clip:
//   - the neck-collar quad-drone: two fans per side, multi-blade impellers
//     inside cyan duct rings, volumetric cones washing light down onto her
//     shoulders, spinning with the live HAL RPM
//   - the monocular lens eye: barrel, iris, cyan halo — the eye IS the face
//   - the cyan energy seams: glowing rings at her elbows, wrists, knees,
//     and ankles — the bioluminescent joint lines
//   - the chest core: a circular cyan status light with soft internal glow
//   - the temple sensor studs: the head's secondary micro-cameras
// Everything here is procedural geometry at full quality — no texture
// hacks, no bone-scale tricks.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

interface Props {
  scene: THREE.Object3D;
  accentColor: string;
  flight?: { alt: number; rpm: number; x?: number; y?: number; yaw?: number; pitch?: number; roll?: number };
}

export default function ZolaDesignLayer({ scene, accentColor, flight }: Props) {
  const flightRef = useRef(flight);
  flightRef.current = flight;
  const impellers = useRef<THREE.Group[]>([]);
  const haloMat = useRef<THREE.MeshStandardMaterial | null>(null);
  const seamMats = useRef<THREE.MeshStandardMaterial[]>([]);
  const coreMat = useRef<THREE.MeshStandardMaterial | null>(null);
  const eyeGlow = useRef<THREE.MeshStandardMaterial | null>(null);

  const metalDark = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#1a1f24", metalness: 0.85, roughness: 0.32 }),
    [],
  );
  const ceramic = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#eef3f7", metalness: 0.35, roughness: 0.16 }),
    [],
  );

  // MOUNT — build every canon detail once, parented to the rig bones
  useEffect(() => {
    const bone = (name: string) => scene.getObjectByName(name) as THREE.Bone | undefined;
    const head = bone("Head");
    const neck = bone("neck_01");
    const chest = bone("spine_02") ?? bone("spine_01");
    const objects: THREE.Object3D[] = [];
    const materials: THREE.Material[] = [];
    const keep = <T extends THREE.Object3D>(o: T): T => { objects.push(o); return o; };
    const keepMat = <T extends THREE.Material>(m: T): T => { materials.push(m); return m; };

    const glowMat = (intensity: number) =>
      keepMat(new THREE.MeshStandardMaterial({
        color: accentColor, emissive: accentColor, emissiveIntensity: intensity, toneMapped: false,
      }));

    // ---- 1. THE LENS EYE (the monocular AI sensor) -------------------------
    if (head) {
      const eye = keep(new THREE.Group());
      eye.name = "zola_lens_eye";
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.041, 0.045, 28), metalDark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.148, 0.098);
      const iris = new THREE.Mesh(
        new THREE.CircleGeometry(0.026, 28),
        new THREE.MeshBasicMaterial({ color: "#05070a" }),
      );
      iris.position.set(0, 0.148, 0.121);
      const haloMatNew = glowMat(1.6);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.005, 10, 40), haloMatNew);
      halo.position.set(0, 0.148, 0.121);
      eye.add(barrel, iris, halo);
      head.add(eye);
      haloMat.current = haloMatNew;
      // the temple sensor studs — her secondary micro-cameras
      for (const side of [-1, 1]) {
        const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.014, 14), metalDark);
        stud.rotation.z = (side * Math.PI) / 2;
        stud.position.set(side * 0.095, 0.16, 0.015);
        const studGlow = new THREE.Mesh(
          new THREE.SphereGeometry(0.006, 10, 10),
          glowMat(1.1),
        );
        studGlow.position.set(side * 0.102, 0.16, 0.015);
        head.add(stud, studGlow);
      }
    }

    // ---- 2. THE NECK-COLLAR QUAD-DRONE (the core feature) ------------------
    if (neck) {
      const collar = keep(new THREE.Group());
      // the heavy docking collar at the neck base
      const collarRing = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.024, 12, 40), metalDark);
      collarRing.rotation.x = Math.PI / 2;
      collarRing.position.set(0, 0.005, 0);
      collar.add(collarRing);
      // two fans per side — tight around the neck, extending outward
      const mounts: [number, number, number][] = [
        [-0.2, 0.05, 0.02], [0.2, 0.05, 0.02],
        [-0.16, -0.02, -0.05], [0.16, -0.02, -0.05],
      ];
      for (const [x, y, z] of mounts) {
        const fan = keep(new THREE.Group());
        fan.position.set(x, y, z);
        // the mechanical mounting arm from the collar
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, Math.abs(x) * 0.92, 10), metalDark);
        arm.rotation.z = (Math.PI / 2) * Math.sign(x);
        arm.position.set(x / 2, 0, z / 2);
        fan.add(arm);
        // the duct ring — cyan glowing
        const ductGlow = glowMat(1.8); // the duct's cyan ring glow
        const duct = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.018, 10, 40), ductGlow);
        duct.rotation.x = Math.PI / 2 - 0.14;
        fan.add(duct);
        // the multi-blade impeller inside the duct — spins with the RPM
        const impeller = new THREE.Group();
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.018, 12), metalDark);
        hub.rotation.x = Math.PI / 2;
        impeller.add(hub);
        for (let b = 0; b < 4; b++) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.004, 0.024), ceramic);
          blade.rotation.y = (b / 4) * Math.PI * 2;
          blade.rotation.x = 0.35; // blade pitch — a real propeller's twist
          blade.position.set(
            Math.cos((b / 4) * Math.PI * 2) * 0.055,
            0,
            Math.sin((b / 4) * Math.PI * 2) * 0.055,
          );
          blade.rotation.y = (b / 4) * Math.PI * 2 + 0.5;
          impeller.add(blade);
        }
        impeller.rotation.x = Math.PI / 2 - 0.14;
        fan.add(impeller);
        impellers.current.push(impeller);
        // the volumetric wash — cyan light flowing down onto her shoulders
        const cone = new THREE.Mesh(
          new THREE.ConeGeometry(0.115, 0.2, 20, 1, true),
          new THREE.MeshBasicMaterial({ color: accentColor, transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false }),
        );
        cone.position.set(0, -0.1, 0);
        fan.add(cone);
        collar.add(fan);
      }
      neck.add(collar);
    }

    // ---- 3. THE CHEST CORE (the circular status light) ---------------------
    if (chest) {
      const core = keep(new THREE.Group());
      const coreGlow = glowMat(1.5);
      coreMat.current = coreGlow;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.036, 32), coreGlow);
      disc.position.set(0, 0.055, 0.095);
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.007, 8, 32), metalDark);
      bezel.position.set(0, 0.055, 0.095);
      core.add(disc, bezel);
      chest.add(core);
    }

    // ---- 4. THE ENERGY SEAMS (the bioluminescent joint lines) --------------
    const seamJoints: [string, number][] = [
      ["lowerarm_l", 0.052], ["lowerarm_r", 0.052],
      ["hand_l", 0.045], ["hand_r", 0.045],
      ["calf_l", 0.062], ["calf_r", 0.062],
      ["foot_l", 0.052], ["foot_r", 0.052],
    ];
    for (const [name, radius] of seamJoints) {
      const b = bone(name);
      if (!b) continue;
      const seamGlow = glowMat(1.2);
      seamMats.current.push(seamGlow);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.005, 8, 32), seamGlow);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, 0.008, 0);
      b.add(ring);
    }

    return () => {
      for (const o of objects) o.parent?.remove(o);
      for (const m of materials) m.dispose();
      impellers.current = [];
      seamMats.current = [];
      haloMat.current = null;
      coreMat.current = null;
      eyeGlow.current = null;
    };
  }, [scene, accentColor, metalDark, ceramic]);

  // ANIMATE — the impellers spin with the live HAL RPM; the seams breathe
  useFrame((_, delta) => {
    const f = flightRef.current;
    const rpm = f?.rpm ?? 0;
    const spin = rpm * delta * 0.004;
    if (spin > 0) {
      for (const imp of impellers.current) imp.rotation.z += spin;
    }
    // the cyan seams breathe — a slow bioluminescent pulse
    const pulse = 1.1 + Math.sin(performance.now() * 0.0011) * 0.35;
    for (const m of seamMats.current) m.emissiveIntensity = pulse;
    if (coreMat.current) coreMat.current.emissiveIntensity = pulse * 1.25;
    if (haloMat.current) haloMat.current.emissiveIntensity = 1.5 + pulse * 0.3;
    if (eyeGlow.current) eyeGlow.current.emissiveIntensity = 1.4;
  });

  return null;
}
