# print_export_v12.py — ZOLA → Ender 3 Max Neo (run in Blender)
#   blender --background --python Scripts/print_export_v12.py
#
# Exports her body as 3D-printable STLs sized for the Ender 3 Max Neo
# (300 x 300 x 300 mm bed):
#   print/desktop/    — the full figure as ONE piece, 280 mm tall
#   print/v12_450mm/  — the 45 cm V2-spec figure split into region parts
#   print/drone/      — the neck collar ring + four duct rings
#   print/dimensions.json — every part's bounding box in mm
# The STL is written MANUALLY from the evaluated mesh — the exporter
# operators failed three different ways in this build (stray icosphere
# included, empty selection, wrong-object export), so the writer takes the
# exact triangles it is given and nothing else. The source GLB is untouched.
import bpy, os, json, struct
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
BODY = os.path.abspath(os.path.join(HERE, "..", "public", "assets", "models", "zola-anims", "v3", "zola.glb"))
OUT = os.path.abspath(os.path.join(HERE, "..", "Saved", "print", "zola-v12"))

FULL_HEIGHT_MM = 1759.0
DESKTOP_MM = 280.0
SPEC_MM = 450.0

def log(m): print(f"[print_v12] {m}", flush=True)

def region_of(bone_name):
    n = bone_name.lower()
    side = "r" if n.endswith("_r") else "l"
    if "head" in n or "neck" in n: return "head"
    if "pelvis" in n or "hip" in n: return "pelvis"
    if "spine" in n or "torso" in n: return "torso"
    if "upperarm" in n: return f"upperarm_{side}"
    if "lowerarm" in n or "elbow" in n: return f"forearm_{side}"
    if "hand" in n or any(f in n for f in ("thumb", "index", "middle", "ring", "pinky")): return f"hand_{side}"
    if "thigh" in n: return f"thigh_{side}"
    if "calf" in n or "knee" in n: return f"shin_{side}"
    if "foot" in n or "ankle" in n or "toe" in n: return f"foot_{side}"
    return None  # unweighted strays (the pipeline's leftover icosphere) print nothing

def bake_and_prep(mesh_obj, arm):
    """Duplicate + apply the armature modifier: the printable geometry only
    exists after the modifier evaluates (the raw skinned vertices are in a
    normalized bind space — the first export was a 2 m cube)."""
    dup = mesh_obj.copy()
    dup.data = mesh_obj.data.copy()
    bpy.context.collection.objects.link(dup)
    mod = dup.modifiers.new(name="Armature", type="ARMATURE")
    mod.object = arm
    bpy.context.view_layer.objects.active = dup
    dup.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return dup

