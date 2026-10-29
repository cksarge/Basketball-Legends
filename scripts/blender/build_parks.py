"""
Builds the Play in the Park worlds (src/game/park/parks.ts): everything around the court.

  public/models/parks/<id>.glb         terrain out to the horizon, fences, buildings, trees, bleachers, props
  public/models/parks/<id>.spots.json  where spectators stand, sit and lean on the fence

Run:
  blender -b --factory-startup -P scripts/blender/build_parks.py -- <repo_root> [park ...] [--preview dir]
then compress (npm run assets:parks does both, plus the crowd).

Contract with the engine (src/game3d/park/ParkScene.tsx):
  * Meters, Y-up after export, center court at the origin, +X toward the right basket, +Z toward the
    camera sideline. The court surface and the hoops are drawn by the engine; this file never covers the
    court (|x| < 15.4, |z| < 9.8 stays empty).
  * Camera keep-out (enforced by src/game/__tests__/cameras.test.ts): nothing stands between the near
    sideline and the broadcast cameras (z from 10.5 to 34 for |x| < 34) or right behind the baselines
    (|x| from 16.4 to 24 for |z| < 6), except the see-through fence.
  * "Ground" is the terrain: it reaches GROUND_RADIUS in every direction so no camera ever sees its edge.
  * Material names the engine treats specially: ChainLink (alpha-tested fence), Water (animated ocean),
    Glow_* (emissive at night, lit by the engine's bloom), Win_Night (lit windows).
  * Empties named Light_<n> mark the court lights (the engine puts a light at each, at night).
  * Spots JSON: {"v":1, "stand"|"sit"|"lean": [x, y, z, yaw, ...]} in centimetres and degrees
    (yaw turns +Z toward the court).
"""
import bpy, json, math, os, random, sys
import numpy as np
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = ARGS[0] if ARGS else os.getcwd()
PREVIEW = ARGS[ARGS.index("--preview") + 1] if "--preview" in ARGS else None
ONLY = {a for a in ARGS[1:] if not a.startswith("--") and a != PREVIEW}
OUTDIR = os.path.join(ROOT, "scripts", "blender", "out", "parks")
TEXDIR = os.path.join(ROOT, "scripts", "blender", "out", "park_tex")
os.makedirs(OUTDIR, exist_ok=True)
os.makedirs(TEXDIR, exist_ok=True)

FT = 0.3048
HALF_L, HALF_W = 42 * FT, 25 * FT  # high school court
GROUND_RADIUS = 2600.0


