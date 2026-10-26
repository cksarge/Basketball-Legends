"""
Builds the rigged base player model and its mask textures.

  public/models/player.glb          rig + meshes + morph targets
  public/models/player_maskA.png    R scalp  G fade-scalp  B brows
  public/models/player_maskB.png    R stubble  G goatee  B mustache
  public/models/player_maskC.png    R full beard  G lips  B cavity (1 = open, <1 = occluded)
  public/models/player_maskD.png    R cornrows  G waves  B strand noise
  (RGB only: browsers premultiply alpha, which would destroy data in an alpha channel.)

Run inside Blender (MCP or CLI):
  blender -b -P scripts/blender/build_player.py -- <repo_root>

Source mesh: MakeHuman base mesh + macro targets (CC0, see makehuman/README.md).

Contract with the engine (src/game3d/character):
  * Meters, Y-up after export, character faces +Z, feet on y=0, 2.00 m tall.
  * Bones: hips spine chest upperchest neck head, clavicle/upperarm/forearm/hand.{L,R},
    thumb1-3, index1-2, middle1-2, ring1-2, pinky1-2 .{L,R}, thigh/shin/foot/toe.{L,R}
  * Meshes: Body (Skin, Eye, Iris), Jersey, Shorts, Socks, Shoes (Upper, Sole),
    Hair_<n> (volume styles, n = HAIR_STYLES index), Acc_Headband, Acc_SleeveL/R, Acc_KneeL/R
  * Morph targets on deforming meshes: Lean, Heavy, FaceA, FaceB, FaceC
  * Body UV0 = MakeHuman layout (masks); Jersey/Shorts UV0 = cylindrical, front at u=0.25,
    back at u=0.75, seam under the right arm.
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, kdtree

ROOT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else globals().get("REPO_ROOT", os.getcwd())
MH = os.path.join(ROOT, "scripts", "blender", "makehuman")
OUTDIR = os.path.join(ROOT, "public", "models")
TARGET_HEIGHT = 2.0
MASK_RES = 1024

def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)

# ------------------------------------------------------------ load OBJ ----
V0, VT, FACES, GROUPS = [], [], [], {}
cur = None
for line in open(os.path.join(MH, "base.obj")):
    if line.startswith("v "):
        V0.append(Vector(tuple(map(float, line.split()[1:4]))))
    elif line.startswith("vt "):
        VT.append(tuple(map(float, line.split()[1:3])))
    elif line.startswith("g "):
        cur = line.split()[1]
    elif line.startswith("f "):
        toks = [t.split("/") for t in line.split()[1:]]
        FACES.append((cur, [int(t[0]) - 1 for t in toks], [int(t[1]) - 1 if len(t) > 1 and t[1] else -1 for t in toks]))
        GROUPS.setdefault(cur, set()).update(int(t[0]) - 1 for t in toks)

def load_target(name):
    d = {}
    for line in open(os.path.join(MH, name + ".target")):
        if line[:1].isdigit():
            p = line.split()
            d[int(p[0])] = Vector((float(p[1]), float(p[2]), float(p[3])))
    return d

T = {n: load_target(n) for n in [
    "african-male-young", "caucasian-male-young", "asian-male-young",
    "universal-male-young-maxmuscle-averageweight", "universal-male-young-maxmuscle-minweight",
    "universal-male-young-maxmuscle-maxweight", "male-young-maxmuscle-averageweight-maxheight",
    "male-young-maxmuscle-averageweight-idealproportions",
]}

def compose(eth=(1 / 3, 1 / 3, 1 / 3), lean=0.0, heavy=0.0):
    v = [x.copy() for x in V0]
    def add(name, w):
        if w:
            for i, dv in T[name].items():
                v[i] += dv * w
    for w, n in zip(eth, ["african-male-young", "caucasian-male-young", "asian-male-young"]):
        add(n, w)
    add("universal-male-young-maxmuscle-averageweight", 0.55 * (1 - lean - heavy))
    add("universal-male-young-maxmuscle-minweight", 0.55 * lean)
    add("universal-male-young-maxmuscle-maxweight", 0.55 * heavy)
    add("male-young-maxmuscle-averageweight-maxheight", 0.65)
    add("male-young-maxmuscle-averageweight-idealproportions", 0.8)
    return v

BASE = compose()
KEYS = {"Lean": compose(lean=1.0), "Heavy": compose(heavy=1.0),
        "FaceA": compose(eth=(1, 0, 0)), "FaceB": compose(eth=(0, 1, 0)), "FaceC": compose(eth=(0, 0, 1))}

def centroid(vs, g):
    pts = [vs[i] for i in GROUPS[g]]
    return sum(pts, Vector()) / len(pts)

ground = centroid(BASE, "joint-ground").y
top = max(BASE[i].y for i in GROUPS["body"])
S = TARGET_HEIGHT / (top - ground)
def conv(v):
    return Vector((v.x * S, -v.z * S, (v.y - ground) * S))
BASE_B = [conv(v) for v in BASE]
KEYS_B = {k: [conv(v) for v in vs] for k, vs in KEYS.items()}
J = lambda g: conv(centroid(BASE, g))

# ---------------------------------------------------------------- scene ---
scene = bpy.context.scene
if bpy.context.object and bpy.context.object.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
for blocks in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images):
    for b in list(blocks):
        if b.users == 0:
            blocks.remove(b)
coll = scene.collection

def mat(name, color, rough=0.6, double=False):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if not m.node_tree:
        m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    m.use_backface_culling = not double
    return m

MAT = {
    "Skin": mat("Skin", (0.45, 0.28, 0.19), 0.48),
    "Eye": mat("Eye", (0.9, 0.9, 0.88), 0.15),
    "Iris": mat("Iris", (0.08, 0.05, 0.03), 0.1),
    "Socks": mat("Socks", (0.95, 0.95, 0.95), 0.95, True),
    "Jersey": mat("Jersey", (0.75, 0.1, 0.1), 0.8, True),
    "Shorts": mat("Shorts", (0.75, 0.1, 0.1), 0.75, True),
    "Upper": mat("Upper", (0.95, 0.95, 0.95), 0.4),
    "Sole": mat("Sole", (0.15, 0.15, 0.15), 0.8),
    "Hair": mat("Hair", (0.03, 0.02, 0.015), 0.85, True),
    "Accessory": mat("Accessory", (1, 1, 1), 0.85, True),
}

# -------------------------------------------------------------- skeleton ---
rig_data = bpy.data.armatures.new("PlayerRig")
rig = bpy.data.objects.new("PlayerRig", rig_data)
coll.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
EB = rig_data.edit_bones

def bone(name, head, tail, parent=None, connect=False):
    b = EB.new(name)
    b.head, b.tail = head, tail
    if (b.tail - b.head).length < 0.01:
        b.tail = b.head + Vector((0, 0, 0.03))
    if parent:
        b.parent = EB[parent]
        b.use_connect = connect
    return b

pelvis = J("joint-pelvis")
bone("hips", pelvis, J("joint-spine-4"))
bone("spine", J("joint-spine-4"), J("joint-spine-3"), "hips", True)
bone("chest", J("joint-spine-3"), J("joint-spine-2"), "spine", True)
bone("upperchest", J("joint-spine-2"), J("joint-spine-1"), "chest", True)
bone("neck", J("joint-neck"), J("joint-head"), "upperchest")
bone("head", J("joint-head"), J("joint-head-2"), "neck", True)
for side, s in (("L", "l"), ("R", "r")):
    j = lambda n, s=s: J(f"joint-{s}-{n}")
    bone(f"clavicle.{side}", j("clavicle"), j("shoulder"), "upperchest")
    bone(f"upperarm.{side}", j("shoulder"), j("elbow"), f"clavicle.{side}", True)
    bone(f"forearm.{side}", j("elbow"), j("hand"), f"upperarm.{side}", True)
    bone(f"hand.{side}", j("hand"), j("finger-3-1"), f"forearm.{side}", True)
    bone(f"thumb1.{side}", j("finger-1-1"), j("finger-1-2"), f"hand.{side}")
    bone(f"thumb2.{side}", j("finger-1-2"), j("finger-1-3"), f"thumb1.{side}", True)
    bone(f"thumb3.{side}", j("finger-1-3"), j("finger-1-4"), f"thumb2.{side}", True)
    for n, fname in ((2, "index"), (3, "middle"), (4, "ring"), (5, "pinky")):
        tip = j(f"finger-{n}-4")
        bone(f"{fname}1.{side}", j(f"finger-{n}-2"), j(f"finger-{n}-3"), f"hand.{side}")
        bone(f"{fname}2.{side}", j(f"finger-{n}-3"), tip + (tip - j(f"finger-{n}-3")) * 0.6, f"{fname}1.{side}", True)
    bone(f"thigh.{side}", j("upper-leg"), j("knee"), "hips")
    bone(f"shin.{side}", j("knee"), j("ankle"), f"thigh.{side}", True)
    bone(f"foot.{side}", j("ankle"), j("foot-1"), f"shin.{side}", True)
    bone(f"toe.{side}", j("foot-1"), j("foot-2") + (j("foot-2") - j("foot-1")) * 0.4, f"foot.{side}", True)
for b in EB:
    b.roll = 0
BONES = {b.name: (b.head.copy(), b.tail.copy()) for b in EB}
bpy.ops.object.mode_set(mode="OBJECT")

def seg(p, name):
    a, b = BONES[name]
    ab = b - a
    t = (p - a).dot(ab) / ab.length_squared
    tc = max(0.0, min(1.0, t))
    return (p - (a + ab * tc)).length, t

def nearest_bone(p):
    best, bn, bt = 1e9, None, 0
    for n in BONES:
        d, t = seg(p, n)
        if d < best:
            best, bn, bt = d, n, t
    return bn, bt

# ------------------------------------------------------------ body mesh ---
body_src = [(v, t) for g, v, t in FACES if g == "body"]
eye_src = [(v, t) for g, v, t in FACES if g in ("helper-l-eye", "helper-r-eye")]
all_src = body_src + eye_src
used = sorted({i for f, _ in all_src for i in f})
remap = {old: new for new, old in enumerate(used)}

me = bpy.data.meshes.new("BodyMesh")
me.from_pydata([BASE_B[i] for i in used], [], [[remap[i] for i in f] for f, _ in all_src])
uvl = me.uv_layers.new(name="UVMap")
for p, (_, tv) in zip(me.polygons, all_src):
    for k, ti in enumerate(tv):
        uvl.data[p.loop_start + k].uv = VT[ti] if ti >= 0 else (0.0, 0.0)
body = bpy.data.objects.new("Body", me)
coll.objects.link(body)
for k in ("Skin", "Eye", "Iris"):
    me.materials.append(MAT[k])
n_body = len(body_src)
for i, p in enumerate(me.polygons):
    p.use_smooth = True
    if i >= n_body:
        p.material_index = 1
for side in ("l", "r"):
    ec = conv(centroid(BASE, f"helper-{side}-eye"))
    for i, p in enumerate(me.polygons):
        if i >= n_body and (p.center - ec).length < 0.03 and p.center.y < ec.y - 0.0085:
            p.material_index = 2

CO = [v.co.copy() for v in me.vertices]
NORM = [v.normal.copy() for v in me.vertices]
VINFO = [nearest_bone(c) for c in CO]
KEY_POS = {k: [vs[i] for i in used] for k, vs in KEYS_B.items()}
BODY_FACES = [list(p.vertices) for p in me.polygons[:n_body]]

def isb(bn, *pre):
    return bn is not None and any(bn.startswith(x) for x in pre)

# ------------------------------------------------------- region fields ----
neck_base = BONES["neck"][0].z
shoulders = {s: BONES[f"upperarm.{s}"][0] for s in ("L", "R")}
waist_z = pelvis.z + 0.075
eye = J("joint-l-eye")
mouth = J("joint-mouth")
head_top = BONES["head"][1].z
headc = (BONES["head"][0] + BONES["head"][1]) / 2
ears = {s: J(f"joint-{s}-eye") for s in ("l", "r")}  # placeholder; ear zones below

ARMISH = ("upperarm", "forearm", "hand", "thumb", "index", "middle", "ring", "pinky")

class Pt:
    """A surface point: position + nearest bone info (interpolated for subdivided verts)."""
    __slots__ = ("co", "bn", "t")
    def __init__(self, co, bn, t):
        self.co, self.bn, self.t = co, bn, t

def f_jersey(p):
    co = p.co
    # every term is continuous so the snapped cut line is smooth
    hem = co.z - (pelvis.z - 0.11)
    side = 0.2 - abs(co.x)  # arms hang outside this
    front = smooth(-0.02, -0.09, co.y) * smooth(0.09, 0.0, abs(co.x))
    neck = (neck_base - 0.035 - 0.055 * front) - co.z
    # sleeveless armhole: an ellipsoid around the shoulder joint, deeper toward the armpit
    arm = 9.0
    for sd in "LR":
        d = co - shoulders[sd] - Vector((0, 0, -0.05))
        arm = min(arm, math.sqrt(d.x * d.x * 1.0 + d.y * d.y * 1.6 + d.z * d.z * 0.55) - 0.11)
    return min(hem, neck, arm, side)

def f_shorts(p):
    co, bn, t = p.co, p.bn, p.t
    if isb(bn, *ARMISH, "shin", "foot", "toe", "head", "neck", "chest", "upperchest", "clavicle"):
        return -1.0
    waist = waist_z - co.z
    if isb(bn, "thigh"):
        return min(waist, (0.88 - t) * 0.45)
    return waist

def f_socks(p):
    if isb(p.bn, "shin"):
        return (p.t - 0.52) * 0.4
    if isb(p.bn, "foot", "toe"):
        return 1.0
    return -1.0

def f_sleeve(side):
    def f(p):
        if p.bn == f"upperarm.{side}":
            return (p.t - 0.18) * 0.3
        if p.bn == f"forearm.{side}":
            return (0.92 - p.t) * 0.25
        return -1.0
    return f

def f_knee(side):
    def f(p):
        if p.bn == f"thigh.{side}":
            return (p.t - 0.86) * 0.45
        if p.bn == f"shin.{side}":
            return (0.2 - p.t) * 0.4
        return -1.0
    return f

def head_frame(co):
    d = co - headc
    return -d.y, d.z, d.x  # front, up, side

def ear_dist(co):
    return min((co - Vector((sx * 0.083, headc.y + 0.008, eye.z - 0.012))).length for sx in (1, -1))

def f_hairline(p, front_cut=0.035, side_drop=0.0, back_cut=-0.055, side_cut=0.01):
    """Signed distance-ish to a smooth hairline (meters, + inside)."""
    co = p.co
    if p.bn not in ("head", "neck"):
        return -1.0
    f, u, s = head_frame(co)
    ang = math.atan2(abs(s), f)  # 0 front, pi back
    frontw = max(0.0, math.cos(ang))
    backw = max(0.0, -math.cos(ang))
    sidew = 1 - frontw - backw
    cut = front_cut * frontw + back_cut * backw + (side_cut + side_drop) * sidew
    v = (co.z - eye.z) - cut
    return min(v, ear_dist(co) - 0.045)

def f_headband(p):
    if p.bn != "head":
        return -1.0
    dz = p.co.z - eye.z
    return min(dz - 0.03, 0.062 - dz, ear_dist(p.co) - 0.04)

# ------------------------------------------------------- shell builder ----
SHELLS = []  # (obj, combos) combos[i] = [(body_vertex, weight), ...]
BASE_PT = [Pt(CO[i], VINFO[i][0], VINFO[i][1]) for i in range(len(CO))]

def cut_shell(name, field, offset, material, tuck=0.0, subdiv=2):
    """Shell over body faces where `field` >= 0.

    The candidate faces are subdivided first, then the field is evaluated per new
    vertex and the cut edge is snapped exactly onto field == 0, giving clean hems
    and armholes. tuck > 0 (hair): outside verts are pushed under the skin instead,
    so the shell meets the scalp along a smooth line.
    """
    F0 = {}
    def F(i):
        if i not in F0:
            F0[i] = field(BASE_PT[i])
        return F0[i]
    faces = [f for f in BODY_FACES if any(F(v) >= -0.015 for v in f)]
    if not faces:
        return None
    bm = bmesh.new()
    vmap = {}
    combo_of = {}
    for f in faces:
        for v in f:
            if v not in vmap:
                bv = bm.verts.new(CO[v])
                vmap[v] = bv
                combo_of[bv] = [(v, 1.0)]
    for f in faces:
        try:
            bm.faces.new([vmap[v] for v in f])
        except ValueError:
            pass
    bm.verts.index_update()
    orig = list(vmap.items())
    if subdiv > 0:
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=subdiv, use_grid_fill=True)
    # combos for new verts: inverse-distance blend of the 3 nearest original verts
    kd = kdtree.KDTree(len(orig))
    for k, (vi, bv) in enumerate(orig):
        kd.insert(CO[vi], k)
    kd.balance()
    for bv in bm.verts:
        if bv in combo_of:
            continue
        near = kd.find_n(bv.co, 3)
        ws = [(orig[k][0], 1.0 / (d + 1e-4)) for (_, k, d) in near]
        tot = sum(w for _, w in ws)
        combo_of[bv] = [(vi, w / tot) for vi, w in ws]
    def pt_of(bv):
        combo = combo_of[bv]
        main = max(combo, key=lambda c: c[1])[0]
        bn = VINFO[main][0]
        t = sum(VINFO[vi][1] * w for vi, w in combo if VINFO[vi][0] == bn) / max(1e-6, sum(w for vi, w in combo if VINFO[vi][0] == bn))
        return Pt(bv.co.copy(), bn, t)
    pts = {bv: pt_of(bv) for bv in bm.verts}
    fval = {bv: field(pts[bv]) for bv in bm.verts}
    nrm_of = lambda combo: sum((NORM[vi] * w for vi, w in combo), Vector()).normalized()

    if tuck <= 0:
        # snap outside verts onto the zero crossing of an edge toward the inside
        snapped = {}
        dead = set()
        for bv in bm.verts:
            fv = fval[bv]
            if fv >= 0:
                continue
            ins = [e.other_vert(bv) for e in bv.link_edges if fval[e.other_vert(bv)] >= 0]
            if not ins:
                dead.add(bv)
                continue
            pos = Vector(); combo = {}
            for u in ins:
                a = fval[u] / (fval[u] - fv)  # 0 at u, 1 at bv
                pos += pts[u].co.lerp(pts[bv].co, a) / len(ins)
                for vi, w in combo_of[u]:
                    combo[vi] = combo.get(vi, 0) + w * (1 - a) / len(ins)
                for vi, w in combo_of[bv]:
                    combo[vi] = combo.get(vi, 0) + w * a / len(ins)
            snapped[bv] = (pos, list(combo.items()))
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if any(v in dead for v in f.verts)], context="FACES_ONLY")
        for bv, (pos, combo) in snapped.items():
            if bv.is_valid:
                bv.co = pos
                combo_of[bv] = combo
                fval[bv] = 0.0
    else:
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(fval[v] < -0.01 for v in f.verts)], context="FACES_ONLY")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.verts.index_update()
    verts = list(bm.verts)
    combos = []
    for bv in verts:
        combo = combo_of[bv]
        pt = Pt(bv.co.copy(), pts[bv].bn, pts[bv].t)
        off = offset(pt)
        if tuck > 0:
            fv = fval[bv]
            off = off * smooth(0.0, 0.012, fv) - tuck * (1 - smooth(-0.004, 0.006, fv))
        bv.co = bv.co + nrm_of(combo) * off
        combos.append(combo)
    m = bpy.data.meshes.new(name + "Mesh")
    bm.to_mesh(m)
    bm.free()
    o = bpy.data.objects.new(name, m)
    coll.objects.link(o)
    m.materials.append(material)
    for poly in m.polygons:
        poly.use_smooth = True
    SHELLS.append((o, combos))
    return o

def cyl_uv(o, z0, z1):
    uv = o.data.uv_layers.new(name="UVMap")
    for p in o.data.polygons:
        for li in range(p.loop_start, p.loop_start + p.loop_total):
            co = o.data.vertices[o.data.loops[li].vertex_index].co
            ang = math.atan2(co.x, -co.y)  # 0 front, +pi/2 left side
            u = ((ang + math.pi / 2) / (2 * math.pi)) % 1.0
            uv.data[li].uv = (u, (co.z - z0) / (z1 - z0))
    # fix seam wrap per polygon
    for p in o.data.polygons:
        us = [uv.data[li].uv.x for li in range(p.loop_start, p.loop_start + p.loop_total)]
        if max(us) - min(us) > 0.5:
            for li in range(p.loop_start, p.loop_start + p.loop_total):
                if uv.data[li].uv.x < 0.5:
                    uv.data[li].uv.x += 1.0

# ---- clothing (the jersey hangs looser toward the hem)
jersey = cut_shell("Jersey", f_jersey, lambda p: 0.013 + 0.016 * smooth(BONES["chest"][0].z, pelvis.z - 0.1, p.co.z), MAT["Jersey"])
cyl_uv(jersey, pelvis.z - 0.11, neck_base)
shorts = cut_shell("Shorts", f_shorts, lambda p: 0.03 + (p.t if isb(p.bn, "thigh") else 0.0) * 0.05, MAT["Shorts"])
cyl_uv(shorts, BONES["shin.L"][0].z, waist_z)
socks = cut_shell("Socks", f_socks, lambda p: 0.0035, MAT["Socks"], subdiv=1)

# ---- accessories
acc = [cut_shell("Acc_Headband", f_headband, lambda p: 0.008, MAT["Accessory"])]
for side in ("L", "R"):
    acc.append(cut_shell(f"Acc_Sleeve{side}", f_sleeve(side), lambda p: 0.0045, MAT["Accessory"], subdiv=1))
    acc.append(cut_shell(f"Acc_Knee{side}", f_knee(side), lambda p: 0.011, MAT["Accessory"], subdiv=1))

# ---- volume hair (texture-only styles: 0 Bald, 1 Buzz, 3 Fade, 4 Waves, 7 Braids)
def topness(p):
    return max(0.0, (p.co.z - eye.z) / (head_top - eye.z))
def noise3(c, k):
    return math.sin(c.x * k + 1.3) * math.sin(c.y * k * 1.17 + 0.7) * math.sin(c.z * k * 0.93 + 2.1)

hairs = {}
hairs[2] = cut_shell("Hair_2", f_hairline, lambda p: 0.007 + topness(p) * 0.014, MAT["Hair"], tuck=0.004, subdiv=1)
hairs[5] = cut_shell("Hair_5", lambda p: f_hairline(p, front_cut=0.03), lambda p: 0.014 + topness(p) * 0.022 + 0.007 * noise3(p.co, 230), MAT["Hair"], tuck=0.004, subdiv=1)
hairs[6] = cut_shell("Hair_6", lambda p: f_hairline(p, front_cut=0.04), lambda p: 0.022 + topness(p) ** 0.8 * 0.06 + 0.003 * noise3(p.co, 400), MAT["Hair"], tuck=0.004, subdiv=1)
hairs[8] = cut_shell("Hair_8", f_hairline, lambda p: 0.01 + topness(p) * 0.012, MAT["Hair"], tuck=0.004, subdiv=1)
hairs[9] = cut_shell("Hair_9", f_hairline, lambda p: 0.006 + topness(p) * 0.004, MAT["Hair"], tuck=0.004, subdiv=1)
hairs[10] = cut_shell("Hair_10", lambda p: f_hairline(p, side_cut=0.05, back_cut=0.01), lambda p: 0.008 + topness(p) ** 2 * 0.05 + 0.004 * noise3(p.co, 300), MAT["Hair"], tuck=0.004, subdiv=1)
hairs[11] = cut_shell("Hair_11", lambda p: min(f_hairline(p), 0.03 - abs(p.co.x)), lambda p: 0.008 + topness(p) * 0.035, MAT["Hair"], tuck=0.004, subdiv=1)

def add_tube(o, combos_list, a, b, r, anchor, segs=7):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    axis = (b - a).normalized()
    ref = Vector((1, 0, 0)) if abs(axis.x) < 0.9 else Vector((0, 1, 0))
    u = axis.cross(ref).normalized()
    w = axis.cross(u)
    rings = []
    for k_, t in enumerate((0.0, 0.35, 0.7, 1.0)):
        ring = []
        c = a.lerp(b, t)
        rr = r * (1 - 0.25 * t)
        for k in range(segs):
            ang = 2 * math.pi * k / segs
            ring.append(bm.verts.new(c + (u * math.cos(ang) + w * math.sin(ang)) * rr))
            combos_list.append([(anchor, 1.0)])
        rings.append(ring)
    for ra, rb in zip(rings, rings[1:]):
        for k in range(segs):
            bm.faces.new((ra[k], ra[(k + 1) % segs], rb[(k + 1) % segs], rb[k]))
    bm.faces.new(rings[-1][::-1])
    bm.to_mesh(o.data)
    bm.free()

head_verts = [i for i in range(len(CO)) if VINFO[i][0] == "head"]
kd = kdtree.KDTree(len(head_verts))
for n_, i in enumerate(head_verts):
    kd.insert(CO[i], n_)
kd.balance()
def anchor(p):
    return head_verts[kd.find(p)[1]]

locs_combos = dict((id(o), c) for o, c in SHELLS)[id(hairs[8])]
for k in range(26):
    ang = math.pi * (0.12 + 0.76 * k / 25)
    a = headc + Vector((math.cos(ang) * 0.098, math.sin(ang) * 0.09, 0.0 + (k % 3) * 0.014))
    add_tube(hairs[8], locs_combos, a, a + Vector((math.cos(ang) * 0.015, 0.03 + 0.01 * math.sin(ang), -0.16 - (k % 4) * 0.03)), 0.0095, anchor(a))
bun_combos = dict((id(o), c) for o, c in SHELLS)[id(hairs[9])]
bc = headc + Vector((0, 0.088, 0.075))
for k in range(8):
    ang = 2 * math.pi * k / 8
    add_tube(hairs[9], bun_combos, bc + Vector((math.cos(ang) * 0.018, -0.01, math.sin(ang) * 0.018)),
             bc + Vector((math.cos(ang + 1.2) * 0.022, 0.03, math.sin(ang + 1.2) * 0.022)), 0.02, anchor(bc))

# ---- sneakers (lofted, two materials)
def build_shoe(side):
    sx = 1 if side == "L" else -1
    fverts = [i for i in range(len(CO)) if isb(VINFO[i][0], f"foot.{side}", f"toe.{side}")
              or (VINFO[i][0] == f"shin.{side}" and VINFO[i][1] > 0.86)]
    pts = [CO[i] for i in fverts]
    toe_dir = BONES[f"toe.{side}"][0] - BONES[f"foot.{side}"][0]
    fwd = Vector((toe_dir.x, toe_dir.y, 0)).normalized()
    lat = Vector((-fwd.y, fwd.x, 0)) * sx
    if lat.x * sx < 0:
        lat = -lat
    proj = [p.dot(fwd) for p in pts]
    p0, p1 = min(proj) - 0.012, max(proj) + 0.018
    L = p1 - p0
    origin = Vector((0, 0, 0))
    NS, NR = 24, 20
    prof = []
    for si in range(NS + 1):
        s = si / NS
        c = p0 + L * s
        sl = [p for p, pr in zip(pts, proj) if abs(pr - c) < L / NS * 1.2 and p.z < 0.2]
        if sl:
            lats = [p.dot(lat) for p in sl]
            lo, hi = min(lats), max(lats)
            ztop = max(p.z for p in sl)
        else:
            lo, hi, ztop = prof[-1][1:] if prof else (-0.03, 0.03, 0.05)
        prof.append([s, lo, hi, ztop])
    # smooth profiles
    for _ in range(3):
        for k in range(1, NS):
            for j in (1, 2, 3):
                prof[k][j] = (prof[k - 1][j] + 2 * prof[k][j] + prof[k + 1][j]) / 4
    bm = bmesh.new()
    rings = []
    for s, lo, hi, ztop in prof:
        mid = (lo + hi) / 2
        width = (hi - lo) / 2 + 0.013
        collar = 0.125 * (1 - smooth(0.18, 0.5, s))
        height = max(min(ztop + 0.014, 0.2), 0.045) if s > 0.18 else collar + 0.0
        height = max(height, collar) * (1 - 0.35 * smooth(0.9, 1.0, s))
        cfw = fwd * (p0 + L * s)
        ring = []
        for ri in range(NR):
            a = 2 * math.pi * ri / NR
            ca, sa = math.cos(a), math.sin(a)
            ex = 3.0
            x = math.copysign(abs(ca) ** (2 / ex), ca) * width
            zz = math.copysign(abs(sa) ** (2 / ex), sa)
            z = (zz * 0.5 + 0.5) * height
            pnt = cfw + lat * (mid + x) + Vector((0, 0, z))
            ring.append(bm.verts.new(pnt))
        rings.append(ring)
    for ra, rb in zip(rings, rings[1:]):
        for k in range(NR):
            bm.faces.new((ra[k], rb[k], rb[(k + 1) % NR], ra[(k + 1) % NR]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me_s = bpy.data.meshes.new(f"Shoe{side}Mesh")
    bm.to_mesh(me_s)
    bm.free()
    o = bpy.data.objects.new(f"Shoe{side}", me_s)
    coll.objects.link(o)
    me_s.materials.append(MAT["Upper"])
    me_s.materials.append(MAT["Sole"])
    sub = o.modifiers.new("Sub", "SUBSURF")
    sub.levels = 1
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.ops.object.modifier_apply(modifier="Sub")
    for v in me_s.vertices:
        if v.co.z < 0.0:
            v.co.z = 0.0
    for p in me_s.polygons:
        p.use_smooth = True
        p.material_index = 1 if p.center.z < 0.024 else 0
    gf = o.vertex_groups.new(name=f"foot.{side}")
    gt = o.vertex_groups.new(name=f"toe.{side}")
    gs = o.vertex_groups.new(name=f"shin.{side}")
    jt = BONES[f"toe.{side}"][0].dot(fwd)
    for v in me_s.vertices:
        d = v.co.dot(fwd)
        w = smooth(jt - 0.03, jt + 0.04, d)
        ws = smooth(0.09, 0.13, v.co.z) * (1 - smooth(0.0, 0.3, (d - p0) / L))
        gf.add([v.index], (1 - w) * (1 - ws), "REPLACE")
        gt.add([v.index], w * (1 - ws), "REPLACE")
        gs.add([v.index], ws, "REPLACE")
    return o

shoes = [build_shoe("L"), build_shoe("R")]
bpy.ops.object.select_all(action="DESELECT")
for o in shoes:
    o.select_set(True)
bpy.context.view_layer.objects.active = shoes[0]
bpy.ops.object.join()
shoe = shoes[0]
shoe.name = "Shoes"
shoe.data.name = "ShoesMesh"

# ---- delete body faces hidden under clothing (with hem margins)
F_J = {i: f_jersey(BASE_PT[i]) for i in range(len(CO))}
F_S = {i: f_shorts(BASE_PT[i]) for i in range(len(CO))}
hide = []
for pi, f in enumerate(BODY_FACES):
    if all(F_J[v] > 0.025 for v in f) or all(F_S[v] > 0.035 for v in f):
        hide.append(pi)
    elif all(isb(VINFO[v][0], "foot", "toe") or (isb(VINFO[v][0], "shin") and VINFO[v][1] > 0.93) for v in f):
        hide.append(pi)

# ------------------------------------------------------------ mask bake ---
# Each texel is evaluated from its interpolated 3D position (numpy), so masks
# are smooth regardless of mesh density.
mid_front = [c for c in CO if abs(c.x) < 0.004 and c.y < headc.y and eye.z - 0.08 < c.z < eye.z]
nose_tip = min(mid_front, key=lambda c: c.y)
NOSE_Z = nose_tip.z
MOUTH_Z = NOSE_Z - 0.034
CHIN_Z = NOSE_Z - 0.075
JAW_Z = NOSE_Z - 0.09
EYE_Z = eye.z
HC = np.array(headc)

def sm(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def frame(X, Y, Z):
    return HC[1] - Y, Z, X  # front, up, side

def scalp_field(X, Y, Z, front_cut=0.03, back_cut=-0.055, side_cut=0.01):
    F, U, S_ = frame(X, Y, Z)
    ang = np.arctan2(np.abs(S_), F)
    fw, bw = np.maximum(np.cos(ang), 0), np.maximum(-np.cos(ang), 0)
    cut = front_cut * fw + back_cut * bw + side_cut * (1 - fw - bw)
    v = (Z - EYE_Z) - cut
    ear = np.minimum(np.sqrt((X - 0.085) ** 2 + (Y - HC[1] - 0.005) ** 2 + (Z - EYE_Z + 0.012) ** 2),
                     np.sqrt((X + 0.085) ** 2 + (Y - HC[1] - 0.005) ** 2 + (Z - EYE_Z + 0.012) ** 2)) - 0.045
    return np.minimum(v, ear)

def M_scalp(X, Y, Z):
    return sm(-0.003, 0.003, scalp_field(X, Y, Z)) * sm(neck_base, neck_base + 0.03, Z)
def M_fade(X, Y, Z):
    return M_scalp(X, Y, Z) * (0.2 + 0.8 * sm(EYE_Z, EYE_Z + 0.065, Z))
def M_brows(X, Y, Z):
    F, U, S_ = frame(X, Y, Z)
    ax = np.abs(X)
    bz = EYE_Z + 0.026 + 0.005 * np.sin(np.pi * sm(0.012, 0.06, ax)) - 0.004 * sm(0.045, 0.065, ax)
    w = 0.0062 * (1 - 0.45 * sm(0.015, 0.06, ax))
    return (1 - sm(w * 0.55, w, np.abs(Z - bz))) * sm(0.010, 0.016, ax) * (1 - sm(0.056, 0.064, ax)) * sm(0.07, 0.09, F)
def M_lips(X, Y, Z):
    F, U, S_ = frame(X, Y, Z)
    return (1 - sm(0.006, 0.010, np.abs(Z - MOUTH_Z))) * (1 - sm(0.018, 0.025, np.abs(X))) * sm(0.08, 0.1, F)
def _nose_lip_excl(X, Y, Z):
    F, U, S_ = frame(X, Y, Z)
    lips = (1 - sm(0.007, 0.011, np.abs(Z - MOUTH_Z))) * (1 - sm(0.02, 0.027, np.abs(X)))
    nose = sm(MOUTH_Z + 0.018, MOUTH_Z + 0.024, Z) * (1 - sm(0.018, 0.026, np.abs(X)))
    return np.clip(lips + nose, 0, 1) * sm(0.07, 0.09, F)
def beard_zone(X, Y, Z, raise_top=0.0):
    F, U, S_ = frame(X, Y, Z)
    ztop = NOSE_Z - 0.012 + raise_top + 0.45 * np.maximum(0, np.abs(X) - 0.02)
    top = 1 - sm(ztop - 0.004, ztop + 0.004, Z)
    bottom = sm(JAW_Z - 0.022, JAW_Z - 0.008, Z)
    front = sm(-0.02, 0.005, F)
    return top * bottom * front * (1 - _nose_lip_excl(X, Y, Z))
def M_stubble(X, Y, Z):
    return beard_zone(X, Y, Z)
def M_mustache(X, Y, Z):
    F, U, S_ = frame(X, Y, Z)
    ax = np.abs(X)
    lo = MOUTH_Z + 0.007 - 0.01 * sm(0.018, 0.03, ax)
    return sm(lo - 0.002, lo + 0.002, Z) * (1 - sm(MOUTH_Z + 0.018, MOUTH_Z + 0.022, Z)) * (1 - sm(0.026, 0.032, ax)) * sm(0.08, 0.1, F) * (1 - _nose_lip_excl(X, Y, Z) * (1 - sm(MOUTH_Z + 0.004, MOUTH_Z + 0.008, Z)))
def M_goatee(X, Y, Z):
    F, U, S_ = frame(X, Y, Z)
    chin = (1 - sm(0.022, 0.028, np.abs(X))) * sm(CHIN_Z - 0.02, CHIN_Z - 0.01, Z) * (1 - sm(MOUTH_Z - 0.009, MOUTH_Z - 0.006, Z)) * sm(0.06, 0.08, F)
    return np.clip(chin + M_mustache(X, Y, Z), 0, 1)
def M_fullbeard(X, Y, Z):
    F, U, S_ = frame(X, Y, Z)
    side = sm(-0.04, -0.02, F) * (1 - sm(0.02, 0.04, F)) * (1 - sm(EYE_Z - 0.0, EYE_Z + 0.01, Z)) * sm(JAW_Z - 0.01, JAW_Z + 0.01, Z) * sm(0.06, 0.075, np.abs(X))
    return np.clip(np.maximum(beard_zone(X, Y, Z, raise_top=0.008), side), 0, 1)
def M_cornrows(X, Y, Z):
    rows = 0.5 + 0.5 * np.cos(np.abs(X) * 2 * np.pi / 0.021)
    return M_scalp(X, Y, Z) * (0.3 + 0.7 * sm(0.3, 0.75, rows))
def M_waves(X, Y, Z):
    r = np.sqrt((X - 0) ** 2 + (Y - HC[1] - 0.035) ** 2 + (Z - HC[2] - 0.09) ** 2)
    return M_scalp(X, Y, Z) * (0.55 + 0.45 * np.sin(r * 2 * np.pi / 0.011))
def M_noise(X, Y, Z):
    n = np.sin(X * 1900 + 1.3) * np.sin(Y * 2100 + 0.7) * np.sin(Z * 1700 + 2.1)
    n2 = np.sin(X * 700 + Z * 300) * np.sin(Y * 650 - Z * 420)
    return 0.5 + 0.3 * n + 0.2 * n2
def M_cavity(X, Y, Z):
    F, U, S_ = frame(X, Y, Z)
    occ = np.zeros_like(X)
    for sx in (1, -1):
        d = np.sqrt((X - sx * 0.032) ** 2 + (Y - (eye.y + 0.006)) ** 2 + (Z - EYE_Z) ** 2)
        occ = np.maximum(occ, 0.35 * (1 - sm(0.014, 0.03, d)))
        e = np.sqrt((X - sx * 0.088) ** 2 + (Y - HC[1] - 0.005) ** 2 + (Z - EYE_Z + 0.012) ** 2)
        occ = np.maximum(occ, 0.3 * (1 - sm(0.008, 0.025, e)))
    nost = np.sqrt((np.abs(X) - 0.012) ** 2 + (Y - (nose_tip.y + 0.012)) ** 2 + (Z - (NOSE_Z - 0.012)) ** 2)
    occ = np.maximum(occ, 0.45 * (1 - sm(0.003, 0.009, nost)))
    occ = np.maximum(occ, 0.25 * (1 - sm(0.002, 0.004, np.abs(Z - MOUTH_Z))) * (1 - sm(0.02, 0.026, np.abs(X))) * sm(0.08, 0.1, F))
    return 1 - occ

CHANNELS = {
    "player_maskA": (M_scalp, M_fade, M_brows),
    "player_maskB": (M_stubble, M_goatee, M_mustache),
    "player_maskC": (M_fullbeard, M_lips, M_cavity),
    "player_maskD": (M_cornrows, M_waves, M_noise),
}

def bake_masks():
    R = MASK_RES
    out = {k: [np.zeros((R, R), np.float32) for _ in v] for k, v in CHANNELS.items()}
    for k in ("player_maskC",):
        out[k][2][:] = 1.0  # cavity default: open
    for (fv, ft) in body_src:
        pts = [CO[remap[v]] for v in fv]
        if max(p.z for p in pts) < neck_base - 0.02:
            continue
        uvs = [VT[t] for t in ft]
        tris = [(0, 1, 2)] if len(fv) == 3 else [(0, 1, 2), (0, 2, 3)]
        for a_, b_, c_ in tris:
            P = np.array([uvs[a_], uvs[b_], uvs[c_]]) * (R - 1)
            Q = np.array([pts[a_], pts[b_], pts[c_]])
            x0, y0 = np.floor(P.min(0)).astype(int) - 1
            x1, y1 = np.ceil(P.max(0)).astype(int) + 1
            x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, R - 1), min(y1, R - 1)
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            d = (P[1, 1] - P[2, 1]) * (P[0, 0] - P[2, 0]) + (P[2, 0] - P[1, 0]) * (P[0, 1] - P[2, 1])
            if abs(d) < 1e-9:
                continue
            l0 = ((P[1, 1] - P[2, 1]) * (xs - P[2, 0]) + (P[2, 0] - P[1, 0]) * (ys - P[2, 1])) / d
            l1 = ((P[2, 1] - P[0, 1]) * (xs - P[2, 0]) + (P[0, 0] - P[2, 0]) * (ys - P[2, 1])) / d
            l2 = 1 - l0 - l1
            m = (l0 >= -0.03) & (l1 >= -0.03) & (l2 >= -0.03)
            if not m.any():
                continue
            X = l0 * Q[0, 0] + l1 * Q[1, 0] + l2 * Q[2, 0]
            Y = l0 * Q[0, 1] + l1 * Q[1, 1] + l2 * Q[2, 1]
            Z = l0 * Q[0, 2] + l1 * Q[1, 2] + l2 * Q[2, 2]
            sl = (slice(y0, y1 + 1), slice(x0, x1 + 1))
            for name, fns in CHANNELS.items():
                for ci, fn in enumerate(fns):
                    val = fn(X, Y, Z)
                    tgt = out[name][ci][sl]
                    tgt[m] = val[m]
    return out

def save_rgb(name, chans):
    h, w = chans[0].shape
    rgba = np.stack(list(chans) + [np.ones((h, w), np.float32)], axis=-1).astype(np.float32)
    img = bpy.data.images.get(name) or bpy.data.images.new(name, w, h, alpha=False)
    img.scale(w, h)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = os.path.join(OUTDIR, name + ".png")
    img.file_format = "PNG"
    img.save()

os.makedirs(OUTDIR, exist_ok=True)
for name, chans in bake_masks().items():
    save_rgb(name, [np.clip(c, 0, 1) for c in chans])

# ---- now actually delete hidden body faces
bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[i] for i in hide], context="FACES_ONLY")
bm.verts.ensure_lookup_table()
keep_idx = [v.index for v in bm.verts if v.link_faces]
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bm.to_mesh(me)
bm.free()
me.validate()

# ---------------------------------------------------------- shape keys ----
def add_keys(o, combos):
    o.shape_key_add(name="Basis")
    for k, pos in KEY_POS.items():
        sk = o.shape_key_add(name=k)
        for vi, combo in enumerate(combos):
            delta = sum(((pos[b] - BASE_B[used[b]]) * w for b, w in combo), Vector())
            sk.data[vi].co = o.data.vertices[vi].co + delta

add_keys(body, [[(i, 1.0)] for i in keep_idx])
for o, combos in SHELLS:
    add_keys(o, combos)
shoe_kd_combos = []
feet = [i for i in range(len(CO)) if isb(VINFO[i][0], "foot", "toe")]
kdf = kdtree.KDTree(len(feet))
for n_, i in enumerate(feet):
    kdf.insert(CO[i], n_)
kdf.balance()
add_keys(shoe, [[(feet[kdf.find(v.co)[1]], 1.0)] for v in shoe.data.vertices])

# ------------------------------------------------------------- skinning ---
# Body gets bone-heat weights; shells copy weights from the body vertices they came from.
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")

# Body vertex weights indexed by ORIGINAL body vertex index
orig_of = {new: old for new, old in enumerate(keep_idx)}
W = {}
gname = {g.index: g.name for g in body.vertex_groups}
for v in body.data.vertices:
    W[orig_of[v.index]] = [(gname[g.group], g.weight) for g in v.groups if g.weight > 0.001]

def weights_for(combo):
    acc_w = {}
    for b, w in combo:
        src = W.get(b)
        if src is None:  # vertex was deleted (hidden under clothing): use nearest bone rigidly
            src = [(VINFO[b][0], 1.0)]
        for g, gw in src:
            acc_w[g] = acc_w.get(g, 0) + gw * w
    tot = sum(acc_w.values()) or 1
    return {g: x / tot for g, x in acc_w.items()}

head_only = {id(o) for o in hairs.values()} | {id(acc[0])}
for o, combos in SHELLS:
    o.parent = rig
    mod = o.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    groups = {}
    for vi, combo in enumerate(combos):
        ws = {"head": 1.0} if id(o) in head_only else weights_for(combo)
        for g, w in ws.items():
            if g not in groups:
                groups[g] = o.vertex_groups.new(name=g)
            groups[g].add([vi], w, "REPLACE")
shoe.parent = rig
shoe.modifiers.new("Armature", "ARMATURE").object = rig

# --------------------------------------------------------------- export ---
bpy.ops.object.select_all(action="DESELECT")
for o in scene.objects:
    o.select_set(True)
out = os.path.join(OUTDIR, "player.glb")
bpy.ops.export_scene.gltf(
    filepath=out, export_format="GLB", use_selection=True, export_apply=False,
    export_skins=True, export_morph=True, export_morph_normal=False, export_animations=False,
    export_yup=True, export_materials="EXPORT", export_image_format="NONE",
)
result = {
    "out": out,
    "body_verts": len(body.data.vertices),
    "objects": sorted(o.name for o in scene.objects),
    "size_kb": round(os.path.getsize(out) / 1024, 1),
}