def write_stl(filepath, me, scale):
    """Binary STL written from the mesh's own triangles — no exporter ops.
    Triangulates first: procedural meshes (the drone torus) carry n-gons
    and an STL is triangles only."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    verts = [v.co.copy() for v in me.vertices]
    tris = [[me.loops[li].vertex_index for li in poly.loop_indices] for poly in me.polygons]
    n = len(tris)
    with open(filepath, "wb") as f:
        f.write(b"ZOLA V12 PRINT EXPORT".ljust(80, b"\0"))
        f.write(struct.pack("<I", n))
        for tri in tris:
            p0, p1, p2 = (verts[i] * scale for i in tri)
            normal = (p1 - p0).cross(p2 - p0)
            if normal.length > 0:
                normal.normalize()
            f.write(struct.pack("<3f", normal.x, normal.y, normal.z))
            for p in (p0, p1, p2):
                f.write(struct.pack("<3f", p.x, p.y, p.z))
            f.write(struct.pack("<H", 0))
    xs, ys, zs = [], [], []
    for tri in tris:
        for i in tri:
            p = verts[i] * scale
            xs.append(p.x); ys.append(p.y); zs.append(p.z)
    return {"tris": n, "dims_mm": [round((max(xs) - min(xs)) * 1000, 1),
                                   round((max(ys) - min(ys)) * 1000, 1),
                                   round((max(zs) - min(zs)) * 1000, 1)]}

def export_filtered(mesh_obj, arm, regions, keep_regions, filepath, scale):
    """Bake the modifier, drop every vertex outside keep_regions, write STL."""
    dup = bake_and_prep(mesh_obj, arm)
    me = dup.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    kill = []
    for v in bm.verts:
        r = regions[v.index] if v.index < len(regions) else None
        if r is None or r not in keep_regions:
            kill.append(v)
    if kill:
        bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(me)
    bm.free()
    return write_stl(filepath, me, scale)

def main():
    for sub in ("desktop", "v12_450mm", "drone"):
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    log(f"importing {BODY}")
    bpy.ops.import_scene.gltf(filepath=BODY)
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    body_mesh = max(meshes, key=lambda m: len(m.data.vertices))
    log(f"{len(meshes)} mesh(es); body = '{body_mesh.name}' ({len(body_mesh.data.vertices)} verts)")

    groups = {g.name: i for i, g in enumerate(body_mesh.vertex_groups)}
    bone_names = [b.name for b in bpy.data.armatures[0].bones]
    bone_to_vg = {bn: groups[bn] for bn in bone_names if bn in groups}
    regions = [None] * len(body_mesh.data.vertices)
    for v in body_mesh.data.vertices:
        best_name, best_w = None, 0.0
        for g in v.groups:
            name = next((bn for bn, gi in bone_to_vg.items() if gi == g.group), None)
            if name and g.weight > best_w:
                best_name, best_w = name, g.weight
        if best_name:
            regions[v.index] = region_of(best_name)
    counts = {}
    for r in regions:
        if r: counts[r] = counts.get(r, 0) + 1
    log("region vertex counts: " + json.dumps(counts))

    manifest = {"source": "zola-anims/v3/zola.glb", "full_height_mm": FULL_HEIGHT_MM,
                "printer": "Ender 3 Max Neo (300x300x300)", "parts": {}}

    # ---- 1. the DESKTOP one-piece (280 mm) ---------------------------------
    scale_d = DESKTOP_MM / FULL_HEIGHT_MM
    keep = set(r for r in regions if r)
    info = export_filtered(body_mesh, arm, regions, keep,
                           os.path.join(OUT, "desktop", "zola_full_280mm.stl"), scale_d)
    manifest["parts"]["desktop_full"] = {"file": "desktop/zola_full_280mm.stl", **info}
    log(f"desktop one-piece: {info['dims_mm']} mm, {info['tris']} tris")

    # ---- 2. the 45 cm SPLIT set ---------------------------------------------
    scale_s = SPEC_MM / FULL_HEIGHT_MM
    for region in sorted(counts):
        filepath = os.path.join(OUT, "v12_450mm", f"{region}.stl")
        info = export_filtered(body_mesh, arm, regions, {region}, filepath, scale_s)
        manifest["parts"][f"450_{region}"] = {"file": f"v12_450mm/{region}.stl", **info}
        log(f"45cm part '{region}': {info['dims_mm']} mm, {info['tris']} tris")

    # ---- 3. the DRONE (collar + four ducts, sized for the 45 cm figure) ----
    # NOTE: radii are in METERS (55 mm = 0.055) — the first draft wrote them
    # as if mm and the collar exported 138 meters wide.
    bpy.ops.mesh.primitive_torus_add(major_radius=0.045, minor_radius=0.012, location=(0, 0, 0))
    collar = bpy.context.active_object
    bpy.context.view_layer.objects.active = collar
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    info = write_stl(os.path.join(OUT, "drone", "collar_ring.stl"), collar.data, 1.0)
    manifest["parts"]["drone_collar"] = {"file": "drone/collar_ring.stl", **info}
    log(f"drone collar: {info['dims_mm']} mm")
    bpy.data.objects.remove(collar, do_unlink=True)
    for i, (x, y) in enumerate(((-0.055, 0.032), (0.055, 0.032), (-0.055, -0.032), (0.055, -0.032))):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.032, minor_radius=0.006, location=(x, y, 0))
        duct = bpy.context.active_object
        bpy.context.view_layer.objects.active = duct
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        info = write_stl(os.path.join(OUT, "drone", f"duct_{i+1}.stl"), duct.data, 1.0)
        manifest["parts"][f"drone_duct_{i+1}"] = {"file": f"drone/duct_{i+1}.stl", **info}
        log(f"duct {i+1}: {info['dims_mm']} mm")
        bpy.data.objects.remove(duct, do_unlink=True)

    with open(os.path.join(OUT, "dimensions.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    log(f"manifest → {os.path.join(OUT, 'dimensions.json')}")
    log("DONE — everything is in Saved/print/zola-v12")


main()