# ------------------------------------------------------------------ textures
def noise(h, w, seed, scale=1.0):
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w))
    for octave in range(5):
        s = 2 ** octave
        g = rng.random((max(2, h // (64 // s or 1) // 1), max(2, w // (64 // s or 1))))
        up = np.kron(g, np.ones((h // g.shape[0] + 1, w // g.shape[1] + 1)))[:h, :w]
        out += up / s
    out = (out - out.min()) / (np.ptp(out) or 1)
    return out * scale


def grain(h, w, seed, amt):
    return np.random.default_rng(seed).random((h, w)) * amt


TEX = {}


def save_tex(name, rgb, alpha=None):
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name, w, h, alpha=alpha is not None)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1)
    if alpha is not None:
        rgba[..., 3] = alpha
    img.pixels.foreach_set(rgba[::-1].ravel())
    img.filepath_raw = os.path.join(TEXDIR, name + ".png")
    img.file_format = "PNG"
    img.save()
    TEX[name] = img
    return img


def tint(base, var):
    return np.stack([np.full_like(var, c) for c in base], -1) * var[..., None]


def build_textures():
    S = 512
    n = noise(S, S, 1)
    g = grain(S, S, 2, 0.18)
    save_tex("sand", tint((0.86, 0.77, 0.58), 0.86 + n * 0.12 + g * 0.5))
    save_tex("desert", tint((0.76, 0.62, 0.45), 0.8 + n * 0.18 + grain(S, S, 3, 0.35)))
    gr = noise(S, S, 4)
    save_tex("grass", tint((0.27, 0.42, 0.18), 0.72 + gr * 0.3 + grain(S, S, 5, 0.3)))
    save_tex("dirtgrass", tint((0.36, 0.42, 0.22), 0.7 + noise(S, S, 6) * 0.35 + grain(S, S, 7, 0.3)))
    save_tex("concrete", tint((0.62, 0.62, 0.6), 0.85 + noise(S, S, 8) * 0.1 + grain(S, S, 9, 0.12)))
    save_tex("asphalt", tint((0.2, 0.2, 0.21), 0.85 + noise(S, S, 10) * 0.12 + grain(S, S, 11, 0.4)))
    # sidewalk slabs
    sw = tint((0.66, 0.65, 0.62), 0.88 + noise(S, S, 12) * 0.08 + grain(S, S, 13, 0.1))
    sw[::128, :] *= 0.6
    sw[:, ::128] *= 0.6
    save_tex("sidewalk", sw)
    # brick: 8 courses per tile, mortar lines
    b = np.zeros((S, S, 3))
    rng = np.random.default_rng(14)
    rows, cols = 16, 8
    rh, cw = S // rows, S // cols
    for r in range(rows):
        off = (cw // 2) * (r % 2)
        for c in range(-1, cols + 1):
            x0 = c * cw + off
            col = np.array((0.55, 0.24, 0.17)) * rng.uniform(0.75, 1.1)
            b[r * rh : (r + 1) * rh, max(0, x0) : max(0, min(S, x0 + cw))] = col
    b[::rh, :] = (0.62, 0.6, 0.55)
    for r in range(rows):
        off = (cw // 2) * (r % 2)
        for c in range(cols + 1):
            x = c * cw + off
            if 0 <= x < S:
                b[r * rh : (r + 1) * rh, x : x + 3] = (0.62, 0.6, 0.55)
    b *= (0.9 + grain(S, S, 15, 0.15))[..., None]
    save_tex("brick", b)
    save_tex("stucco", tint((0.86, 0.8, 0.7), 0.9 + noise(S, S, 16) * 0.08 + grain(S, S, 17, 0.08)))
    w = np.zeros((S, S, 3))
    for r in range(8):
        w[r * 64 : (r + 1) * 64] = np.array((0.52, 0.36, 0.22)) * rng.uniform(0.8, 1.1)
        w[r * 64 : r * 64 + 3] *= 0.5
    w *= (0.9 + noise(S, S, 18) * 0.15)[..., None]
    save_tex("wood", w)
    # chain-link: diamonds on transparent
    C = 128
    yy, xx = np.mgrid[0:C, 0:C]
    d1 = np.abs(((xx + yy) % 64) - 32)
    d2 = np.abs(((xx - yy) % 64) - 32)
    wire = (np.minimum(d1, d2) > 28).astype(np.float32)
    save_tex("chainlink", np.full((C, C, 3), 0.72), alpha=wire)
    # facades: window grids on brick / concrete / glass, day and night
    for name, wall, lit_p in (("facade_brick", "brick", 0.0), ("facade_brick_n", "brick", 0.45), ("facade_conc", "concrete", 0.0), ("facade_conc_n", "concrete", 0.5), ("facade_glass_n", None, 0.55), ("facade_stucco", "stucco", 0.0)):
        base = np.array(TEX[wall].pixels[:]).reshape(S, S, 4)[::-1, :, :3].copy() if wall else np.full((S, S, 3), 0.06)
        # night facades: the lit windows only, for the emission (walls never glow)
        if lit_p:
            base *= 0.55
        glow = np.zeros((S, S, 3))
        rng2 = np.random.default_rng(sum(map(ord, name)))
        for r in range(4):
            for c in range(4):
                y0, x0 = r * 128 + 34, c * 128 + 30
                on = rng2.random() < lit_p
                col = (np.array((1.0, 0.82, 0.52)) if rng2.random() < 0.7 else np.array((0.75, 0.86, 1.0))) * rng2.uniform(0.7, 1.0) if on else np.array((0.12, 0.15, 0.2)) if lit_p else np.array((0.32, 0.4, 0.48))
                base[y0 : y0 + 72, x0 : x0 + 68] = col
                if on:
                    glow[y0 : y0 + 72, x0 : x0 + 68] = col
                if not lit_p:
                    base[y0 : y0 + 30, x0 : x0 + 68] *= 1.25  # sky reflection
                base[y0 + 34 : y0 + 37, x0 : x0 + 68] *= 0.5
                glow[y0 + 34 : y0 + 37, x0 : x0 + 68] *= 0.3
        save_tex(name, base)
        if lit_p:
            save_tex(name + "_emit", glow)
    # awnings
    for i, c1 in enumerate(((0.85, 0.2, 0.2), (0.15, 0.45, 0.75), (0.95, 0.75, 0.2), (0.2, 0.6, 0.35))):
        a = np.zeros((64, 256, 3))
        for k in range(8):
            a[:, k * 32 : (k + 1) * 32] = c1 if k % 2 == 0 else (0.95, 0.93, 0.88)
        save_tex(f"awning{i}", a)
    # mural: big soft color shapes
    m = np.zeros((S, S * 2, 3)) + (0.15, 0.2, 0.35)
    yy, xx = np.mgrid[0:S, 0 : S * 2]
    rng3 = np.random.default_rng(21)
    for _ in range(14):
        cx, cy, r = rng3.uniform(0, S * 2), rng3.uniform(0, S), rng3.uniform(40, 160)
        col = rng3.choice([(0.95, 0.4, 0.2), (0.98, 0.8, 0.2), (0.2, 0.7, 0.8), (0.85, 0.25, 0.55), (0.3, 0.8, 0.4), (0.95, 0.95, 0.95)])
        mask = ((xx - cx) ** 2 + (yy - cy) ** 2) < r * r
        m[mask] = col
    save_tex("mural", m)
    save_tex("roof", tint((0.3, 0.27, 0.25), 0.8 + noise(S, S, 22) * 0.2 + grain(S, S, 23, 0.2)))
    save_tex("rock", tint((0.55, 0.42, 0.36), 0.75 + noise(S, S, 24) * 0.3 + grain(S, S, 25, 0.2)))


# ------------------------------------------------------------------ materials
MATS, TILE = {}, {}


def mat(name, color=(0.8, 0.8, 0.8), rough=0.8, metal=0.0, tex=None, tile=2.0, emit=None, emit_strength=1.0, alpha_tex=False):
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
        if alpha_tex:
            nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
        if emit is not None:
            e = nt.nodes.new("ShaderNodeTexImage")
            e.image = TEX.get(tex + "_emit", TEX[tex])
            nt.links.new(e.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = emit_strength
    if emit is not None and tex is None:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    MATS[name] = m
    TILE[name] = tile
    return m


def build_materials():
    MATS.clear()
    TILE.clear()
    mat("Sand", tex="sand", tile=6, rough=1)
    mat("Desert", tex="desert", tile=8, rough=1)
    mat("Grass", tex="grass", tile=5, rough=1)
    mat("DirtGrass", tex="dirtgrass", tile=10, rough=1)
    mat("Concrete", tex="concrete", tile=4, rough=0.95)
    mat("Asphalt", tex="asphalt", tile=5, rough=0.95)
    mat("Sidewalk", tex="sidewalk", tile=2.4, rough=0.95)
    mat("Brick", tex="brick", tile=1.6)
    mat("Stucco", tex="stucco", tile=3)
    mat("Wood", tex="wood", tile=1.5, rough=0.85)
    mat("Roof", tex="roof", tile=3)
    mat("Rock", tex="rock", tile=4, rough=1)
    mat("Facade_Brick", tex="facade_brick", tile=6.8)
    mat("Facade_Conc", tex="facade_conc", tile=6.8)
    mat("Facade_Stucco", tex="facade_stucco", tile=6.8)
    mat("Win_Night", tex="facade_brick_n", tile=6.8, emit=True, emit_strength=1.0)
    mat("Win_NightConc", tex="facade_conc_n", tile=6.8, emit=True, emit_strength=1.0)
    mat("Win_NightGlass", tex="facade_glass_n", tile=6.8, emit=True, emit_strength=1.4)
    mat("ChainLink", tex="chainlink", tile=0.12, metal=0.7, rough=0.45, alpha_tex=True)
    mat("Steel", (0.58, 0.6, 0.63), 0.45, 0.8)
    mat("Steel_Dark", (0.14, 0.15, 0.17), 0.5, 0.7)
    mat("Aluminum", (0.78, 0.8, 0.82), 0.35, 0.9)
    mat("Paint_Green", (0.12, 0.3, 0.2), 0.6, 0.3)
    mat("Paint_Red", (0.6, 0.12, 0.1), 0.6)
    mat("Paint_White", (0.9, 0.9, 0.88), 0.6)
    mat("Paint_Yellow", (0.92, 0.72, 0.1), 0.5)
    mat("Paint_Blue", (0.12, 0.35, 0.65), 0.5)
    mat("Trunk", (0.33, 0.24, 0.17), 1)
    mat("PalmTrunk", (0.5, 0.42, 0.32), 1)
    mat("Leaf", (0.2, 0.36, 0.14), 0.9)
    mat("Leaf_Dark", (0.13, 0.26, 0.1), 0.9)
    mat("Leaf_Desert", (0.45, 0.55, 0.28), 0.9)
    mat("Frond", (0.24, 0.42, 0.18), 0.9)
    mat("Cactus", (0.27, 0.43, 0.24), 0.85)
    mat("Water", (0.08, 0.3, 0.42), 0.15, 0.1)
    mat("Glass", (0.25, 0.32, 0.4), 0.1, 0.4)
    mat("Tire", (0.04, 0.04, 0.045), 0.9)
    mat("Mountain", (0.56, 0.38, 0.3), 1)
    mat("Mountain_Far", (0.56, 0.48, 0.52), 1)
    mat("Mural", tex="mural", tile=1)
    for i in range(4):
        mat(f"Awning{i}", tex=f"awning{i}", tile=1)
    mat("Glow_Warm", (1, 0.85, 0.6), 0.5, emit=(1.0, 0.82, 0.55), emit_strength=4)
    mat("Glow_White", (1, 1, 1), 0.5, emit=(1.0, 0.97, 0.9), emit_strength=6)
    mat("Glow_Neon", (1, 0.2, 0.4), 0.5, emit=(1.0, 0.18, 0.4), emit_strength=5)
    mat("Glow_Cyan", (0.2, 0.9, 1), 0.5, emit=(0.2, 0.9, 1.0), emit_strength=4)
    mat("Glow_Red", (1, 0.15, 0.1), 0.5, emit=(1.0, 0.12, 0.08), emit_strength=4)
    mat("Glow_City", (1, 0.75, 0.45), 0.5, emit=(1.0, 0.72, 0.42), emit_strength=3)
    for i, c in enumerate(((0.75, 0.12, 0.12), (0.1, 0.25, 0.55), (0.85, 0.85, 0.82), (0.1, 0.1, 0.11), (0.95, 0.75, 0.1), (0.35, 0.36, 0.38), (0.2, 0.45, 0.3))):
        mat(f"CarPaint{i}", c, 0.35, 0.5)
    mat("Fabric", (0.75, 0.3, 0.15), 0.9)
    mat("Fabric_Blue", (0.15, 0.3, 0.6), 0.9)
    mat("Black", (0.03, 0.03, 0.035), 0.6)


# ------------------------------------------------------------------ geometry
def bl(p):
    """three.js (x, y, z) -> Blender (x, -z, y)."""
    return Vector((p[0], -p[2], p[1]))


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


class MB:
    def __init__(self):
        self.v, self.f, self.uv = [], [], []

    def poly(self, pts, uvs=None, tile=2.0):
        i = len(self.v)
        self.v += [tuple(p) for p in pts]
        self.f.append(tuple(range(i, i + len(pts))))
        self.uv.append(uvs if uvs is not None else planar(pts, tile))


def rot_y(x, z, yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    return x * c + z * s, -x * s + z * c


class Scene:
    def __init__(self):
        self.groups = {}
        self.lights = []
        self.spots = {"stand": [], "sit": [], "lean": []}

    def g(self, m):
        return self.groups.setdefault(m, MB())

    def poly(self, m, pts, uvs=None):
        self.g(m).poly(pts, uvs, TILE.get(m, 2.0))

    def box(self, m, c, size, yaw=0.0, skip=()):
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2

        def P(x, y, z):
            X, Z = rot_y(x, z, yaw)
            return (c[0] + X, c[1] + y, c[2] + Z)

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
                self.poly(m, pts)

    def tube(self, m, a, b, r0, r1=None, n=8):
        """Tapered cylinder from point a to point b."""
        r1 = r0 if r1 is None else r1
        a, b = Vector(a), Vector(b)
        d = (b - a).normalized()
        up = Vector((0, 1, 0)) if abs(d.y) < 0.95 else Vector((1, 0, 0))
        u = d.cross(up).normalized()
        w = d.cross(u).normalized()
        ra = [a + (u * math.cos(2 * math.pi * i / n) + w * math.sin(2 * math.pi * i / n)) * r0 for i in range(n)]
        rb = [b + (u * math.cos(2 * math.pi * i / n) + w * math.sin(2 * math.pi * i / n)) * r1 for i in range(n)]
        L = (b - a).length
        for i in range(n):
            j = (i + 1) % n
            self.poly(m, [ra[i], ra[j], rb[j], rb[i]], [(i / n, 0), ((i + 1) / n, 0), ((i + 1) / n, L / 2), (i / n, L / 2)])
        self.poly(m, list(reversed(ra)))
        self.poly(m, rb)

    def blob(self, m, c, r, sy=1.0, detail=1, seed=0, jitter=0.18):
        """Lumpy icosphere (foliage, rocks)."""
        rng = random.Random(seed)
        t = (1 + 5 ** 0.5) / 2
        verts = [Vector(v).normalized() for v in ((-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1))]
        faces = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
        for _ in range(detail):
            cache, nf = {}, []

            def mid(a, b):
                k = (min(a, b), max(a, b))
                if k not in cache:
                    verts.append((verts[a] + verts[b]).normalized())
                    cache[k] = len(verts) - 1
                return cache[k]

            for a, b, cc in faces:
                ab, bc, ca = mid(a, b), mid(b, cc), mid(cc, a)
                nf += [(a, ab, ca), (b, bc, ab), (cc, ca, bc), (ab, bc, ca)]
            faces = nf
        scale = [1 + rng.uniform(-jitter, jitter) for _ in verts]
        P = [Vector((c[0] + v.x * r * s, c[1] + v.y * r * sy * s, c[2] + v.z * r * s)) for v, s in zip(verts, scale)]
        for a, b, cc in faces:
            self.poly(m, [P[a], P[b], P[cc]])

    def stand(self, kind, x, z, y=0.0, face=None):
        """A spectator spot facing `face` (default: the court center)."""
        fx, fz = face if face else (x * 0.3, 0.0)
        yaw = math.degrees(math.atan2(fx - x, fz - z))
        self.spots[kind] += [round(x * 100), round(y * 100), round(z * 100), round(yaw)]


# ------------------------------------------------------------------ building blocks
def terrain(S, m, radius, flat, height_fn, rings=48, segs=96, y0=-0.03):
    """Polar terrain disc: flat near the court, shaped by height_fn(x, z, d) farther out, to `radius`."""
    radii = [0.0] + [flat * (i / 6) for i in range(1, 7)] + [flat * (radius / flat) ** (i / rings) for i in range(1, rings + 1)]
    pts = []
    for r in radii:
        row = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            x, z = math.cos(a) * r, math.sin(a) * r
            h = 0.0 if r <= flat else height_fn(x, z, r)
            row.append((x, y0 + h, z))
        pts.append(row)
    # the near ground and the far ground are separate meshes: compression quantizes each mesh to its own
    # size, and one 5 km mesh would only keep ~8 cm of height precision next to the court
    if m + "_Far" not in MATS:
        src = MATS[m]
        far = src.copy()
        far.name = m + "_Far"
        MATS[far.name] = far
        TILE[far.name] = TILE[m]
    for i in range(len(radii) - 1):
        mm = m if radii[i + 1] <= 150 else m + "_Far"
        for k in range(segs):
            j = (k + 1) % segs
            if i == 0:
                S.poly(mm, [pts[0][0], pts[1][j], pts[1][k]])
            else:
                S.poly(mm, [pts[i][k], pts[i][j], pts[i + 1][j], pts[i + 1][k]])


def fence(S, park, hx, hz, height, near_open=True, near_low=False):
    """Chain-link fence on posts around the court (the near side open so the cameras see in)."""
    sides = [((-hx, -hz), (hx, -hz)), ((-hx, -hz), (-hx, hz)), ((hx, -hz), (hx, hz))]
    for (x0, z0), (x1, z1) in sides:
        S.poly("ChainLink", [(x0, 0.03, z0), (x1, 0.03, z1), (x1, height, z1), (x0, height, z0)])
        L = math.hypot(x1 - x0, z1 - z0)
        n = max(1, round(L / 3))
        for i in range(n + 1):
            t = i / n
            S.tube("Steel", (x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t), (x0 + (x1 - x0) * t, height + 0.05, z0 + (z1 - z0) * t), 0.045, n=8)
        S.tube("Steel", (x0, height, z0), (x1, height, z1), 0.032, n=6)
        S.tube("Steel", (x0, 0.12, z0), (x1, 0.12, z1), 0.022, n=6)
    if not near_open:
        S.poly("ChainLink", [(-hx, 0.03, hz), (hx, 0.03, hz), (hx, height, hz), (-hx, height, hz)])


def light_poles(S, hx, hz, h=9.0, lamp="Glow_White"):
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = sx * (hx - 0.3), sz * (hz + (1.6 if sz > 0 else -0.3))
            S.tube("Steel_Dark", (x, 0, z), (x, h, z), 0.13, 0.09)
            ix, iz = -sx * 0.7, -sz * 0.7
            S.tube("Steel_Dark", (x, h - 0.1, z), (x + ix, h + 0.05, z + iz), 0.05)
            S.box("Steel_Dark", (x + ix * 1.25, h + 0.1, z + iz * 1.25), (0.7, 0.28, 0.5), yaw=math.atan2(ix, iz))
            S.box(lamp, (x + ix * 1.25, h - 0.05, z + iz * 1.25), (0.62, 0.04, 0.42), yaw=math.atan2(ix, iz))
            S.lights.append((x + ix * 1.25, h - 0.3, z + iz * 1.25))


def bench(S, x, z, yaw=0.0, sitters=0, rng=None):
    S.box("Wood", (x, 0.45, z), (2.0, 0.06, 0.42), yaw)
    bx, bz = rot_y(0, -0.2, yaw)
    S.box("Wood", (x + bx, 0.75, z + bz), (2.0, 0.3, 0.05), yaw)
    for dx in (-0.85, 0.85):
        lx, lz = rot_y(dx, 0, yaw)
        S.box("Steel_Dark", (x + lx, 0.22, z + lz), (0.06, 0.44, 0.42), yaw)
    for k in range(sitters):
        ox, oz = rot_y(-0.6 + k * 0.6, 0.02, yaw)
        fx, fz = rot_y(0, 3, yaw)
        S.stand("sit", x + ox, z + oz, 0.47, face=(x + ox + fx, z + oz + fz))


def bleachers(S, x, z, length, rows, yaw, fill, rng, rise=0.42, depth=0.75, mat_seat="Aluminum"):
    """Aluminum bleachers centred at (x, z), front row facing direction yaw (rotation of +Z)."""
    for r in range(rows):
        y = 0.45 + r * rise
        dz = r * depth
        cx, cz = rot_y(0, -dz, yaw)
        S.box(mat_seat, (x + cx, y, z + cz), (length, 0.06, 0.3), yaw)  # seat plank
        fx, fz = rot_y(0, -dz + 0.35, yaw)
        S.box(mat_seat, (x + fx, y - 0.22, z + fz), (length, 0.04, 0.32), yaw)  # foot plank
        for k in range(int(length / 0.55)):
            if rng.random() < fill:
                ox, oz = rot_y(-length / 2 + 0.3 + k * 0.55, -dz, yaw)
                f2x, f2z = rot_y(0, 4, yaw)
                S.stand("sit", x + cx + ox - cx + ox * 0, z + oz, y + 0.03, face=(x + ox + f2x, z + oz + f2z)) if False else S.stand("sit", x + ox, z + oz, y + 0.03, face=(x + ox + f2x, z + oz + f2z))
    # frame
    for k in range(int(length / 2.4) + 1):
        ox = -length / 2 + k * (length / max(1, int(length / 2.4)))
        a = rot_y(ox, 0.2, yaw)
        b = rot_y(ox, -(rows - 1) * depth - 0.2, yaw)
        S.tube("Steel", (x + a[0], 0, z + a[1]), (x + b[0], 0.45 + (rows - 1) * rise, z + b[1]), 0.04, n=6)
        S.tube("Steel", (x + b[0], 0, z + b[1]), (x + b[0], 0.45 + (rows - 1) * rise + 0.9, z + b[1]), 0.035, n=6)
    a = rot_y(-length / 2, -(rows - 1) * depth - 0.2, yaw)
    b = rot_y(length / 2, -(rows - 1) * depth - 0.2, yaw)
    S.tube("Steel", (x + a[0], 0.45 + (rows - 1) * rise + 0.9, z + a[1]), (x + b[0], 0.45 + (rows - 1) * rise + 0.9, z + b[1]), 0.03, n=6)


def tree(S, x, z, h, seed, leaf="Leaf", trunk="Trunk", spread=1.0):
    rng = random.Random(seed)
    S.tube(trunk, (x, 0, z), (x + rng.uniform(-0.3, 0.3), h * 0.55, z + rng.uniform(-0.3, 0.3)), 0.22 * h / 8, 0.14 * h / 8, n=7)
    for k in range(5):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0.6, 1.8) * spread * h / 8
        S.blob(leaf, (x + math.cos(a) * r, h * rng.uniform(0.62, 0.9), z + math.sin(a) * r), rng.uniform(1.4, 2.2) * spread * h / 8, sy=0.8, seed=seed * 10 + k)


def palm(S, x, z, h, seed):
    rng = random.Random(seed)
    lean = (rng.uniform(-1, 1) * 0.08 * h, rng.uniform(-1, 1) * 0.08 * h)
    prev = (x, 0, z)
    for k in range(1, 9):
        t = k / 8
        p = (x + lean[0] * t * t, h * t, z + lean[1] * t * t)
        S.tube("PalmTrunk", prev, p, 0.24 - 0.08 * t + 0.02, 0.24 - 0.08 * t, n=7)
        prev = p
    top = Vector(prev)
    for k in range(11):
        a = 2 * math.pi * k / 11 + rng.uniform(-0.2, 0.2)
        dirv = Vector((math.cos(a), 0, math.sin(a)))
        pts = []
        for s in range(7):
            t = s / 6
            pts.append(top + dirv * (3.6 * t) + Vector((0, 0.6 * t - 2.2 * t * t, 0)))
        side = Vector((-dirv.z, 0, dirv.x))
        for s in range(6):
            w0 = 0.5 * math.sin(math.pi * s / 6) + 0.05
            w1 = 0.5 * math.sin(math.pi * (s + 1) / 6) + 0.05
            S.poly("Frond", [pts[s] - side * w0, pts[s + 1] - side * w1, pts[s + 1] + side * w1, pts[s] + side * w0])
    S.blob("PalmTrunk", tuple(top), 0.35, seed=seed)


def saguaro(S, x, z, h, seed):
    rng = random.Random(seed)
    S.tube("Cactus", (x, 0, z), (x, h, z), 0.32, 0.3, n=10)
    S.blob("Cactus", (x, h, z), 0.3, sy=0.8, seed=seed, jitter=0.02)
    for side in (-1, 1):
        if rng.random() < 0.75:
            y = rng.uniform(0.35, 0.6) * h
            ax = x + side * 0.85
            S.tube("Cactus", (x, y, z), (ax, y + 0.1, z), 0.2, n=8)
            top = y + rng.uniform(1.0, 1.8)
            S.tube("Cactus", (ax, y, z), (ax, top, z), 0.2, n=8)
            S.blob("Cactus", (ax, top, z), 0.2, sy=0.8, seed=seed + side, jitter=0.02)


def car(S, x, z, yaw, paint):
    S.box(paint, (x, 0.62, z), (4.3, 0.62, 1.8), yaw)
    cx, cz = rot_y(-0.25, 0, yaw)
    S.box(paint, (x + cx, 1.15, z + cz), (2.3, 0.5, 1.6), yaw)
    S.box("Glass", (x + cx, 1.16, z + cz), (2.32, 0.4, 1.62), yaw, skip=("top", "bottom"))
    for wx in (-1.35, 1.35):
        for wz in (-0.82, 0.82):
            px, pz = rot_y(wx, wz, yaw)
            a = rot_y(0, -0.13, yaw)
            b = rot_y(0, 0.13, yaw)
            S.tube("Tire", (x + px + a[0], 0.36, z + pz + a[1]), (x + px + b[0], 0.36, z + pz + b[1]), 0.36, n=10)
    hx, hz = rot_y(2.16, 0.6, yaw)
    S.box("Glow_White", (x + hx, 0.7, z + hz), (0.05, 0.12, 0.3), yaw)
    hx, hz = rot_y(2.16, -0.6, yaw)
    S.box("Glow_White", (x + hx, 0.7, z + hz), (0.05, 0.12, 0.3), yaw)


def building(S, x, z, w, d, h, facade, yaw=0.0, roof="Roof", water_tower=False, rng=None):
    S.box(facade, (x, h / 2, z), (w, h, d), yaw, skip=("bottom", "top"))
    S.box(roof, (x, h + 0.02, z), (w, 0.04, d), yaw)
    S.box("Concrete", (x, h + 0.45, z), (w + 0.2, 0.9, d + 0.2), yaw, skip=("bottom",)) if False else None
    # parapet
    for side in (-1, 1):
        px, pz = rot_y(0, side * d / 2, yaw)
        S.box("Brick" if "Brick" in facade or "Night" in facade else "Concrete", (x + px, h + 0.4, z + pz), (w, 0.8, 0.3), yaw)
        px, pz = rot_y(side * w / 2, 0, yaw)
        S.box("Brick" if "Brick" in facade or "Night" in facade else "Concrete", (x + px, h + 0.4, z + pz), (0.3, 0.8, d), yaw)
    if water_tower:
        rx, rz = rot_y(w * 0.2, d * 0.1, yaw)
        for lx in (-0.9, 0.9):
            for lz in (-0.9, 0.9):
                S.tube("Steel_Dark", (x + rx + lx, h, z + rz + lz), (x + rx + lx * 0.8, h + 3, z + rz + lz * 0.8), 0.08, n=6)
        S.tube("Wood", (x + rx, h + 3, z + rz), (x + rx, h + 6.2, z + rz), 1.5, 1.5, n=14)
        S.tube("Roof", (x + rx, h + 6.2, z + rz), (x + rx, h + 7.4, z + rz), 1.55, 0.1, n=14)
    if rng:
        for _ in range(rng.randint(0, 3)):
            ax, az = rot_y(rng.uniform(-w / 3, w / 3), rng.uniform(-d / 3, d / 3), yaw)
            S.box("Steel", (x + ax, h + 0.6, z + az), (rng.uniform(1.2, 2.4), 1.2, rng.uniform(1.2, 2)), yaw)


def string_lights(S, a, b, sag, n=14):
    a, b = Vector(a), Vector(b)
    prev = None
    for i in range(n + 1):
        t = i / n
        p = a.lerp(b, t) - Vector((0, sag * 4 * t * (1 - t), 0))
        if prev is not None:
            S.tube("Black", prev, p, 0.008, n=4)
        if 0 < i < n:
            S.box("Glow_Warm", (p.x, p.y - 0.08, p.z), (0.09, 0.12, 0.09))
        prev = p


def mountains(S, rng, r0, r1, count, hmin, hmax, m, skip=lambda a: False, detail=1):
    for i in range(count):
        a = 2 * math.pi * i / count + rng.uniform(-0.05, 0.05)
        if skip(a):
            continue
        r = rng.uniform(r0, r1)
        x, z = math.cos(a) * r, math.sin(a) * r
        h = rng.uniform(hmin, hmax)
        w = rng.uniform(1.2, 2.4) * h
        # a ridge: a few overlapping peaks
        for k in range(3):
            ox, oz = rot_y(rng.uniform(-w, w) * 0.6, 0, -a + math.pi / 2)
            S.blob(m, (x + ox, -h * 0.25, z + oz), w * rng.uniform(0.7, 1.0), sy=(h / w) * rng.uniform(0.9, 1.3), detail=detail, seed=rng.randint(0, 9999), jitter=0.16)


def skyline(S, rng, r0, r1, count, hmin, hmax, facade, skip=lambda a: False, y0=0.0):
    for i in range(count):
        a = rng.uniform(0, 2 * math.pi)
        if skip(a):
            continue
        r = rng.uniform(r0, r1)
        x, z = math.cos(a) * r, math.sin(a) * r
        w, d = rng.uniform(14, 34), rng.uniform(14, 34)
        h = rng.uniform(hmin, hmax) * (1.6 if rng.random() < 0.12 else 1)
        S.box(facade, (x, y0 + h / 2, z), (w, h, d), rng.uniform(0, math.pi), skip=("bottom",))
        if rng.random() < 0.25:
            S.box("Glow_Red", (x, y0 + h + 1.5, z), (0.6, 0.6, 0.6))


# ------------------------------------------------------------------ parks
FENCE = {"cage": (15.4, 10.0, 5.2), "rooftop": (16.2, 10.8, 3.2)}


def fence_box(setting):
    return FENCE.get(setting, (16.2, 10.8, 3.6))


def crowd_along(S, kind, x0, x1, z, rows, rng, fill, depth=0.75, facing=None, y=0.0):
    for r in range(rows):
        x = x0
        while x < x1:
            if rng.random() < fill:
                zz = z - r * depth * (1 if z < 0 else -1)
                S.stand(kind if r == 0 else "stand", x + rng.uniform(-0.12, 0.12), zz + rng.uniform(-0.1, 0.1), y, face=facing)
            x += rng.uniform(0.55, 0.8)


def crowd_end(S, sx, hx, hz, rng, fill):
    """Spectators leaning on an end fence, in the far corner only (the baseline cameras need the middle)."""
    z = -hz + 0.5
    while z < -7.2:
        if rng.random() < fill:
            S.stand("lean", sx * (hx + 0.45), z + rng.uniform(-0.1, 0.1), face=(0, z))
        z += rng.uniform(0.6, 0.8)
    # more of them standing back, out past where any camera goes
    for k in range(int(10 * fill)):
        zz = rng.uniform(-hz - 1, 6)
        S.stand("stand", sx * rng.uniform(hx + 8.5, hx + 11), zz, face=(0, zz))


def build_copper(S, rng):
    hx, hz, fh = fence_box("desert")
    terrain(S, "Desert", GROUND_RADIUS, 40, lambda x, z, d: min(30.0, (d - 40) * 0.02) * (0.5 + 0.5 * math.sin(x * 0.01) * math.cos(z * 0.013)))
    # concrete pad and a grass park behind the far side
    S.poly("Concrete", [(-hx - 2, 0.0, -hz - 2), (hx + 2, 0.0, -hz - 2), (hx + 2, 0.0, hz + 1.2), (-hx - 2, 0.0, hz + 1.2)])
    S.poly("Grass", [(-60, 0.01, -hz - 2), (60, 0.01, -hz - 2), (60, 0.01, -48), (-60, 0.01, -48)])
    S.poly("Sidewalk", [(-80, 0.015, -hz - 4.2), (80, 0.015, -hz - 4.2), (80, 0.015, -hz - 6.2), (-80, 0.015, -hz - 6.2)])
    fence(S, None, hx, hz, fh)
    light_poles(S, hx, hz)
    # bleachers along the far sideline, outside the fence
    bleachers(S, -4, -hz - 1.4, 9, 4, 0, 0.55, rng)
    bleachers(S, 7, -hz - 1.4, 6, 4, 0, 0.4, rng)
    crowd_along(S, "lean", -hx + 1, -9, -hz - 0.45, 1, rng, 0.35)
    # shade ramada with picnic tables and families
    rx, rz = -27, -16
    for px in (-4, 4):
        for pz in (-2.5, 2.5):
            S.box("Paint_Green", (rx + px, 1.6, rz + pz), (0.25, 3.2, 0.25))
    S.poly("Roof", [(rx - 5, 3.4, rz - 3.4), (rx + 5, 3.4, rz - 3.4), (rx + 5, 3.9, rz), (rx - 5, 3.9, rz)])
    S.poly("Roof", [(rx - 5, 3.9, rz), (rx + 5, 3.9, rz), (rx + 5, 3.4, rz + 3.4), (rx - 5, 3.4, rz + 3.4)])
    for tx in (-2.2, 2.2):
        S.box("Wood", (rx + tx, 0.75, rz), (1.8, 0.06, 0.8))
        for sz in (-0.65, 0.65):
            S.box("Wood", (rx + tx, 0.45, rz + sz), (1.8, 0.05, 0.3))
            for k in range(2):
                if rng.random() < 0.7:
                    S.stand("sit", rx + tx - 0.45 + k * 0.9, rz + sz, 0.47, face=(rx + tx - 0.45 + k * 0.9, rz))
    # a second court behind it (surface and poles)
    S.poly("Paint_Green", [(-14, 0.02, -34), (14, 0.02, -34), (14, 0.02, -48), (-14, 0.02, -48)])
    for sx in (-1, 1):
        S.tube("Steel_Dark", (sx * 13, 0, -41), (sx * 13, 3.4, -41), 0.1)
        S.box("Paint_White", (sx * 12.2, 3.3, -41), (0.05, 1.05, 1.8))
    for k in range(6):
        S.stand("stand", rng.uniform(-11, 11), rng.uniform(-46, -36), face=(rng.uniform(-8, 8), -41))
    # playground
    S.poly("Sand", [(28, 0.02, -18), (40, 0.02, -18), (40, 0.02, -30), (28, 0.02, -30)])
    S.box("Paint_Red", (32, 1.6, -24), (3, 0.15, 3))
    for px in (-1.4, 1.4):
        for pz in (-1.4, 1.4):
            S.tube("Paint_Yellow", (32 + px, 0, -24 + pz), (32 + px, 2.6, -24 + pz), 0.07)
    S.poly("Paint_Blue", [(33.5, 1.6, -23), (37, 0.1, -23), (37, 0.1, -25), (33.5, 1.6, -25)])
    S.tube("Paint_Yellow", (35, 0, -28), (36.5, 2.4, -28), 0.06)
    S.tube("Paint_Yellow", (38, 0, -28), (36.5, 2.4, -28), 0.06)
    S.tube("Paint_Yellow", (36.5, 2.4, -28), (36.5, 2.4, -29.5), 0.05)
    for k in range(5):
        S.stand("stand", rng.uniform(29, 39), rng.uniform(-29, -19), face=(32, -24))
    # parking lot with cars off the left end
    S.poly("Asphalt", [(-60, 0.01, -2), (-34, 0.01, -2), (-34, 0.01, 30), (-60, 0.01, 30)])
    for k in range(7):
        car(S, -40 - (k % 2) * 13, 2 + (k // 2) * 6, math.pi / 2, f"CarPaint{rng.randint(0, 6)}")
    # desert plants and boulders all around
    for k in range(70):
        a, r = rng.uniform(0, 2 * math.pi), rng.uniform(26, 160)
        x, z = math.cos(a) * r * 1.3, math.sin(a) * r
        if z > 8 and abs(x) < 36 and z < 40:
            continue
        roll = rng.random()
        if roll < 0.4:
            saguaro(S, x, z, rng.uniform(3, 6.5), k)
        elif roll < 0.7:
            tree(S, x, z, rng.uniform(4, 6), k, leaf="Leaf_Desert", spread=1.3)
        else:
            S.blob("Rock", (x, 0, z), rng.uniform(0.5, 1.8), sy=0.6, seed=k)
    for k in range(10):
        x = rng.uniform(-55, 55)
        tree(S, x, rng.uniform(-24, -46), rng.uniform(5, 7.5), 300 + k, leaf="Leaf_Desert", spread=1.3)
    # desert ranges low on the horizon: a nearer rust-colored range and a hazier one behind it
    mountains(S, rng, 1000, 1600, 30, 45, 120, "Mountain", detail=2)
    mountains(S, rng, 1800, 2300, 26, 110, 220, "Mountain_Far")


def build_cage(S, rng):
    hx, hz, fh = fence_box("cage")
    terrain(S, "Asphalt", GROUND_RADIUS, 60, lambda x, z, d: 0.0)
    S.poly("Sidewalk", [(-hx - 4, 0.0, -hz - 7), (hx + 4, 0.0, -hz - 7), (hx + 4, 0.0, hz + 1.5), (-hx - 4, 0.0, hz + 1.5)])
    fence(S, None, hx, hz, fh)
    light_poles(S, hx, hz, 8.5, lamp="Glow_Warm")
    # the crowd pressed against the fence: three deep along the far side, two deep at the corners
    crowd_along(S, "lean", -hx + 0.6, hx - 0.6, -hz - 0.45, 3, rng, 0.9)
    for sx in (-1, 1):
        crowd_end(S, sx, hx, hz, rng, 0.9)
    # bleachers on the sidewalk behind the far crowd
    bleachers(S, 0, -hz - 3.6, 20, 3, 0, 0.75, rng)
    # brick walk-ups around the block, with stoops and fire escapes
    for k in range(9):
        x = -40 + k * 10
        building(S, x, -32, 10, 12, rng.uniform(15, 24), "Facade_Brick", water_tower=rng.random() < 0.35, rng=rng)
        S.box("Steel_Dark", (x, 6, -25.9), (4, 0.05, 1.0))
        S.box("Steel_Dark", (x, 9.2, -25.9), (4, 0.05, 1.0))
        S.box("Steel_Dark", (x, 12.4, -25.9), (4, 0.05, 1.0))
        S.box("Concrete", (x + 3, 0.6, -25.3), (1.6, 1.2, 1.2))
        if rng.random() < 0.6:
            S.stand("sit", x + 3, -24.8, 1.2, face=(x + 3, 0))
    for sx in (-1, 1):
        for k in range(5):
            building(S, sx * 40, -18 + k * 12, 12, 10, rng.uniform(14, 22), "Facade_Brick", water_tower=rng.random() < 0.3, rng=rng)
    # the mural wall behind the right end
    S.poly("Mural", [(26, 0, -14), (26, 0, 8), (26, 7, 8), (26, 7, -14)], [(0, 0), (1, 0), (1, 1), (0, 1)])
    # elevated train behind the left end
    for z in range(-60, 61, 12):
        S.box("Steel_Dark", (-30, 3.5, z), (0.6, 7, 0.6))
        S.box("Steel_Dark", (-34, 3.5, z), (0.6, 7, 0.6))
    S.box("Steel_Dark", (-32, 7.4, 0), (5.5, 0.8, 130))
    S.box("Aluminum", (-32, 9.3, -8), (3.0, 3.0, 22))
    S.box("Glow_Warm", (-30.48, 9.6, -8), (0.04, 0.8, 20))
    # street with parked cabs and cars
    S.poly("Asphalt", [(-80, 0.005, -hz - 7), (80, 0.005, -hz - 7), (80, 0.005, -hz - 15), (-80, 0.005, -hz - 15)])
    for k in range(8):
        car(S, -36 + k * 9, -hz - 8.4, 0, "CarPaint4" if k % 2 == 0 else f"CarPaint{rng.randint(0, 6)}")
    for k in range(6):
        tree(S, -30 + k * 12, -hz - 5.5, 7, 400 + k, spread=0.8)
    skyline(S, rng, 300, 1400, 120, 40, 160, "Facade_Conc")
    mountains(S, rng, 1800, 2400, 20, 80, 160, "Mountain_Far")


def build_boardwalk(S, rng):
    hx, hz, fh = fence_box("beach")
    terrain(S, "Sand", GROUND_RADIUS, 40, lambda x, z, d: 0.0 if z < -30 else min(25.0, (d - 40) * 0.015))
    S.poly("Concrete", [(-hx - 3, 0.0, -hz - 3), (hx + 3, 0.0, -hz - 3), (hx + 3, 0.0, hz + 1.2), (-hx - 3, 0.0, hz + 1.2)])
    fence(S, None, hx, hz, 3.0)
    light_poles(S, hx, hz)
    # showtime: packed bleachers on the far side and both ends, plus a standing crowd at the fence
    bleachers(S, 0, -hz - 1.8, 26, 6, 0, 0.92, rng)
    for sx in (-1, 1):
        bleachers(S, sx * (hx + 9.5), 0, 14, 5, -sx * math.pi / 2, 0.85, rng)
        crowd_end(S, sx, hx, hz, rng, 0.9)
    crowd_along(S, "lean", -hx + 0.6, hx - 0.6, -hz - 0.45, 1, rng, 0.85)
    # boardwalk behind the bleachers, lined with stalls under striped awnings
    S.poly("Wood", [(-120, 0.08, -hz - 8), (120, 0.08, -hz - 8), (120, 0.08, -hz - 14), (-120, 0.08, -hz - 14)])
    for k in range(10):
        x = -50 + k * 11
        S.box("Stucco", (x, 1.6, -hz - 17), (7, 3.2, 4))
        S.poly(f"Awning{k % 4}", [(x - 3.6, 2.9, -hz - 15), (x + 3.6, 2.9, -hz - 15), (x + 3.6, 2.4, -hz - 13.6), (x - 3.6, 2.4, -hz - 13.6)], [(0, 0), (1, 0), (1, 1), (0, 1)])
        S.box("Glow_Warm", (x, 2.2, -hz - 14.95), (5, 0.08, 0.05))
        for j in range(rng.randint(1, 4)):
            S.stand("stand", x + rng.uniform(-3, 3), -hz - rng.uniform(9, 13), face=(x, -hz - 16) if rng.random() < 0.5 else None)
    # palms lining the boardwalk, string lights between them
    palms = [(-60 + k * 8, -hz - 7.2) for k in range(16)]
    for k, (x, z) in enumerate(palms):
        palm(S, x, z, rng.uniform(9, 13), 500 + k)
    for k in range(len(palms) - 1):
        string_lights(S, (palms[k][0], 5.2, palms[k][1]), (palms[k + 1][0], 5.2, palms[k + 1][1]), 0.6, n=10)
    for k in range(12):
        palm(S, rng.choice([-1, 1]) * rng.uniform(30, 70), rng.uniform(-10, 30), rng.uniform(8, 13), 600 + k)
    # DJ booth and speaker stacks by the far corner
    S.box("Black", (hx - 1, 0.55, -hz - 0.9), (2.2, 1.1, 0.9))
    S.box("Glow_Cyan", (hx - 1, 1.12, -hz - 0.9), (2.0, 0.03, 0.6))
    for sx in (-1.6, 1.6):
        S.box("Black", (hx - 1 + sx, 0.9, -hz - 1.1), (0.7, 1.8, 0.6))
    S.stand("stand", hx - 1, -hz - 1.6, face=(hx - 1, 0))
    # lifeguard tower and the beach down to the water
    tx, tz = 24, -42
    for lx in (-0.9, 0.9):
        for lz in (-0.9, 0.9):
            S.tube("Paint_White", (tx + lx, 0, tz + lz), (tx + lx * 0.8, 2.8, tz + lz * 0.8), 0.08)
    S.box("Paint_Blue", (tx, 3.7, tz), (2.6, 1.8, 2.4))
    S.box("Paint_Red", (tx, 4.75, tz), (3.0, 0.18, 2.8))
    for k in range(18):
        S.stand("sit" if rng.random() < 0.5 else "stand", rng.uniform(-60, 60), rng.uniform(-40, -60), face=(rng.uniform(-60, 60), -200))
    # ocean out to the horizon (animated by the engine)
    S.poly("Water", [(-GROUND_RADIUS, 0.12, -70), (GROUND_RADIUS, 0.12, -70), (GROUND_RADIUS, 0.12, -GROUND_RADIUS), (-GROUND_RADIUS, 0.12, -GROUND_RADIUS)])
    # pier with a Ferris wheel up the coast
    S.box("Wood", (-160, 3, -140), (12, 0.6, 160))
    for z in range(-210, -60, 14):
        S.tube("Wood", (-165, -2, z), (-165, 3, z), 0.3)
        S.tube("Wood", (-155, -2, z), (-155, 3, z), 0.3)
    wx, wy, wz, wr = -160, 22, -190, 18
    for k in range(32):
        a0, a1 = 2 * math.pi * k / 32, 2 * math.pi * (k + 1) / 32
        S.tube("Steel", (wx, wy + math.cos(a0) * wr, wz + math.sin(a0) * wr), (wx, wy + math.cos(a1) * wr, wz + math.sin(a1) * wr), 0.25, n=6)
        if k % 2 == 0:
            S.tube("Steel", (wx, wy, wz), (wx, wy + math.cos(a0) * wr, wz + math.sin(a0) * wr), 0.1, n=5)
            S.box("Glow_Neon" if k % 4 == 0 else "Glow_Cyan", (wx, wy + math.cos(a0) * wr, wz + math.sin(a0) * wr), (1.2, 1.2, 1.2))
    S.tube("Steel", (wx, 3, wz - 8), (wx, wy, wz), 0.4)
    S.tube("Steel", (wx, 3, wz + 8), (wx, wy, wz), 0.4)
    # the city and hills inland (behind the cameras)
    skyline(S, rng, 260, 900, 70, 12, 50, "Facade_Stucco", skip=lambda a: math.sin(a) < 0.25)
    mountains(S, rng, 1400, 2250, 30, 110, 260, "Mountain_Far", skip=lambda a: math.sin(a) < 0.1)


def build_maple(S, rng):
    hx, hz, fh = fence_box("neighborhood")
    terrain(S, "Grass", GROUND_RADIUS, 50, lambda x, z, d: min(12.0, max(0.0, d - 400) * 0.01))
    S.poly("Concrete", [(-hx - 2, 0.0, -hz - 2), (hx + 2, 0.0, -hz - 2), (hx + 2, 0.0, hz + 1.2), (-hx - 2, 0.0, hz + 1.2)])
    fence(S, None, hx, hz, fh)
    light_poles(S, hx, hz, 9.0)
    bleachers(S, -6, -hz - 1.4, 8, 3, 0, 0.6, rng)
    crowd_along(S, "lean", 2, hx - 1, -hz - 0.45, 1, rng, 0.45)
    for k, x in enumerate((-22, 22)):
        bench(S, x, -hz - 2.6, 0, sitters=3 if k == 0 else 2)
    # bikes leaning on the fence
    for k in range(4):
        x = hx - 3 - k * 1.2
        S.tube("Black", (x, 0.35, -hz - 0.3), (x + 0.9, 0.35, -hz - 0.3), 0.33, n=12)
        S.tube("Paint_Red", (x + 0.1, 0.4, -hz - 0.3), (x + 0.8, 0.7, -hz - 0.3), 0.03)
    # street, sidewalks, parked cars and street lamps
    S.poly("Sidewalk", [(-120, 0.01, -hz - 5), (120, 0.01, -hz - 5), (120, 0.01, -hz - 7), (-120, 0.01, -hz - 7)])
    S.poly("Asphalt", [(-120, 0.005, -hz - 7), (120, 0.005, -hz - 7), (120, 0.005, -hz - 15), (-120, 0.005, -hz - 15)])
    S.poly("Sidewalk", [(-120, 0.01, -hz - 15), (120, 0.01, -hz - 15), (120, 0.01, -hz - 17), (-120, 0.01, -hz - 17)])
    for k in range(9):
        car(S, -48 + k * 11 + rng.uniform(-1.5, 1.5), -hz - 8.3, 0 if k % 3 else math.pi, f"CarPaint{rng.randint(0, 6)}")
    for k in range(7):
        x = -45 + k * 15
        S.tube("Steel_Dark", (x, 0, -hz - 6.2), (x, 6.5, -hz - 6.2), 0.09)
        S.tube("Steel_Dark", (x, 6.5, -hz - 6.2), (x, 6.6, -hz - 7.6), 0.05)
        S.box("Glow_Warm", (x, 6.4, -hz - 7.6), (0.4, 0.15, 0.6))
    # two-flats and bungalows with porches and lit windows across the street
    for k in range(10):
        x = -54 + k * 12
        h = rng.choice((6.5, 9.5))
        building(S, x, -hz - 24, 9.5, 12, h, "Win_Night" if k % 2 else "Win_NightConc", rng=None)
        S.box("Wood", (x, 0.5, -hz - 17.8), (6, 0.25, 2.2))
        S.box("Glow_Warm", (x - 2.2, 2.4, -hz - 17.95), (0.2, 0.25, 0.1))
        for j in range(rng.randint(0, 3)):
            S.stand("sit" if j == 0 else "stand", x + rng.uniform(-2.5, 2.5), -hz - 17.6, 0.62 if j == 0 else 0.62, face=(x, 0))
    # the corner store with a neon sign
    S.box("Facade_Brick", (34, 2.4, -hz - 3), (10, 4.8, 6), skip=("bottom",))
    S.box("Glow_Neon", (34, 3.6, -hz + 0.02), (3.4, 0.6, 0.05))
    S.box("Glow_Warm", (34, 1.3, -hz + 0.02), (6, 1.8, 0.04))
    for k in range(3):
        S.stand("stand", 31 + k * 2.5, -hz + 1.2, face=(0, 0))
    # oaks all around, kids and neighbors under them
    for k in range(40):
        a, r = rng.uniform(0, 2 * math.pi), rng.uniform(22, 90)
        x, z = math.cos(a) * r * 1.3, math.sin(a) * r
        if z > 8 and abs(x) < 36 and z < 40 or -hz - 18 < z < -hz - 2:
            continue
        tree(S, x, z, rng.uniform(8, 13), 700 + k, leaf="Leaf_Dark" if k % 2 else "Leaf", spread=1.1)
    for k in range(8):
        S.stand("stand", rng.choice([-1, 1]) * rng.uniform(18, 26), rng.uniform(-6, 6), face=(0, 0))
    # houses fill out the blocks; the skyline glows far downtown
    for k in range(60):
        a, r = rng.uniform(0, 2 * math.pi), rng.uniform(110, 400)
        x, z = math.cos(a) * r, math.sin(a) * r
        building(S, x, z, rng.uniform(8, 12), rng.uniform(9, 13), rng.choice((6.5, 9.5)), "Win_Night", yaw=rng.uniform(0, math.pi))
    skyline(S, rng, 1600, 2200, 40, 80, 300, "Win_NightGlass", skip=lambda a: not (-2.2 < a < -0.9))


def build_rooftop(S, rng):
    hx, hz, fh = fence_box("rooftop")
    # the garage roof deck (flat to the parapet), the drop, and the city below
    S.poly("Concrete", [(-26, 0.0, -20), (26, 0.0, -20), (26, 0.0, 36), (-26, 0.0, 36)])
    terrain(S, "Asphalt", GROUND_RADIUS, 40, lambda x, z, d: 0.0, y0=-24)
    for (x0, z0), (x1, z1) in (((-26, -20), (26, -20)), ((-26, -20), (-26, 36)), ((26, -20), (26, 36)), ((-26, 36), (26, 36))):
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        S.box("Concrete", (cx, 0.55, cz), (max(0.3, abs(x1 - x0)), 1.1, max(0.3, abs(z1 - z0))))
        S.box("Concrete", (cx, -12, cz), (max(0.3, abs(x1 - x0)), 24, max(0.3, abs(z1 - z0))), skip=("top",))
    fence(S, None, hx, hz, fh)
    light_poles(S, hx, hz, 8.0)
    # lounge: couches, a bar, a DJ table, string lights overhead
    for k, x in enumerate((-12, -4, 4, 12)):
        S.box("Fabric" if k % 2 else "Fabric_Blue", (x, 0.25, -hz - 3), (2.4, 0.5, 0.9))
        S.box("Fabric" if k % 2 else "Fabric_Blue", (x, 0.6, -hz - 3.4), (2.4, 0.7, 0.2))
        for j in range(3):
            if rng.random() < 0.8:
                S.stand("sit", x - 0.75 + j * 0.75, -hz - 2.95, 0.5, face=(x - 0.75 + j * 0.75, 0))
    S.box("Wood", (0, 0.55, -hz - 7), (8, 1.1, 0.8))
    S.box("Glow_Warm", (0, 1.12, -hz - 7), (7.8, 0.03, 0.7))
    for k in range(7):
        S.stand("stand", -3.5 + k * 1.2 + rng.uniform(-0.2, 0.2), -hz - 6.1, face=(-3.5 + k * 1.2, -hz - 7) if k % 2 else None)
    S.box("Black", (hx + 3.5, 0.55, -hz - 1), (1.6, 1.1, 0.8))
    S.box("Glow_Neon", (hx + 3.5, 1.12, -hz - 1), (1.4, 0.03, 0.6))
    S.stand("stand", hx + 3.5, -hz - 1.6, face=(hx + 3.5, 0))
    # a steel pergola over the lounge: posts and a beam at each end, the string lights hung between the beams
    z0, z1 = -hz - 1.0, -hz - 9.4
    for z in (z0, z1):
        S.tube("Steel", (-23, 4.3, z), (23, 4.3, z), 0.07, n=6)
        for x in (-23, -11.5, 0, 11.5, 23):
            S.tube("Steel", (x, 0, z), (x, 4.3, z), 0.08, n=6)
            S.box("Steel", (x, 0.02, z), (0.3, 0.04, 0.3))
    for k in range(8):
        string_lights(S, (-21 + k * 6, 4.22, z0), (-21 + k * 6, 4.22, z1), 0.5, n=8)
    crowd_along(S, "lean", -hx + 0.6, hx - 0.6, -hz - 0.45, 2, rng, 0.75)
    for sx in (-1, 1):
        crowd_end(S, sx, hx, hz, rng, 0.8)
        # planters with small trees at the ends
        for k in range(3):
            S.box("Concrete", (sx * 24, 0.45, -14 + k * 9), (1.4, 0.9, 1.4))
            S.blob("Leaf", (sx * 24, 1.8, -14 + k * 9), 1.0, seed=900 + k)
    # stair tower and HVAC units
    S.box("Concrete", (-21, 2, 26), (4, 4, 5))
    for k in range(3):
        S.box("Steel", (20, 0.8, 18 + k * 4), (3, 1.6, 2.4))
    # skyline all around: towers, crowns, warm windows, red aircraft lights
    skyline(S, rng, 70, 260, 70, 30, 120, "Win_NightGlass", y0=-24, skip=lambda a: math.sin(a) > 0.55 and abs(math.cos(a)) < 0.6)
    skyline(S, rng, 260, 900, 140, 40, 200, "Win_NightConc", y0=-24)
    skyline(S, rng, 900, 1900, 120, 30, 140, "Win_NightGlass", y0=-24)
    # streets below: rows of warm lights
    for k in range(-12, 13):
        for j in range(-12, 13, 2):
            S.box("Glow_City", (k * 60, -23.8, j * 60), (1.2, 0.2, 40))
            S.box("Glow_City", (j * 60, -23.8, k * 60), (40, 0.2, 1.2))


PARK_BUILDERS = {
    "copper-flats": build_copper,
    "ironside-cage": build_cage,
    "boardwalk": build_boardwalk,
    "maple-street": build_maple,
    "rooftop-ninth": build_rooftop,
}


# ------------------------------------------------------------------ build + export
def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)


def emit(S):
    col = bpy.context.scene.collection
    objs = []
    for mname, mb in S.groups.items():
        if not mb.f:
            continue
        name = "Ground" if mname in ("Desert", "Sand", "Grass", "Asphalt", "DirtGrass") and len(mb.f) > 3000 else mname
        me = bpy.data.meshes.new(mname)
        me.from_pydata([bl(p) for p in mb.v], [], mb.f)
        uv = me.uv_layers.new(name="UVMap")
        for poly, uvs in zip(me.polygons, mb.uv):
            for li, t in zip(poly.loop_indices, uvs):
                uv.data[li].uv = t
        me.materials.append(MATS[mname])
        me.validate()
        ob = bpy.data.objects.new("M_" + mname, me)
        col.objects.link(ob)
        objs.append(ob)
    for i, p in enumerate(S.lights):
        e = bpy.data.objects.new(f"Light_{i}", None)
        e.location = bl(p)
        col.objects.link(e)
        objs.append(e)
    return objs


def preview(pid, objs, path):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.7, 0.9, 1) if pid in ("copper-flats",) else (0.9, 0.6, 0.45, 1) if pid in ("boardwalk", "ironside-cage") else (0.04, 0.05, 0.1, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0 if pid in ("copper-flats", "boardwalk", "ironside-cage") else 0.3
    sc.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4 if pid == "copper-flats" else 2.5 if pid in ("boardwalk", "ironside-cage") else 0.4
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    cam.data.clip_end = 3000
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle = math.radians(30)
    shots = {"broadcast": ((0, 9.5, 25), (0, 1.1, 0)), "baseline": ((-20, 6, 0), (8, 1.4, 0)), "wide": ((30, 18, 40), (0, 0, -10))}
    for k, (pos, look) in shots.items():
        cam.location = bl(pos)
        d = bl(look) - bl(pos)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        sc.camera = cam
        sc.render.filepath = os.path.join(path, f"{pid}_{k}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(sun)
    bpy.data.objects.remove(cam)


def build_park(pid):
    clear_scene()
    build_materials()
    S = Scene()
    rng = random.Random(pid)
    PARK_BUILDERS[pid](S, rng)
    objs = emit(S)
    # a stand-in court so previews read correctly (not exported)
    if PREVIEW:
        preview(pid, objs, PREVIEW)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    out = os.path.join(OUTDIR, pid + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=True, export_yup=True, export_materials="EXPORT",
        export_image_format="AUTO", export_animations=False,
    )
    with open(os.path.join(OUTDIR, pid + ".spots.json"), "w") as fh:
        json.dump({"v": 1, **S.spots}, fh, separators=(",", ":"))
    tris = sum(sum(len(f) - 2 for f in mb.f) for mb in S.groups.values())
    return {"id": pid, "tris": tris, "spots": {k: len(v) // 4 for k, v in S.spots.items()}, "kb": round(os.path.getsize(out) / 1024)}


bpy.ops.wm.read_factory_settings(use_empty=True)
build_textures()
REPORT = [build_park(pid) for pid in PARK_BUILDERS if not ONLY or pid in ONLY]
print("PARKS", json.dumps(REPORT))
