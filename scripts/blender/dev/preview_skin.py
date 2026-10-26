"""Dev helper: preview the baked mask textures on the Body skin material in Blender.

Usage (inside Blender after build_player.py ran):
    PREVIEW = {"hair": "scalp", "beard": "full", "tone": (0.45, 0.28, 0.19)}
    exec(open("scripts/blender/dev/preview_skin.py").read())
"""
import bpy, os
ROOT = globals().get("REPO_ROOT", os.getcwd())
P = globals().get("PREVIEW", {})
tone = P.get("tone", (0.45, 0.28, 0.19))
hair_col = P.get("hair_color", (0.02, 0.015, 0.01))

def img(n):
    i = bpy.data.images.load(os.path.join(ROOT, "public", "models", n + ".png"), check_existing=False)
    i.colorspace_settings.name = "Non-Color"
    return i

nt = bpy.data.materials["Skin"].node_tree
for n in list(nt.nodes):
    if n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"):
        nt.nodes.remove(n)

def sep(name):
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img(name)
    s = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(t.outputs["Color"], s.inputs[0])
    return s

A, B, C, D = sep("player_maskA"), sep("player_maskB"), sep("player_maskC"), sep("player_maskD")
hair_src = {"none": None, "scalp": A.outputs[0], "fade": A.outputs[1], "cornrows": D.outputs[0], "waves": D.outputs[1]}[P.get("hair", "scalp")]
beard_src = {"none": None, "stubble": B.outputs[0], "goatee": B.outputs[1], "mustache": B.outputs[2], "full": C.outputs[0]}[P.get("beard", "full")]

def mx(a, b):
    if a is None: return b
    if b is None: return a
    n = nt.nodes.new("ShaderNodeMath"); n.operation = "MAXIMUM"
    nt.links.new(a, n.inputs[0]); nt.links.new(b, n.inputs[1])
    return n.outputs[0]

mask = mx(mx(hair_src, beard_src), A.outputs[2])
lip = nt.nodes.new("ShaderNodeMix"); lip.data_type = "RGBA"
lip.inputs[6].default_value = (*tone, 1)
lip.inputs[7].default_value = (tone[0] * 0.75, tone[1] * 0.55, tone[2] * 0.55, 1)
nt.links.new(C.outputs[1], lip.inputs[0])
cav = nt.nodes.new("ShaderNodeMix"); cav.data_type = "RGBA"; cav.blend_type = "MULTIPLY"
cav.inputs[0].default_value = 1.0
nt.links.new(lip.outputs[2], cav.inputs[6])
comb = nt.nodes.new("ShaderNodeCombineColor")
for k in range(3):
    nt.links.new(C.outputs[2], comb.inputs[k])
nt.links.new(comb.outputs[0], cav.inputs[7])
mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
nt.links.new(cav.outputs[2], mix.inputs[6])
mix.inputs[7].default_value = (*hair_col, 1)
nt.links.new(mask, mix.inputs[0])
nt.links.new(mix.outputs[2], nt.nodes["Principled BSDF"].inputs["Base Color"])
