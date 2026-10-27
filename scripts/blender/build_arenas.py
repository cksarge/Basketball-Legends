"""
Builds every venue in src/game3d/arena/variants.json.

  public/models/arenas/<id>.glb         shell: stands, walls, roof, scoreboards, lights, banner/logo slots
  public/models/arenas/<id>.seats.json  seat anchors for the crowd and the instanced chairs

Run inside Blender (MCP or CLI):
  blender -b -P scripts/blender/build_arenas.py -- <repo_root> [variant ...]
then compress with gltf-transform (npm run assets:arenas does both).

Contract with the engine (src/game3d/Arena.tsx):
  * Meters, Y-up after export, centre court at the origin, +X toward the right basket,
    +Z toward the camera sideline. Built around the variant's native court; the engine
    stretches the whole venue along X for the other court length.
  * One mesh object per material. Materials named Team_* are recoloured per team at runtime:
      Team_Primary, Team_Secondary, Team_Dark, Team_Pad, Team_Curtain, Team_Bleacher, Team_WallPaint
    Screen = scoreboard / video faces (UV 0..1 per face), Ribbon = LED fascia (U in metres / 3.6).
  * Objects Banner_00.., WallLogo_*, WallName_* are single quads (UV 0..1) the engine textures
    or hides. SeatModel_chair / SeatModel_backed are seat meshes at the origin, front toward +Z,
    standing on y = 0; the engine instances them and removes them from the scene.
  * Seats JSON: {"v":1, "groups": {"chair"|"backed"|"bench": [x, y, z, yaw, section, ...]}} with
    x/y/z in centimetres, yaw in degrees (rotation about +Y that turns +Z toward the court),
    section = tier * 1000 + section index along the row.
"""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = ARGS[0] if ARGS else globals().get("REPO_ROOT", os.getcwd())
ONLY = set(ARGS[1:]) or set(globals().get("ONLY_VARIANTS", []))
SPEC = json.load(open(os.path.join(ROOT, "src", "game3d", "arena", "variants.json")))["variants"]
OUTDIR = os.path.join(ROOT, "scripts", "blender", "out", "arenas")
TEXDIR = os.path.join(ROOT, "scripts", "blender", "out", "arena_tex")
os.makedirs(OUTDIR, exist_ok=True)
os.makedirs(TEXDIR, exist_ok=True)

FT = 0.3048
FLOOR_MARGIN = (2.6, 2.2)  # src/game3d/courtTexture.ts
COURT_HALF_W = 25 * FT
PANEL_W = 3.6  # LED ribbon panel width (matches Arena.tsx)


def floor_half(native):
    length = (84 if native == "hs" else 94) * FT
    return length / 2 + FLOOR_MARGIN[0], COURT_HALF_W + FLOOR_MARGIN[1]


# ------------------------------------------------------------------ textures
def save_png(name, rgb):
    """rgb: HxWx3 float array (row 0 = top)."""
    h, w, _ = rgb.shape
    img = bpy.data.images.get(name) or bpy.data.images.new(name, w, h, alpha=False)
    if img.size[0] != w:
        img.scale(w, h)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(rgba[::-1].ravel())
    path = os.path.join(TEXDIR, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


def noise(h, w, seed, scale=1.0):
    rng = np.random.default_rng(seed)
    n = rng.random((h, w)).astype(np.float32)
    # cheap blur for a softer grain
    for _ in range(2):
        n = (n + np.roll(n, 1, 0) + np.roll(n, -1, 0) + np.roll(n, 1, 1) + np.roll(n, -1, 1)) / 5
    return (n - 0.5) * scale


def tex_cmu():
    # 1.6 m tile: 4 blocks (0.4 m) x 8 courses (0.2 m), running bond, light paint
    S = 512
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) / S
    course = np.floor(y * 8)
    xs = (x * 4 + (course % 2) * 0.5) % 1.0
    ys = (y * 8) % 1.0
    mortar = (np.minimum(xs, 1 - xs) < 0.018) | (np.minimum(ys, 1 - ys) < 0.035)
    rng = np.random.default_rng(3)
    blockId = (np.floor(x * 4 + (course % 2) * 0.5) % 4) + course * 4
    tone = rng.random(64).astype(np.float32)[blockId.astype(int) % 64] * 0.05
    base = 0.88 + tone + noise(S, S, 4, 0.08)
    base = np.where(mortar, 0.74, base)
    return save_png("cmu", np.stack([base, base * 0.995, base * 0.975], -1))


def tex_brick():
    # 1.2 m tile: 6 bricks x 18 courses
    S = 512
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) / S
    course = np.floor(y * 18)
    xs = (x * 6 + (course % 2) * 0.5) % 1.0
    ys = (y * 18) % 1.0
    mortar = (np.minimum(xs, 1 - xs) < 0.025) | (np.minimum(ys, 1 - ys) < 0.07)
    rng = np.random.default_rng(7)
    bid = ((np.floor(x * 6 + (course % 2) * 0.5) % 6) + course * 6).astype(int) % 108
    t = rng.random(108).astype(np.float32)[bid]
    n = noise(S, S, 8, 0.12)
    r = 0.52 + t * 0.14 + n
    g = 0.24 + t * 0.07 + n * 0.6
    b = 0.17 + t * 0.05 + n * 0.5
    rgb = np.stack([r, g, b], -1)
    rgb[mortar] = (0.72, 0.69, 0.64)
    return save_png("brick", rgb)


def tex_wood():
    # 2 m tile: planks 0.25 m wide running along U
    S = 512
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) / S
    plank = np.floor(y * 8)
    ys = (y * 8) % 1.0
    rng = np.random.default_rng(11)
    t = rng.random(8).astype(np.float32)[plank.astype(int) % 8]
    grain = np.sin(x * 90 + np.sin(y * 40 + plank) * 2.5 + plank * 3) * 0.04 + noise(S, S, 12, 0.1)
    seam = np.minimum(ys, 1 - ys) < 0.03
    r = 0.78 + t * 0.08 + grain
    g = 0.56 + t * 0.06 + grain * 0.8
    b = 0.32 + t * 0.04 + grain * 0.5
    rgb = np.stack([r, g, b], -1)
    rgb[seam] *= 0.55
    return save_png("wood", rgb)


def tex_concrete():
    S = 512
    n = noise(S, S, 21, 0.16) + noise(S, S, 22, 0.08)
    v = 0.6 + n
    return save_png("concrete", np.stack([v, v, v * 0.98], -1))


def tex_deck():
    # corrugated roof deck, 1.5 m tile, ribs along U
    S = 256
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) / S
    rib = 0.5 + 0.5 * np.cos(y * math.pi * 2 * 10)
    v = 0.55 + rib * 0.25 + noise(S, S, 31, 0.05)
    return save_png("deck", np.stack([v, v, v * 1.02], -1))


def tex_acoustic():
    S = 256
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) / S
    dots = ((x * 24) % 1 - 0.5) ** 2 + ((y * 24) % 1 - 0.5) ** 2 < 0.04
    v = np.where(dots, 0.18, 0.32) + noise(S, S, 41, 0.03)
    return save_png("acoustic", np.stack([v, v, v * 1.05], -1))


TEX = {}


def build_textures():
    TEX.update(cmu=tex_cmu(), brick=tex_brick(), wood=tex_wood(), concrete=tex_concrete(), deck=tex_deck(), acoustic=tex_acoustic())


