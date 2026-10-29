"""
Builds the park spectators: the player model posed (standing around, arms crossed, cheering, clapping,
filming, sitting...) and baked into small static meshes the engine instances by the hundred.

  public/models/crowd.glb   one mesh per pose and hair variant: Crowd_<pose>_<hair>

Run:
  blender -b --factory-startup -P scripts/blender/build_crowd.py -- <repo_root> [--preview out.png]
then compress (npm run assets:parks does both).

Contract with the engine (src/game3d/park/Spectators.tsx):
  * Meters, Y-up after export, standing on y = 0 (sitting poses: the seat contact at y = 0), facing +Z.
  * Each body region is its own material, Crowd_R<n>: 0 skin, 1 shirt, 2 shorts, 3 shoes, 4 hair,
    5 upper arms (skin, or shirt for a tee), 6 lower legs (skin, or pants). Faces are split by region
    before decimating, so regions never blur. The engine colors each instance from those regions,
    so one mesh covers every outfit.
  * The model is about 2 m tall; the engine scales instances to everyday heights.
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = ARGS[0] if ARGS else os.getcwd()
PREVIEW = ARGS[ARGS.index("--preview") + 1] if "--preview" in ARGS else None
OUT = os.path.join(ROOT, "scripts", "blender", "out", "crowd.glb")
os.makedirs(os.path.dirname(OUT), exist_ok=True)

# directions in Blender world space: +X is the character's left, -Y is forward, +Z is up
POSES = {
    "idle": {"upperarm": (0.16, 0.0, -1), "forearm": (0.06, -0.3, -1)},
    "crossed": {"upperarm": (0.28, -0.3, -1), "forearm": (-1, -0.42, 0.12), "mirror_forearm": (1, -0.5, 0.2)},
    "hips": {"upperarm": (0.65, 0.12, -0.75), "forearm": (-0.6, -0.05, -0.8)},
    "cheer": {"upperarm": (0.38, -0.08, 1), "forearm": (0.14, -0.12, 1)},
    "clap": {"upperarm": (0.18, -0.62, -0.78), "forearm": (-0.6, -0.75, 0.42)},
    "phone": {"upperarm": (0.16, 0.0, -1), "forearm": (0.06, -0.3, -1), "right_upperarm": (-0.18, -0.8, -0.5), "right_forearm": (0.4, -0.55, 0.75)},
    "lean": {"upperarm": (0.22, -0.9, -0.35), "forearm": (0.02, -1, 0.22), "spine": (0, -0.18, 1)},
    "point": {"upperarm": (0.16, 0.0, -1), "forearm": (0.06, -0.3, -1), "right_upperarm": (-0.3, -0.85, 0.42), "right_forearm": (-0.12, -1, 0.3)},
    "sit": {"upperarm": (0.14, -0.35, -0.95), "forearm": (0.02, -1, -0.12), "thigh": (0.1, -1, -0.04), "shin": (0.03, -0.12, -1), "foot": (0, -1, -0.25)},
    "sitcheer": {"upperarm": (0.38, -0.08, 1), "forearm": (0.14, -0.12, 1), "thigh": (0.1, -1, -0.04), "shin": (0.03, -0.12, -1), "foot": (0, -1, -0.25)},
}
HAIR = {"short": "Hair_5", "bald": None}
PARTS = {"Body": 0, "Jersey": 1, "Shorts": 2, "Shoes": 3}
TARGET_TRIS = 1800


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def aim(arm, name, d):
    """Rotate pose bone `name` so its axis points along world direction d."""
    pb = arm.pose.bones[name]
    bpy.context.view_layer.update()
    m = pb.matrix.copy()
    cur = (m.to_3x3() @ Vector((0, 1, 0))).normalized()
    want = (arm.matrix_world.inverted().to_3x3() @ Vector(d)).normalized()
    q = cur.rotation_difference(want)
    new = q.to_matrix().to_4x4() @ m.to_3x3().to_4x4()
    new.translation = m.to_translation()
    pb.matrix = new
    bpy.context.view_layer.update()


def mirror(d):
    return (-d[0], d[1], d[2])


def pose(arm, spec):
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    if "spine" in spec:
        aim(arm, "spine", spec["spine"])
    for side in ("L", "R"):
        for bone in ("upperarm", "forearm"):
            d = spec.get(f"right_{bone}") if side == "R" and f"right_{bone}" in spec else spec[bone]
            if side == "R" and f"right_{bone}" not in spec:
                d = spec.get(f"mirror_{bone}") or mirror(d)
            aim(arm, f"{bone}.{side}", d)
        # hands follow the forearm
        aim(arm, f"hand.{side}", spec.get(f"right_forearm") if side == "R" and "right_forearm" in spec else (spec.get("mirror_forearm") if side == "R" and "mirror_forearm" in spec else (spec["forearm"] if side == "L" else mirror(spec["forearm"]))))
        for bone in ("thigh", "shin", "foot"):
            if bone in spec:
                aim(arm, f"{bone}.{side}", spec[bone] if side == "L" else mirror(spec[bone]))


def regions(ob, base):
    """Per-vertex region from the rest pose (upper arms and lower legs get their own regions)."""
    out = []
    for v in ob.data.vertices:
        p = ob.matrix_world @ v.co
        r = base
        if base == 0:
            if p.z > 1.22 and abs(p.x) > 0.2 and p.z < 1.68:
                r = 5
            elif p.z < 0.62:
                r = 6
        out.append(r)
    return out


def bake(arm, parts, name):
    """Evaluated (posed) copies of the parts joined into one mesh with region colors, decimated."""
    deps = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    for ob, reg in parts:
        ev = ob.evaluated_get(deps)
        me = bpy.data.meshes.new_from_object(ev, depsgraph=deps)
        me.transform(ob.matrix_world)
        start = len(bm.verts)
        tmp = bmesh.new()
        tmp.from_mesh(me)
        tmp.verts.ensure_lookup_table()
        vmap = {}
        for i, v in enumerate(tmp.verts):
            vmap[v] = bm.verts.new(v.co)
        bm.verts.ensure_lookup_table()
        for f in tmp.faces:
            try:
                nf = bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            # the face's region: the most common one among its corners
            rs = [reg[v.index] for v in f.verts]
            nf.material_index = max(set(rs), key=rs.count)
        tmp.free()
        bpy.data.meshes.remove(me)
        del start
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for r in range(7):
        me.materials.append(bpy.data.materials.get(f"Crowd_R{r}") or bpy.data.materials.new(f"Crowd_R{r}"))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    # decimate (collapse keeps the vertex colors)
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    mod = ob.modifiers.new("dec", "DECIMATE")
    mod.ratio = min(1.0, TARGET_TRIS / max(1, tris))
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier="dec")
    ob.select_set(False)
    # sitting poses: the seat contact (lowest point under the hips) sits at z = 0
    zs = [v.co.z for v in me.vertices]
    if name.split("_")[1].startswith("sit"):
        seat = min(v.co.z for v in me.vertices if abs(v.co.y) < 0.12 and abs(v.co.x) < 0.2)
        me.transform(Matrix.Translation((0, 0, -seat)))
    else:
        me.transform(Matrix.Translation((0, 0, -min(zs))))
    return ob


def build():
    clear()
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, "public", "models", "player.glb"))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    src = {o.name: o for o in bpy.data.objects if o.type == "MESH"}
    # region tags come from the rest pose
    rest_regions = {n: regions(src[n], r) for n, r in PARTS.items()}
    for hn, h in HAIR.items():
        if h:
            rest_regions[h] = [4] * len(src[h].data.vertices)
    baked = []
    for pname, spec in POSES.items():
        pose(arm, spec)
        for hn, h in HAIR.items():
            parts = [(src[n], rest_regions[n]) for n in PARTS]
            if h:
                parts.append((src[h], rest_regions[h]))
            baked.append(bake(arm, parts, f"Crowd_{pname}_{hn}"))
    for o in list(bpy.data.objects):
        if o not in baked:
            bpy.data.objects.remove(o, do_unlink=True)
    return baked


def preview(baked, path):
    for i, o in enumerate(baked):
        o.location.x = (i % 10) * 1.1
        o.location.y = (i // 10) * 2.4
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (5, -9, 1.5)
    cam.rotation_euler = (math.radians(86), 0, 0)
    cam.data.lens = 24
    bpy.context.scene.camera = cam
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.color_type = "MATERIAL"
    for r, c in enumerate(((0.9, 0.7, 0.55), (0.8, 0.2, 0.2), (0.2, 0.25, 0.5), (0.95, 0.95, 0.95), (0.1, 0.07, 0.05), (0.9, 0.5, 0.4), (0.5, 0.45, 0.35))):
        bpy.data.materials[f"Crowd_R{r}"].diffuse_color = (*c, 1)
    sc.display.shading.light = "STUDIO"
    sc.render.resolution_x, sc.render.resolution_y = 1600, 700
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in baked:
        o.location = (0, 0, 0)


baked = build()
if PREVIEW:
    preview(baked, PREVIEW)
bpy.ops.object.select_all(action="DESELECT")
for o in baked:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True, export_materials="EXPORT", export_animations=False)
print("CROWD", OUT, round(os.path.getsize(OUT) / 1024), "KB", sum(len(o.data.polygons) for o in baked), "tris")
