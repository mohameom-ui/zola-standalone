// Validate the shipped body and all motions with the same Three.js GLTF loader.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const folder = path.join(root, "public/assets/models/zola-anims/v3");
const loader = new GLTFLoader();
async function load(name) {
  const bytes = await fs.readFile(path.join(folder, name));
  const document = JSON.parse(bytes.subarray(20, 20+bytes.readUInt32LE(12)).toString());
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength), "");
  return { document, gltf, bytes: bytes.length };
}

const { gltf: base, bytes: bodyBytes } = await load("zola.glb");
base.scene.updateMatrixWorld(true);
const bones = [];
base.scene.traverse(object => { if (object instanceof THREE.Bone) bones.push(object); });
assert.equal(bones.length, 65);
const location = name => base.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3());
assert(location("Head").y > location("spine_03").y);
assert(location("spine_03").y > location("pelvis").y);
assert(location("pelvis").y > location("calf_l").y);
assert(location("calf_l").y > location("foot_l").y);
const bounds = new THREE.Box3().setFromObject(base.scene);
const size = bounds.getSize(new THREE.Vector3());
assert(size.z > .15, "The character must have dimensional geometry");
assert(size.y > 1.5 && size.y < 2.1, "Unexpected visual scale");
base.scene.traverse(mesh => {
  if (!(mesh instanceof THREE.SkinnedMesh)) return;
  const weights = mesh.geometry.getAttribute("skinWeight");
  for (let i = 0; i < weights.count; i++) {
    const total = weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i);
    assert(Math.abs(total-1) < 1e-4, `Unbound or unnormalized vertex ${i}`);
  }
});
const rest = bones.map(bone => ({ bone, p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() }));
const restore = () => rest.forEach(({bone,p,q,s}) => { bone.position.copy(p); bone.quaternion.copy(q); bone.scale.copy(s); });
const files = (await fs.readdir(folder)).filter(name => name.endsWith(".glb") && name !== "zola.glb");
assert.equal(files.length, 20);
let motionBytes = 0;
for (const file of files) {
  const { document, gltf, bytes } = await load(file);
  assert(!document.meshes && !document.images && !document.textures, `${file} contains duplicate render assets`);
  assert.equal(gltf.animations.length, 1);
  const clip = gltf.animations[0];
  assert(clip.duration > 0);
  for (const track of clip.tracks) {
    const node = THREE.PropertyBinding.parseTrackName(track.name).nodeName;
    assert(THREE.PropertyBinding.findNode(base.scene, node), `${file}: missing target ${node}`);
    assert(track.values.every(Number.isFinite));
  }
  restore(); base.scene.updateMatrixWorld(true);
  const mixer = new THREE.AnimationMixer(base.scene);
  const action = mixer.clipAction(clip).setEffectiveWeight(1).setLoop(THREE.LoopOnce, 1).play();
  mixer.update(clip.duration*.25); base.scene.updateMatrixWorld(true);
  const first = bones.map(bone => bone.getWorldPosition(new THREE.Vector3()));
  mixer.update(clip.duration*.5); base.scene.updateMatrixWorld(true);
  const moved = bones.some((bone, index) => bone.getWorldPosition(new THREE.Vector3()).distanceTo(first[index]) > 1e-4);
  assert(moved, `${file} does not move any joint over its middle half`);
  for (const bone of bones) assert(bone.matrixWorld.elements.every(Number.isFinite), `${file} creates invalid pose`);
  action.stop(); mixer.uncacheRoot(base.scene);
  motionBytes += bytes;
}
assert(motionBytes < 10_000_000, "Motion library unexpectedly contains large assets");
console.log(JSON.stringify({ bodyBytes, motionBytes, bones: bones.length, motions: files.length, size: size.toArray() }, null, 2));