# ------------------------------------------------------------------ materials
MATS = {}
TILE = {}  # material -> UV tile size in metres (planar projection)


def mat(name, color=(0.8, 0.8, 0.8), rough=0.8, metal=0.0, tex=None, tile=2.0, emit=None, emit_strength=1.0, alpha=None):
    m = bpy.data.materials.new(name)
    m.use_backface_culling = False
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if tex is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = TEX[tex]
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    if emit is not None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    MATS[name] = m
    TILE[name] = tile
    return m


def build_materials():
    MATS.clear()
    TILE.clear()
    mat("Stand", (0.32, 0.33, 0.35), 0.9, tex="concrete", tile=4)
    mat("Stand_Gym", (0.42, 0.43, 0.45), 0.6)
    mat("Riser", (0.07, 0.08, 0.1), 0.85)
    mat("Concourse", (0.2, 0.2, 0.22), 0.9, tex="concrete", tile=5)
    mat("Soffit", (0.09, 0.1, 0.12), 0.9)
    mat("Wall_CMU", (1, 1, 1), 0.85, tex="cmu", tile=1.6)
    mat("Wall_Brick", (1, 1, 1), 0.9, tex="brick", tile=1.2)
    mat("Wall_Concrete", (0.75, 0.75, 0.76), 0.9, tex="concrete", tile=5)
    mat("Wall_Dark", (0.05, 0.055, 0.07), 0.85)
    mat("Acoustic", (1, 1, 1), 0.95, tex="acoustic", tile=1.2)
    mat("Roof", (0.5, 0.5, 0.52), 0.8, tex="deck", tile=1.5)
    mat("Roof_Dark", (0.035, 0.04, 0.05), 0.9)
    mat("Steel", (0.55, 0.57, 0.6), 0.45, 0.8)
    mat("Steel_Dark", (0.12, 0.13, 0.15), 0.5, 0.7)
    mat("Steel_Paint", (0.86, 0.87, 0.88), 0.6, 0.2)
    mat("Wood_Bleacher", (1, 1, 1), 0.55, tex="wood", tile=2)
    mat("Wood_Stage", (1, 1, 1), 0.45, tex="wood", tile=2)
    mat("Glass", (0.6, 0.7, 0.78), 0.05, 0.0, alpha=0.28)
    mat("Window", (0.75, 0.85, 0.95), 0.1, emit=(0.78, 0.88, 1.0), emit_strength=1.6)
    mat("Light_Emit", (1, 1, 1), 0.3, emit=(1.0, 0.97, 0.9), emit_strength=6)
    mat("Light_Warm", (1, 0.9, 0.75), 0.4, emit=(1.0, 0.82, 0.6), emit_strength=1.2)
    mat("Exit_Emit", (0.9, 0.1, 0.1), 0.4, emit=(1.0, 0.08, 0.05), emit_strength=3)
    mat("Door", (0.42, 0.44, 0.47), 0.4, 0.6)
    mat("Portal", (0.01, 0.01, 0.012), 1.0)
    mat("Suite_Interior", (0.3, 0.24, 0.2), 0.8)
    mat("Screen", (0.02, 0.02, 0.03), 0.3)
    mat("Ribbon", (0.02, 0.02, 0.03), 0.3)
    mat("Team_Primary", (0.5, 0.1, 0.1), 0.6)
    mat("Team_Secondary", (0.9, 0.9, 0.9), 0.6)
    mat("Team_Dark", (0.2, 0.05, 0.05), 0.7)
    mat("Team_Pad", (0.5, 0.1, 0.1), 0.75)
    mat("Team_Curtain", (0.45, 0.08, 0.08), 0.95)
    mat("Team_Bleacher", (0.45, 0.1, 0.1), 0.5)
    mat("Team_WallPaint", (0.5, 0.1, 0.1), 0.85, tex="cmu", tile=1.6)
    mat("Seat", (1, 1, 1), 0.55)
    mat("Slot", (1, 1, 1), 0.8)


# ------------------------------------------------------------------ geometry
def bl(p):
    """three.js (x, y, z) -> Blender (x, -z, y)."""
    return Vector((p[0], -p[2], p[1]))


class MB:
    def __init__(self):
        self.v, self.f, self.uv = [], [], []

    def poly(self, pts, uvs=None, tile=2.0):
        i = len(self.v)
        self.v += [tuple(p) for p in pts]
        self.f.append(tuple(range(i, i + len(pts))))
        self.uv.append(uvs if uvs is not None else planar(pts, tile))


def planar(pts, tile):
    a, b, c = (Vector(p) for p in pts[:3])
    n = (b - a).cross(c - a)
    ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
    out = []
    for p in pts:
        if ay >= ax and ay >= az:
            out.append((p[0] / tile, p[2] / tile))
        elif ax >= az:
            out.append((p[2] / tile, p[1] / tile))
        else:
            out.append((p[0] / tile, p[1] / tile))
    return out


class Scene:
    def __init__(self):
        self.groups = {}
        self.slots = []  # (name, material, quad pts three-coords)

    def g(self, m):
        return self.groups.setdefault(m, MB())

    def quad(self, m, a, b, c, d, uvs=None):
        self.g(m).poly([a, b, c, d], uvs, TILE.get(m, 2.0))

    def box(self, m, c, size, yaw=0.0, skip=()):
        """Axis box centred at c (three coords), size (sx, sy, sz), rotated yaw about +Y."""
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        cy, sy = math.cos(yaw), math.sin(yaw)

        def P(x, y, z):
            return (c[0] + x * cy + z * sy, c[1] + y, c[2] - x * sy + z * cy)

        faces = {
            "top": [P(-hx, hy, -hz), P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz)],
            "bottom": [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz)],
            "front": [P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)],
            "back": [P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz)],
            "left": [P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz)],
            "right": [P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz)],
        }
        for k, pts in faces.items():
            if k not in skip:
                self.g(m).poly(pts, None, TILE.get(m, 2.0))

    def beam(self, m, a, b, w, h):
        """Box from point a to point b (three coords) with cross-section w x h (h vertical-ish)."""
        a, b = Vector(a), Vector(b)
        d = b - a
        L = d.length
        mid = (a + b) / 2
        yaw = math.atan2(d.x, d.z)
        pitch = math.atan2(d.y, math.hypot(d.x, d.z))
        # build along local +Z then pitch/yaw
        pts = []
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            for sz in (-1, 1):
                v = Vector((sx * w / 2, sy * h / 2, sz * L / 2))
                # pitch about X (positive pitch raises +Z end)
                y = v.y * math.cos(pitch) + v.z * math.sin(pitch)
                z = -v.y * math.sin(pitch) + v.z * math.cos(pitch)
                x = v.x
                X = x * math.cos(yaw) + z * math.sin(yaw)
                Z = -x * math.sin(yaw) + z * math.cos(yaw)
                pts.append((mid.x + X, mid.y + y, mid.z + Z))
        # pts index: corner k (0..3) * 2 + end (0 = a, 1 = b)
        c = lambda k, e: pts[k * 2 + e]
        for k in range(4):
            k2 = (k + 1) % 4
            self.g(m).poly([c(k, 0), c(k2, 0), c(k2, 1), c(k, 1)], None, TILE.get(m, 2.0))
        self.g(m).poly([c(0, 0), c(3, 0), c(2, 0), c(1, 0)], None, TILE.get(m, 2.0))
        self.g(m).poly([c(0, 1), c(1, 1), c(2, 1), c(3, 1)], None, TILE.get(m, 2.0))

    def cyl(self, m, c, r, h, n=16):
        x0, y0, z0 = c
        ring = [(x0 + math.cos(2 * math.pi * i / n) * r, z0 + math.sin(2 * math.pi * i / n) * r) for i in range(n)]
        for i in range(n):
            j = (i + 1) % n
            self.g(m).poly([(ring[i][0], y0, ring[i][1]), (ring[j][0], y0, ring[j][1]), (ring[j][0], y0 + h, ring[j][1]), (ring[i][0], y0 + h, ring[i][1])], None, TILE.get(m, 2.0))
        self.g(m).poly([(p[0], y0, p[1]) for p in reversed(ring)], None, TILE.get(m, 2.0))
        self.g(m).poly([(p[0], y0 + h, p[1]) for p in ring], None, TILE.get(m, 2.0))

    def slot(self, name, m, a, b, c, d):
        self.slots.append((name, m, [a, b, c, d]))


def rounded_rect(hx, hz, r, n=18):
    pts = []
    corners = [(hx - r, hz - r, 0.0), (-(hx - r), hz - r, math.pi / 2), (-(hx - r), -(hz - r), math.pi), (hx - r, -(hz - r), math.pi * 1.5)]
    for cx, cz, a0 in corners:
        for i in range(n + 1):
            a = a0 + (i / n) * (math.pi / 2)
            pts.append((cx + math.cos(a) * r, cz + math.sin(a) * r))
    return pts


def ring(S, m, path, y0, y1):
    """Vertical band along a closed path from y0 to y1 (faces the inside of the loop)."""
    for i in range(len(path)):
        j = (i + 1) % len(path)
        a, b = path[i], path[j]
        S.quad(m, (a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1]))


def ribbon_ring(S, path, y0, y1, faces=("in",)):
    """LED ribbon band: one-sided faces whose text reads left-to-right from the inside of the
    loop ("in", bowl fascias) and/or from outside it ("out", centre-hung boards)."""
    for face in faces:
        L = 0.0
        off = 0.015 if face == "out" else -0.015
        cx = sum(p[0] for p in path) / len(path)
        cz = sum(p[1] for p in path) / len(path)
        pts = []
        for p in path:
            dx, dz = p[0] - cx, p[1] - cz
            dl = math.hypot(dx, dz) or 1
            pts.append((p[0] + dx / dl * off, p[1] + dz / dl * off))
        for i in range(len(pts)):
            j = (i + 1) % len(pts)
            a, b = pts[i], pts[j]
            seg = math.dist(a, b)
            if face == "in":
                # winding faces inward
                S.quad("Ribbon", (a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1]),
                       [(L / PANEL_W, 0), ((L + seg) / PANEL_W, 0), ((L + seg) / PANEL_W, 1), (L / PANEL_W, 1)])
            else:
                S.quad("Ribbon", (b[0], y0, b[1]), (a[0], y0, a[1]), (a[0], y1, a[1]), (b[0], y1, b[1]),
                       [(-(L + seg) / PANEL_W, 0), (-L / PANEL_W, 0), (-L / PANEL_W, 1), (-(L + seg) / PANEL_W, 1)])
            L += seg


def flat_ring(S, m, inner, outer, y):
    for i in range(len(inner)):
        j = (i + 1) % len(inner)
        S.quad(m, (inner[i][0], y, inner[i][1]), (inner[j][0], y, inner[j][1]), (outer[j][0], y, outer[j][1]), (outer[i][0], y, outer[i][1]))


# ------------------------------------------------------------------ seats
SEATS = {}


def add_seat(group, x, y, z, yaw, section):
    SEATS.setdefault(group, []).extend([round(x * 100), round(y * 100), round(z * 100), round(math.degrees(yaw)) % 360, section])


def seat_models(S):
    # arena chair: pedestal, seat pan, back (front toward +Z), on y = 0
    C = Scene()
    C.box("Seat", (0, 0.45, 0.02), (0.47, 0.07, 0.42))
    C.box("Seat", (0, 0.76, -0.2), (0.47, 0.52, 0.06), 0.0)
    C.box("Steel_Dark", (0, 0.2, -0.05), (0.08, 0.4, 0.22))
    C.box("Steel_Dark", (0.25, 0.62, -0.02), (0.04, 0.04, 0.38))
    B = Scene()
    B.box("Seat", (0, 0.44, 0.03), (0.42, 0.05, 0.34))
    B.box("Seat", (0, 0.62, -0.15), (0.42, 0.3, 0.04))
    return {"SeatModel_chair": C, "SeatModel_backed": B}


# ------------------------------------------------------------------ stands
def bank_frame(side, fw2, fh2, start):
    """Return P(u, v, y) -> three coords and the yaw that faces the court."""
    if side == "near":
        f = fh2 + start
        return (lambda u, v, y: (u, y, f + v)), math.pi
    if side == "far":
        f = fh2 + start
        return (lambda u, v, y: (-u, y, -(f + v))), 0.0
    if side == "left":
        f = fw2 + start
        return (lambda u, v, y: (-(f + v), y, -u)), math.pi / 2
    f = fw2 + start
    return (lambda u, v, y: (f + v, y, u)), -math.pi / 2


def build_bank(S, t, ti, fw2, fh2, style):
    P, yaw = bank_frame(t["side"], fw2, fh2, t["start"])
    L, rows, d, rise, y0 = t["length"], t["rows"], t["depth"], t["rise"], t["y0"]
    u0, u1 = -L / 2, L / 2
    wood = style.get("bleacher") == "wood"
    tread_m = "Wood_Bleacher" if wood else "Stand_Gym"
    riser_m = "Riser" if wood else "Team_Bleacher"
    # aisles every ~7.5 m
    n_aisle = max(1, round(L / 7.5))
    aisles = [u0 + L * (k + 0.5) / n_aisle for k in range(n_aisle)] if L > 12 else [0.0]
    aw = 0.55
    top = y0 + (rows - 1) * rise
    for r in range(rows):
        y = y0 + r * rise
        v0, v1 = r * d, (r + 1) * d
        foot_end = v0 + (0.5 * d if t["seat"] == "bench" else d)
        uvs = lambda ua, ub, va, vb: [(ua / 2, va / 2), (ub / 2, va / 2), (ub / 2, vb / 2), (ua / 2, vb / 2)]
        S.quad(tread_m, P(u0, v0, y), P(u1, v0, y), P(u1, foot_end, y), P(u0, foot_end, y), uvs(u0, u1, v0, foot_end))
        if t["seat"] == "bench":
            # back half: lower deck under the seat board, then the seat board itself
            S.quad("Riser", P(u0, foot_end, y - 0.02), P(u1, foot_end, y - 0.02), P(u1, v1, y - 0.02), P(u0, v1, y - 0.02))
            segs, prev = [], u0
            for a in aisles:
                segs.append((prev, a - aw))
                prev = a + aw
            segs.append((prev, u1))
            for sa, sb in segs:
                if sb - sa > 0.3:
                    S.box("Wood_Bleacher", P((sa + sb) / 2, (foot_end + v1) / 2 + 0.03, y + 0.42), (sb - sa, 0.045, (v1 - foot_end) * 0.85), yaw + math.pi)
        # riser up to the next row (open-backed look: dark)
        if r < rows - 1:
            S.quad(riser_m, P(u0, v1, y), P(u1, v1, y), P(u1, v1, y + rise), P(u0, v1, y + rise))
        # front skirt for the first row
        if r == 0:
            S.quad("Team_Dark" if not wood else "Riser", P(u0, 0, 0), P(u1, 0, 0), P(u1, 0, y), P(u0, 0, y))
        # end panels (stepped silhouette)
        for ue in (u0, u1):
            S.quad("Steel_Dark", P(ue, v0, 0), P(ue, v1, 0), P(ue, v1, y), P(ue, v0, y))
        # seats
        mid = v0 + d * 0.55
        n = int(L / 0.5)
        sec = 0
        for k in range(n):
            u = u0 + (k + 0.5) * (L / n)
            if any(abs(u - a) < aw + 0.12 for a in aisles):
                continue
            sec = sum(1 for a in aisles if u > a)
            x, yy, z = P(u, mid, y)
            add_seat(t["seat"], x, yy, z, yaw, ti * 1000 + sec)
        # aisle steps (half step on each row's back half)
        for a in aisles:
            S.box(tread_m, P(a, v0 + d * 0.75, y + rise / 4), (aw * 2, rise / 2, d / 2), yaw + math.pi)
    # back wall/rail and side rails
    vb = rows * d
    S.quad("Riser", P(u0, vb, 0), P(u1, vb, 0), P(u1, vb, top + 1.0), P(u0, vb, top + 1.0))
    S.beam("Steel", P(u0, vb - 0.05, top + 0.95), P(u1, vb - 0.05, top + 0.95), 0.05, 0.05)
    for ue in (u0 + 0.05, u1 - 0.05):
        S.beam("Steel", P(ue, 0.3, y0 + 0.95), P(ue, vb - 0.05, top + 0.95), 0.05, 0.05)
        for r in range(0, rows, 3):
            S.beam("Steel", P(ue, r * d + 0.4, y0 + r * rise), P(ue, r * d + 0.4, y0 + r * rise + 0.95), 0.04, 0.04)
    # aisle handrails
    for a in aisles:
        S.beam("Steel", P(a, 0.4, y0 + 0.9), P(a, vb - 0.4, top + 0.9), 0.04, 0.04)
        for r in range(1, rows, 3):
            S.beam("Steel", P(a, r * d + 0.4, y0 + r * rise), P(a, r * d + 0.4, y0 + r * rise + 0.9), 0.04, 0.04)
    return {"back": vb, "top": top}


def aisle_hit(x, z, hx, hz, r, row_off):
    """Aisles on a rounded-rect bowl: every 6.6 m along the sidelines, centre of each end, middle of each corner."""
    sx, sz = hx - r, hz - r
    if abs(x) <= sx and abs(z) > sz:
        k = round(x / 6.6)
        return abs(k * 6.6) <= sx - 0.8 and abs(x - k * 6.6) < 0.62
    if abs(z) <= sz and abs(x) > sx:
        return abs(z) < 0.62
    # corner
    a = math.atan2(abs(z) - sz, abs(x) - sx)
    return abs(a - math.pi / 4) * (r + row_off) < 0.62


def build_bowl(S, t, ti, fw2, fh2, style, vomit_count, is_top_tier):
    rows, d, rise, y0, rad = t["rows"], t["depth"], t["rise"], t["y0"], t["radius"]
    hx, hz = fw2 + t["start"], fh2 + t["start"]
    top = y0 + (rows - 1) * rise
    paths = [rounded_rect(hx + r * d, hz + r * d, rad + r * d) for r in range(rows + 1)]
    n = len(paths[0])

    # vomitories (lower bowls): corners first, then ends, then sidelines
    vom = []
    cands = []
    for cx, cz in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
        cands.append(("corner", cx, cz))
    cands += [("end", 1, 0), ("end", -1, 0)]
    # far sideline only: the broadcast and 2K cameras travel along the top of the near stands
    cands += [("side", 0.55, -1), ("side", -0.55, -1), ("side", 0.2, -1), ("side", -0.2, -1)]
    vom_rows = min(7, rows - 4)
    for kind, a, b in cands[:vomit_count]:
        r0 = rows - vom_rows
        off = r0 * d
        if kind == "corner":
            ang = math.pi / 4
            px = a * (hx - rad + math.cos(ang) * (rad + off))
            pz = b * (hz - rad + math.sin(ang) * (rad + off))
            nx, nz = a * math.cos(ang), b * math.sin(ang)
        elif kind == "end":
            px, pz, nx, nz = a * (hx + off), 0.0, float(a), 0.0
        else:
            px, pz, nx, nz = a * (hx - rad), b * (hz + off), 0.0, float(b)
        vom.append((px, pz, nx, nz, r0))

    def in_vom(x, z, r):
        for px, pz, nx, nz, r0 in vom:
            if r < r0:
                continue
            # distance along the row (tangent) from the portal centre
            tx, tz = -nz, nx
            if abs((x - px) * tx + (z - pz) * tz) < 1.45 and (x - px) * nx + (z - pz) * nz > -0.5:
                return True
        return False

    for r in range(rows):
        y = y0 + r * rise
        p0, p1 = paths[r], paths[r + 1]
        for i in range(n):
            j = (i + 1) % n
            S.quad("Stand", (p0[i][0], y, p0[i][1]), (p0[j][0], y, p0[j][1]), (p1[j][0], y, p1[j][1]), (p1[i][0], y, p1[i][1]))
            if r < rows - 1:
                S.quad("Riser", (p1[i][0], y, p1[i][1]), (p1[j][0], y, p1[j][1]), (p1[j][0], y + rise, p1[j][1]), (p1[i][0], y + rise, p1[i][1]))
        # seats every 0.55 m along the row centre
        mid = [((a[0] * 0.45 + b[0] * 0.55), (a[1] * 0.45 + b[1] * 0.55)) for a, b in zip(p0, p1)]
        carry, sec, in_aisle = 0.0, 0, False
        for i in range(n):
            a, b = mid[i], mid[(i + 1) % n]
            seg = math.dist(a, b)
            if seg < 1e-6:
                continue
            # inward normal from the row offset direction
            o0, o1 = p0[i], p1[i]
            nx, nz = o0[0] - o1[0], o0[1] - o1[1]
            nl = math.hypot(nx, nz) or 1
            yaw = math.atan2(nx / nl, nz / nl)
            dd = carry
            while dd < seg:
                f = dd / seg
                x, z = a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
                hit = aisle_hit(x, z, hx, hz, rad, r * d + d * 0.55)
                if hit and not in_aisle:
                    sec += 1
                in_aisle = hit
                if not hit and not in_vom(x, z, r):
                    add_seat(t["seat"], x, y, z, yaw, ti * 1000 + sec)
                dd += 0.55
            carry = dd - seg
        # aisle steps: sample the row's back half and drop a half step where aisles cross
        back = [((a[0] * 0.25 + b[0] * 0.75), (a[1] * 0.25 + b[1] * 0.75)) for a, b in zip(p0, p1)]
        done = []
        for i in range(n):
            a, b = back[i], back[(i + 1) % n]
            seg = math.dist(a, b)
            steps = max(1, int(seg / 0.2))
            for s in range(steps):
                f = s / steps
                x, z = a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
                if aisle_hit(x, z, hx, hz, rad, r * d + d * 0.75) and all(math.dist((x, z), q) > 1.2 for q in done):
                    done.append((x, z))
                    yaw = math.atan2(b[0] - a[0], b[1] - a[1]) + math.pi / 2
                    S.box("Stand", (x, y + rise / 4, z), (1.1, rise / 2, d / 2), yaw)
    # front wall (lower) or fascia (upper tiers)
    if ti == 0:
        ring(S, "Team_Dark", paths[0], 0.0, y0)
    else:
        if style.get("fascia"):
            ribbon_ring(S, paths[0], y0 - 1.3, y0)
        else:
            ring(S, "Team_Dark", paths[0], y0 - 1.3, y0)
        # glass rail on the fascia
        ring(S, "Glass", [(p[0] * 1.0, p[1] * 1.0) for p in paths[0]], y0, y0 + 0.9)
        # soffit underneath
        flat_ring(S, "Soffit", paths[0], paths[rows], y0 - 1.3)
    # back wall above the top row
    open_top = is_top_tier and style.get("roof") == "arch"
    ring(S, "Riser", paths[rows], top, top + (6.0 if is_top_tier and not open_top else 1.2))
    if open_top:
        # fieldhouse: a walkway from the top row out to the brick walls
        X, Z = style["_walls"]
        flat_ring(S, "Concourse", paths[rows], rounded_rect(X, Z, 0.05), top)
    # vomitory portals
    for px, pz, nx, nz, r0 in vom:
        yaw = math.atan2(nx, nz)
        depth_v = (rows - r0) * d + 0.2
        yb = y0 + r0 * rise
        cx, cz = px + nx * depth_v / 2, pz + nz * depth_v / 2
        S.box("Portal", (cx, yb + (top - yb) / 2 + 0.6, cz), (2.6, top - yb + 1.2, depth_v), yaw)
        for s in (-1, 1):
            tx, tz = -nz * s * 1.42, nx * s * 1.42
            S.box("Team_Dark", (cx + tx, yb + (top - yb) / 2 + 0.65, cz + tz), (0.25, top - yb + 1.3, depth_v), yaw)
        S.beam("Steel", (px - nz * 1.4, yb + 1.0 + 0.0, pz + nx * 1.4), (px + nz * 1.4, yb + 1.0, pz - nx * 1.4), 0.05, 0.05)
        S.box("Exit_Emit", (px, top + 0.75, pz), (0.5, 0.18, 0.04), yaw)
    return {"paths": paths, "top": top, "back": t["start"] + rows * d}


# ------------------------------------------------------------------ venue parts
def walls(S, v, fw2, fh2, m, ceiling):
    X, Z = v["walls"]["x"], v["walls"]["z"]
    S.quad(m, (-X, 0, -Z), (X, 0, -Z), (X, ceiling, -Z), (-X, ceiling, -Z))
    S.quad(m, (X, 0, Z), (-X, 0, Z), (-X, ceiling, Z), (X, ceiling, Z))
    S.quad(m, (-X, 0, Z), (-X, 0, -Z), (-X, ceiling, -Z), (-X, ceiling, Z))
    S.quad(m, (X, 0, -Z), (X, 0, Z), (X, ceiling, Z), (X, ceiling, -Z))


def gym_dressing(S, v, fw2, fh2, tops):
    st = v["style"]
    X, Z = v["walls"]["x"], v["walls"]["z"]
    C, G = v["ceiling"], v["girderY"]
    modern = st["wall"] == "cmu2"
    walls(S, v, fw2, fh2, "Wall_CMU", C)
    # painted wainscot band + stripe on every wall
    band = 3.0 if modern else 2.4
    for (a, b) in (((-X, -Z), (X, -Z)), ((X, Z), (-X, Z)), ((-X, Z), (-X, -Z)), ((X, -Z), (X, Z))):
        S.quad("Team_WallPaint", (a[0] * 0.999, 0, a[1] * 0.999), (b[0] * 0.999, 0, b[1] * 0.999), (b[0] * 0.999, band, b[1] * 0.999), (a[0] * 0.999, band, a[1] * 0.999))
        S.quad("Team_Secondary", (a[0] * 0.999, band, a[1] * 0.999), (b[0] * 0.999, band, b[1] * 0.999), (b[0] * 0.999, band + 0.3, b[1] * 0.999), (a[0] * 0.999, band + 0.3, a[1] * 0.999))
    # wall pads behind each basket
    for s in (-1, 1):
        if st.get("stage") and s > 0:
            continue
        S.box("Team_Pad", (s * (X - 0.06), 1.1, 0), (0.1, 2.2, 12), 0)
    # ceiling deck + structure
    S.quad("Roof", (-X, C, -Z), (-X, C, Z), (X, C, Z), (X, C, -Z))
    if st["roof"] == "girders":
        for gz in [k * 7.0 for k in range(-3, 4) if abs(k * 7.0) < Z - 1]:
            S.box("Steel_Paint", (0, G + 0.35, gz), (2 * X, 0.7, 0.3))
            S.box("Steel_Paint", (0, G + 0.05, gz), (2 * X, 0.08, 0.5))
        for gx in [k * 2.5 for k in range(-12, 13) if abs(k * 2.5) < X - 0.5]:
            S.box("Steel_Paint", (gx, C - 0.25, 0), (0.12, 0.4, 2 * Z))
    else:
        # open-web joists across the gym + one lengthwise girder for the baskets
        for gx in [k * 3.0 for k in range(-9, 10) if abs(k * 3.0) < X - 0.5]:
            S.box("Steel_Paint", (gx, C - 0.15, 0), (0.15, 0.12, 2 * Z))
            S.box("Steel_Paint", (gx, C - 1.15, 0), (0.15, 0.12, 2 * Z))
            for k in range(int(2 * Z / 1.5)):
                z0 = -Z + k * 1.5
                S.beam("Steel_Paint", (gx, C - 1.15, z0), (gx, C - 0.15, z0 + 0.75), 0.05, 0.05)
                S.beam("Steel_Paint", (gx, C - 0.15, z0 + 0.75), (gx, C - 1.15, z0 + 1.5), 0.05, 0.05)
        S.box("Steel_Paint", (0, G + 0.35, 0), (2 * X, 0.7, 0.3))
        # acoustic panels high on the long walls
        for s in (-1, 1):
            for k in range(-4, 5):
                x = k * 5.0
                if abs(x) + 2 > X:
                    continue
                S.box("Acoustic", (x, C - 3.2, s * (Z - 0.08)), (3.6, 2.4, 0.08))
    # lights: high-bay fixtures over the floor
    for x in [k * 4.0 for k in range(-4, 5)]:
        for z in (-6.0, -2.0, 2.0, 6.0):
            if modern:
                S.box("Light_Emit", (x, G - 0.25, z), (1.2, 0.06, 0.4))
                S.box("Steel_Dark", (x, G - 0.2, z), (1.26, 0.06, 0.46))
            else:
                S.cyl("Light_Emit", (x, G - 0.5, z), 0.28, 0.04, 16)
                S.cyl("Steel_Dark", (x, G - 0.46, z), 0.3, 0.3, 16)
                S.beam("Steel_Dark", (x, G - 0.16, z), (x, G + 0.05, z), 0.03, 0.03)
    # clerestory windows on the near wall and both end walls
    if st.get("windows"):
        for k in range(-5, 6):
            x = k * 3.2
            if abs(x) + 1.2 > X:
                continue
            S.quad("Window", (x - 1.2, G - 2.6, Z - 0.03), (x + 1.2, G - 2.6, Z - 0.03), (x + 1.2, G - 0.6, Z - 0.03), (x - 1.2, G - 0.6, Z - 0.03))
            S.box("Steel_Paint", (x, G - 1.6, Z - 0.06), (0.08, 2.1, 0.06))
        for s in (-1, 1):
            for k in (-2, -1, 0, 1, 2):
                z = k * 3.2
                S.quad("Window", (s * (X - 0.03), G - 2.6, z - 1.2), (s * (X - 0.03), G - 2.6, z + 1.2), (s * (X - 0.03), G - 0.6, z + 1.2), (s * (X - 0.03), G - 0.6, z - 1.2))
    # doors + exit signs in the corners of the end walls
    for s in (-1, 1):
        for zz in (-(Z - 3.0), Z - 3.0):
            S.box("Door", (s * (X - 0.05), 1.15, zz), (0.08, 2.3, 1.9))
            S.box("Steel_Dark", (s * (X - 0.1), 1.05, zz), (0.06, 0.05, 1.7))
            S.box("Exit_Emit", (s * (X - 0.08), 2.7, zz), (0.05, 0.22, 0.6))
    # stage at the right end (small old gyms)
    if st.get("stage"):
        S.box("Wood_Stage", (X - 1.6, 1.1 / 2, 0), (3.2, 1.1, 2 * Z - 4))
        S.box("Team_Dark", (X - 3.2 - 0.005, 0.55, 0), (0.01, 1.1, 2 * Z - 4))
        # pleated curtain
        n = 60
        for k in range(n):
            z0 = -(Z - 2) + (2 * Z - 4) * k / n
            z1 = -(Z - 2) + (2 * Z - 4) * (k + 1) / n
            dx = 0.12 if k % 2 == 0 else 0.0
            S.quad("Team_Curtain", (X - 0.3 - dx, 1.1, z0), (X - 0.3 - (0.12 - dx), 1.1, z1), (X - 0.3 - (0.12 - dx), 6.2, z1), (X - 0.3 - dx, 6.2, z0))
        S.box("Team_Curtain", (X - 0.5, 6.5, 0), (0.15, 0.7, 2 * Z - 4))
    # far wall: wordmark under the banner row
    far_top = tops.get("far", 3.0)
    name_y = far_top + 1.4
    S.slot("WallName_far", "Slot", (-9, name_y, -(Z - 0.04)), (9, name_y, -(Z - 0.04)), (9, name_y + 1.5, -(Z - 0.04)), (-9, name_y + 1.5, -(Z - 0.04)))
    # logo on the far wall centre, banners either side
    ly = name_y + 1.9
    lsz = min(3.4, G - 0.6 - ly)
    S.slot("WallLogo_far", "Slot", (-lsz / 2, ly, -(Z - 0.04)), (lsz / 2, ly, -(Z - 0.04)), (lsz / 2, ly + lsz, -(Z - 0.04)), (-lsz / 2, ly + lsz, -(Z - 0.04)))
    nb = st["banners"]
    bw, bh = 1.3, min(2.4, G - 0.5 - ly)
    xs = []
    for k in range(nb):
        side = -1 if k % 2 == 0 else 1
        xs.append(side * (lsz / 2 + 1.0 + (k // 2) * 1.7 + bw / 2))
    for k, x in enumerate(xs):
        if abs(x) + bw / 2 > X - 0.5:
            continue
        S.slot(f"Banner_{k:02d}", "Slot", (x - bw / 2, ly, -(Z - 0.05)), (x + bw / 2, ly, -(Z - 0.05)), (x + bw / 2, ly + bh, -(Z - 0.05)), (x - bw / 2, ly + bh, -(Z - 0.05)))
    # scoreboards
    sb_y = 5.2 if v["ceiling"] < 10 else 6.0
    for s in (-1, 1):
        if st.get("stage") and s > 0:
            sb_y_s = 6.9
        else:
            sb_y_s = sb_y
        w, h = (4.4, 2.3) if st["scoreboards"] == "wall" else (5.6, 3.15)
        x = s * (X - 0.25)
        S.box("Steel_Dark", (x, sb_y_s, 0), (0.4, h + 0.3, w + 0.3))
        face = s * (X - 0.46)
        # Screen faces the court (UV 0..1)
        S.quad("Screen", (face, sb_y_s - h / 2, -s * w / 2), (face, sb_y_s - h / 2, s * w / 2), (face, sb_y_s + h / 2, s * w / 2), (face, sb_y_s + h / 2, -s * w / 2), [(0, 0), (1, 0), (1, 1), (0, 1)])
        if st["scoreboards"] == "wall":
            S.box("Team_Primary", (s * (X - 0.3), sb_y_s + h / 2 + 0.45, 0), (0.3, 0.6, w + 0.3))
    return {}


def arena_dressing(S, v, fw2, fh2, tiers_out):
    st = v["style"]
    X, Z = v["walls"]["x"], v["walls"]["z"]
    C, G = v["ceiling"], v["girderY"]
    wall_m = {"brick": "Wall_Brick", "concrete": "Wall_Concrete", "dark": "Wall_Dark"}[st["wall"]]
    if st["roof"] == "arch":
        # brick long walls up to the spring line, gable end walls, barrel vault on arched trusses
        spring = G
        apex = C
        R = (Z * Z + (apex - spring) ** 2) / (2 * (apex - spring))
        cy = apex - R

        def arch_y(z):
            return cy + math.sqrt(max(0.0, R * R - z * z))

        for s in (-1, 1):
            S.quad(wall_m, (-X, 0, s * Z), (X, 0, s * Z), (X, spring, s * Z), (-X, spring, s * Z))
        N = 24
        zs = [-Z + 2 * Z * k / N for k in range(N + 1)]
        for s in (-1, 1):
            for k in range(N):
                z0, z1 = zs[k], zs[k + 1]
                S.quad(wall_m, (s * X, 0, z0), (s * X, 0, z1), (s * X, arch_y(z1), z1), (s * X, arch_y(z0), z0))
            # big arched end window
            for k in range(N):
                z0, z1 = zs[k] * 0.55, zs[k + 1] * 0.55
                ya0, ya1 = arch_y(z0 / 0.55) - 1.2, arch_y(z1 / 0.55) - 1.2
                S.quad("Window", (s * (X - 0.04), spring + 0.4, z0), (s * (X - 0.04), spring + 0.4, z1), (s * (X - 0.04), max(spring + 0.5, ya1), z1), (s * (X - 0.04), max(spring + 0.5, ya0), z0))
            for k in range(-4, 5):
                S.box("Steel_Dark", (s * (X - 0.08), (spring + apex) / 2, k * Z * 0.55 / 4.5), (0.08, apex - spring, 0.12))
        for k in range(N):
            z0, z1 = zs[k], zs[k + 1]
            S.quad("Roof", (-X, arch_y(z0), z0), (X, arch_y(z0), z0), (X, arch_y(z1), z1), (-X, arch_y(z1), z1))
        # arched steel trusses every 7 m
        for gx in [k * 7.0 for k in range(-5, 6) if abs(k * 7.0) < X - 1]:
            for k in range(N):
                z0, z1 = zs[k], zs[k + 1]
                S.beam("Steel_Dark", (gx, arch_y(z0) - 0.2, z0), (gx, arch_y(z1) - 0.2, z1), 0.25, 0.25)
                S.beam("Steel_Dark", (gx, arch_y(z0) - 1.6, z0), (gx, arch_y(z1) - 1.6, z1), 0.18, 0.18)
                S.beam("Steel_Dark", (gx, arch_y(z0) - 1.6, z0), (gx, arch_y(z1) - 0.2, z1), 0.08, 0.08)
        # brick piers on the long walls
        for gx in [k * 7.0 for k in range(-5, 6) if abs(k * 7.0) < X - 1]:
            for s in (-1, 1):
                S.box(wall_m, (gx, spring / 2, s * (Z - 0.4)), (1.0, spring, 0.8))
    else:
        walls(S, v, fw2, fh2, wall_m, C)
        S.quad("Roof_Dark", (-X, C, -Z), (-X, C, Z), (X, C, Z), (X, C, -Z))
        # roof trusses
        for gx in [k * 8.0 for k in range(-8, 9) if abs(k * 8.0) < X - 1]:
            S.box("Steel_Dark", (gx, G + 1.2, 0), (0.5, 0.4, 2 * Z))
            S.box("Steel_Dark", (gx, G - 0.6, 0), (0.4, 0.3, 2 * Z))
            for k in range(int(2 * Z / 4)):
                z0 = -Z + k * 4
                S.beam("Steel_Dark", (gx, G - 0.6, z0), (gx, G + 1.2, z0 + 2), 0.12, 0.12)
                S.beam("Steel_Dark", (gx, G + 1.2, z0 + 2), (gx, G - 0.6, z0 + 4), 0.12, 0.12)
        # concourse glow strip at the top of the upper bowl
        top_back = tiers_out[-1]
        path = rounded_rect(fw2 + top_back["back"] + 0.1, fh2 + top_back["back"] + 0.1, 12)
        ring(S, "Light_Warm", path, top_back["top"] + 6.0, top_back["top"] + 6.3)
    # catwalk + light banks over the floor
    cy_ = G - 1.0 if st["roof"] != "arch" else G + 1.5
    cw_x, cw_z = fw2 + 2, fh2 + 2
    for s in (-1, 1):
        S.box("Steel_Dark", (0, cy_, s * cw_z), (2 * cw_x, 0.15, 1.0))
        S.box("Steel_Dark", (s * cw_x, cy_, 0), (1.0, 0.15, 2 * cw_z))
        for k in range(-6, 7):
            x = k * (cw_x / 6.5)
            S.box("Light_Emit", (x, cy_ - 0.25, s * (cw_z - 0.4)), (0.6, 0.06, 0.4))
            S.box("Steel_Dark", (x, cy_ - 0.15, s * (cw_z - 0.4)), (0.66, 0.16, 0.46))
        for k in range(-3, 4):
            z = k * (cw_z / 3.5)
            S.box("Light_Emit", (s * (cw_x - 0.4), cy_ - 0.25, z), (0.4, 0.06, 0.6))
    # hangers from the roof
    for s1 in (-1, 1):
        for s2 in (-1, 1):
            S.beam("Steel", (s1 * cw_x, cy_, s2 * cw_z), (s1 * cw_x, (C if st["roof"] != "arch" else G + 6), s2 * cw_z), 0.03, 0.03)
    # centre-hung scoreboard
    kind = st["scoreboards"]
    size = {"centerSmall": (4.2, 2.4, 3.2, 12.5), "center": (6.4, 3.6, 4.8, 14.5), "videoBig": (8.6, 4.8, 6.2, 16.5), "halo": (10.4, 5.6, 7.4, 18.5)}[kind]
    w, h, dz, y = size
    S.box("Steel_Dark", (0, y, 0), (w + 0.3, h + 0.3, dz + 0.3))
    for k in range(4):
        ang = k * math.pi / 2
        hw = (w if k % 2 == 0 else dz) / 2
        dd = (dz if k % 2 == 0 else w) / 2 + 0.16
        sx, sz = math.sin(ang), math.cos(ang)
        tx, tz = math.cos(ang), -math.sin(ang)

        def P(u, vv):
            return (sx * dd + tx * u, y + vv, sz * dd + tz * u)

        S.quad("Screen", P(-hw, -h / 2), P(hw, -h / 2), P(hw, h / 2), P(-hw, h / 2), [(0, 0), (1, 0), (1, 1), (0, 1)])
    # LED ring under the board
    ring_path = rounded_rect(w / 2 + 0.6, dz / 2 + 0.6, 1.2, 6)
    ribbon_ring(S, ring_path, y - h / 2 - 1.3, y - h / 2 - 0.4, ("out", "in"))
    flat_ring(S, "Steel_Dark", rounded_rect(w / 2 - 0.2, dz / 2 - 0.2, 0.8, 6), ring_path, y - h / 2 - 0.4)
    if kind == "halo":
        halo = rounded_rect(w / 2 + 6, dz / 2 + 5, 5, 10)
        ribbon_ring(S, halo, y + h / 2 + 1.0, y + h / 2 + 2.4, ("out", "in"))
        S.beam("Steel_Dark", (-(w / 2 + 6), y + h / 2 + 2.4, 0), (w / 2 + 6, y + h / 2 + 2.4, 0), 0.3, 0.3)
    for s1 in (-1, 1):
        for s2 in (-1, 1):
            S.beam("Steel", (s1 * w / 3, y + h / 2, s2 * dz / 3), (s1 * w / 3, C if st["roof"] != "arch" else G + 8, s2 * dz / 3), 0.04, 0.04)
    # banners in the rafters above the left end of the upper stands; logos on the end walls
    nb = st["banners"]
    top = tiers_out[-1]
    by = min(G - 2.5, top["top"] + 3.2) if st["roof"] != "arch" else G + 0.5
    bx = -(fw2 + top["back"] * 0.55)
    bw, bh = (2.2, 4.2) if v["kind"] == "pro" else (1.8, 3.4)
    per_row = max(1, int((2 * fh2 + top["back"]) / (bw + 0.6)))
    for k in range(nb):
        row, col = divmod(k, per_row)
        z = -((per_row - 1) * (bw + 0.6)) / 2 + col * (bw + 0.6)
        x = bx - row * 3.5
        if abs(x) > X - 1:
            continue
        S.slot(f"Banner_{k:02d}", "Slot", (x, by - bh, z + bw / 2), (x, by - bh, z - bw / 2), (x, by, z - bw / 2), (x, by, z + bw / 2))
        S.beam("Steel", (x, by, z), (x, by + 1.5, z), 0.02, 0.02)
    if st["roof"] != "arch":
        # on the wall behind the top row, facing the court
        ly, lsz = top["top"] + 0.5, 5.0
        fz, rx = fh2 + top["back"] - 0.06, fw2 + top["back"] - 0.06
        S.slot("WallLogo_far", "Slot", (-lsz / 2, ly, -fz), (lsz / 2, ly, -fz), (lsz / 2, ly + lsz, -fz), (-lsz / 2, ly + lsz, -fz))
    else:
        # fieldhouse: high on the gable end wall
        ly, lsz, rx = top["top"] + 1.5, 6.0, X - 0.05
    S.slot("WallLogo_right", "Slot", (rx, ly, -lsz / 2), (rx, ly, lsz / 2), (rx, ly + lsz, lsz / 2), (rx, ly + lsz, -lsz / 2))
    if st["roof"] == "arch":
        nw = 20
        S.slot("WallName_far", "Slot", (-nw / 2, G - 2.2, -(Z - 0.9)), (nw / 2, G - 2.2, -(Z - 0.9)), (nw / 2, G - 0.6, -(Z - 0.9)), (-nw / 2, G - 0.6, -(Z - 0.9)))


def suites(S, v, fw2, fh2):
    su = v["style"].get("suites")
    if not su:
        return
    s0, y, h = su["start"], su["y"], su["height"]
    inner = rounded_rect(fw2 + s0, fh2 + s0, 8)
    outer = rounded_rect(fw2 + s0 + 3.4, fh2 + s0 + 3.4, 11.4)
    flat_ring(S, "Concourse", inner, outer, y)
    flat_ring(S, "Soffit", inner, outer, y + h)
    ring(S, "Team_Dark", inner, y, y + 1.0)
    ring(S, "Glass", inner, y + 1.0, y + h)
    ring(S, "Suite_Interior", outer, y, y + h)
    ring(S, "Light_Warm", outer, y + h - 0.35, y + h - 0.15)
    # dividers every ~4.5 m along the ring
    L = 0
    for i in range(len(inner)):
        j = (i + 1) % len(inner)
        seg = math.dist(inner[i], inner[j])
        while L < seg:
            f = L / seg
            ax, az = inner[i][0] + (inner[j][0] - inner[i][0]) * f, inner[i][1] + (inner[j][1] - inner[i][1]) * f
            bx, bz = outer[i][0] + (outer[j][0] - outer[i][0]) * f, outer[i][1] + (outer[j][1] - outer[i][1]) * f
            S.beam("Suite_Interior", (ax, y + h / 2, az), (bx, y + h / 2, bz), 0.12, h)
            L += 4.5
        L -= seg


def concourses(S, tiers, outs, fw2, fh2):
    """Floors and walls between stacked bowls."""
    for k in range(1, len(tiers)):
        lo, hi = outs[k - 1], outs[k]
        t = tiers[k]
        inner = rounded_rect(fw2 + lo["back"], fh2 + lo["back"], tiers[k - 1]["radius"] + tiers[k - 1]["rows"] * tiers[k - 1]["depth"])
        outer = rounded_rect(fw2 + t["start"] + 1.5, fh2 + t["start"] + 1.5, t["radius"] + 1.5)
        y = lo["top"] + 1.2
        flat_ring(S, "Concourse", inner, outer, y)
        ring(S, "Wall_Dark", outer, y, t["y0"] - 1.3)
        ring(S, "Light_Warm", outer, y + 2.6, y + 2.8)


def back_walls(S, tiers, outs, fw2, fh2):
    """Close the space behind and under the top tier down to the floor."""
    t, o = tiers[-1], outs[-1]
    path = rounded_rect(fw2 + o["back"], fh2 + o["back"], t["radius"] + t["rows"] * t["depth"])
    ring(S, "Wall_Dark", path, 0, o["top"])


# ------------------------------------------------------------------ build + export
def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)


def emit_objects(S, prefix=""):
    col = bpy.context.scene.collection
    objs = []
    for mname, mb in S.groups.items():
        if not mb.f:
            continue
        me = bpy.data.meshes.new(prefix + mname)
        me.from_pydata([bl(p) for p in mb.v], [], mb.f)
        uv = me.uv_layers.new(name="UVMap")
        k = 0
        for poly, uvs in zip(me.polygons, mb.uv):
            for li, t in zip(poly.loop_indices, uvs):
                uv.data[li].uv = t
        me.materials.append(MATS[mname])
        me.validate()
        ob = bpy.data.objects.new(prefix + mname if prefix else "M_" + mname, me)
        col.objects.link(ob)
        objs.append(ob)
    for name, mname, pts in S.slots:
        me = bpy.data.meshes.new(name)
        me.from_pydata([bl(p) for p in pts], [], [(0, 1, 2, 3)])
        uv = me.uv_layers.new(name="UVMap")
        for li, t in zip(me.polygons[0].loop_indices, [(0, 0), (1, 0), (1, 1), (0, 1)]):
            uv.data[li].uv = t
        me.materials.append(MATS[mname])
        ob = bpy.data.objects.new(name, me)
        col.objects.link(ob)
        objs.append(ob)
    return objs


def build_variant(vid, v):
    clear_scene()
    build_materials()
    SEATS.clear()
    fw2, fh2 = floor_half(v["native"])
    st = v["style"]
    S = Scene()
    outs = []
    tops = {}
    if v["kind"] == "gym":
        for ti, t in enumerate(v["tiers"]):
            o = build_bank(S, t, ti, fw2, fh2, st)
            tops[t["side"]] = o["top"]
            outs.append(o)
        gym_dressing(S, v, fw2, fh2, tops)
    else:
        nt = len(v["tiers"])
        st = dict(st, _walls=(v["walls"]["x"], v["walls"]["z"]))
        for ti, t in enumerate(v["tiers"]):
            outs.append(build_bowl(S, t, ti, fw2, fh2, st, st.get("vomitories", 0) if ti == 0 else 0, ti == nt - 1))
        concourses(S, v["tiers"], outs, fw2, fh2)
        back_walls(S, v["tiers"], outs, fw2, fh2)
        suites(S, v, fw2, fh2)
        arena_dressing(S, v, fw2, fh2, outs)
    objs = emit_objects(S)
    # seat models used by this venue
    used = {t["seat"] for t in v["tiers"]}
    for name, sm in seat_models(S).items():
        if name.split("_")[1] in used:
            # each model becomes one object (materials merged as separate primitives)
            parts = emit_objects(sm, prefix=name + "__")
            bpy.ops.object.select_all(action="DESELECT")
            for p in parts:
                p.select_set(True)
            bpy.context.view_layer.objects.active = parts[0]
            bpy.ops.object.join()
            parts[0].name = name
            parts[0].data.name = name
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.context.scene.objects:
        o.select_set(True)
    out = os.path.join(OUTDIR, vid + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
        export_materials="EXPORT", export_image_format="JPEG", export_image_quality=82, export_animations=False,
    )
    seats_out = os.path.join(OUTDIR, vid + ".seats.json")
    with open(seats_out, "w") as fh:
        json.dump({"v": 1, "groups": SEATS}, fh, separators=(",", ":"))
    tris = sum(sum(len(f) - 2 for f in mb.f) for mb in S.groups.values())
    return {"id": vid, "tris": tris, "seats": {k: len(v) // 5 for k, v in SEATS.items()}, "kb": round(os.path.getsize(out) / 1024)}


build_textures()
REPORT = []
for vid, v in SPEC.items():
    if ONLY and vid not in ONLY:
        continue
    REPORT.append(build_variant(vid, v))
print(json.dumps(REPORT))
result = REPORT
