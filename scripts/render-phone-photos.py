#!/usr/bin/env python3
"""Renders each synthetic specimen as a phone-like photo. These are simulated pictures, not real photos.

Blender (Cycles) renders the page on a counter: curled and creased paper, a laminated ID that reflects the lamp,
a ceiling light, the photographer's shadow, and a phone camera held at an angle with depth of field and shake.
Then a camera pipeline adds lens faults, sensor noise, white balance error, sharpening and JPEG.

Run:  python3 scripts/render-phone-photos.py <out folder> [name filter]   (SPECIMENS=<folder> renders another set)
Then: PHOTOS=<out folder> node scripts/eval-degraded.mjs
It needs the Blender flatpak (org.blender.Blender) and system Python with OpenCV and NumPy.
"""
import os
import sys

SRC = os.environ.get('SPECIMENS') or os.path.join(os.path.dirname(os.path.realpath(__file__)), '..', 'frontend', 'specimens')
W, H, SAMPLES = 1500, 2000, 32

try:
    import bpy
except ImportError:
    bpy = None


def render(out, only, quick=1.0):
    """Runs inside Blender. Writes one 16-bit PNG per specimen to <out>/.linear."""
    import random
    from math import cos, radians, sin
    from mathutils import Matrix, Vector

    def material(name, color=(0.8, 0.8, 0.8), rough=0.5, coat=0.0, image=None, bump=0.0, bump_scale=900):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        o = nt.nodes.new('ShaderNodeOutputMaterial')
        b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        nt.links.new(b.outputs['BSDF'], o.inputs['Surface'])
        b.inputs['Base Color'].default_value = (*color, 1)
        b.inputs['Roughness'].default_value = rough
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = 0.04
        if image:
            t = nt.nodes.new('ShaderNodeTexImage')
            t.image = bpy.data.images.load(image)
            t.extension = 'EXTEND'
            nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
        if bump:
            n = nt.nodes.new('ShaderNodeTexNoise')
            n.inputs['Scale'].default_value = bump_scale
            bn = nt.nodes.new('ShaderNodeBump')
            bn.inputs['Strength'].default_value = bump
            nt.links.new(n.outputs['Fac'], bn.inputs['Height'])
            nt.links.new(bn.outputs['Normal'], b.inputs['Normal'])
        return m, b

    def sheet(name, w, h, nx, ny, lift, mat):
        """A flat grid with UVs. lift(x, y) gives the height of each point."""
        verts = [(w * (i / nx - 0.5), h * (j / ny - 0.5)) for j in range(ny + 1) for i in range(nx + 1)]
        zs = [lift(x, y) for x, y in verts]
        low = min(zs)
        faces = [(j * (nx + 1) + i, j * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i) for j in range(ny) for i in range(nx)]
        me = bpy.data.meshes.new(name)
        me.from_pydata([(x, y, z - low) for (x, y), z in zip(verts, zs)], [], faces)
        uv = me.uv_layers.new()
        for loop in me.loops:
            v = loop.vertex_index
            uv.data[loop.index].uv = ((v % (nx + 1)) / nx, (v // (nx + 1)) / ny)
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
        ob = bpy.data.objects.new(name, me)
        ob.data.materials.append(mat)
        bpy.context.scene.collection.objects.link(ob)
        return ob

    def light(name, loc, size, size_y, watts, color):
        l = bpy.data.lights.new(name, 'AREA')
        l.shape, l.size, l.size_y, l.energy, l.color = 'RECTANGLE', size, size_y, watts, color
        ob = bpy.data.objects.new(name, l)
        ob.location = loc
        ob.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        bpy.context.scene.collection.objects.link(ob)

    os.makedirs(os.path.join(out, '.linear'), exist_ok=True)
    files = sorted(f for f in os.listdir(SRC) if f.endswith('.png') and only in f)
    for index, file in enumerate(sorted(f for f in os.listdir(SRC) if f.endswith('.png'))):
        if file not in files:
            continue
        rng = random.Random(100 + index)
        u = rng.uniform
        card = '-id-' in file
        bpy.ops.wm.read_factory_settings(use_empty=True)
        scene = bpy.context.scene

        # counter: wood, grey laminate or dark green, with a mottled grain
        tone = rng.choice([(0.36, 0.23, 0.13), (0.42, 0.42, 0.40), (0.10, 0.20, 0.16), (0.55, 0.47, 0.38)])
        cm, cb = material('counter', tone, rough=u(0.25, 0.5), bump=0.05, bump_scale=60)
        nt = cm.node_tree
        grain = nt.nodes.new('ShaderNodeTexNoise')
        grain.inputs['Scale'].default_value = u(8, 30)
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = (*[c * 0.7 for c in tone], 1)
        ramp.color_ramp.elements[1].color = (*[min(1, c * 1.25) for c in tone], 1)
        nt.links.new(grain.outputs['Fac'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], cb.inputs['Base Color'])
        sheet('counter', 3, 3, 1, 1, lambda x, y: 0, cm)

        # another sheet under the page, and a pen beside it
        if not card:
            under = sheet('under', 0.21, 0.297, 1, 1, lambda x, y: 0, material('blank', (0.86, 0.85, 0.82), 0.6, bump=0.02)[0])
            under.location = (u(-0.04, 0.04), u(-0.05, 0.05), 0.0002)
            under.rotation_euler = (0, 0, radians(u(-25, 25)))
        bpy.ops.mesh.primitive_cylinder_add(radius=0.005, depth=0.14, location=((0.075 if card else 0.15) * rng.choice([-1, 1]), u(-0.06, 0.06), 0.0052), rotation=(radians(90), 0, radians(u(-30, 30))))
        bpy.context.object.data.materials.append(material('pen', (0.02, 0.03, 0.12), 0.2, coat=1)[0])

        if card:
            # laminated ID: flat, glossy, so the lamp shows up as glare
            w, h = 0.0856, 0.054
            mat = material('id', rough=0.3, coat=1.0, image=os.path.join(SRC, file))[0]
            page = sheet('page', w, h, 1, 1, lambda x, y: 0, mat)
            bevel = page.modifiers.new('corners', 'BEVEL')
            bevel.affect, bevel.width, bevel.segments = 'VERTICES', 0.003, 8
            page.modifiers.new('thick', 'SOLIDIFY').thickness = 0.0008
            page.location.z = 0.0012
        else:
            # paper: the long edges curl up, one fold crease runs across, and one corner lifts
            w, h = 0.21, 0.297
            curl, fold, y0, corner = u(0.002, 0.009), u(0.008, 0.035), u(-0.05, 0.05), u(0.0, 0.02)
            sx, sy = rng.choice([-1, 1]), rng.choice([-1, 1])
            lift = lambda x, y: curl * (x / 0.105) ** 2 + fold * abs(y - y0) + corner * max(0.0, (sx * x / 0.105 + sy * y / 0.1485) / 2 - 0.55) ** 2 * 8
            mat = material('paper', rough=0.6, image=os.path.join(SRC, file), bump=0.03)[0]
            page = sheet('page', w, h, 60, 84, lift, mat)
            page.location.z = 0.0006

        # camera: a phone main camera (26 mm equivalent, f/1.8), hand held above the page
        cam_data = bpy.data.cameras.new('phone')
        cam_data.sensor_width, cam_data.lens, cam_data.clip_start = 6.4, 4.62, 0.01
        target = Vector((u(-0.012, 0.012), u(-0.012, 0.012), 0.002))
        tilt, az = radians(u(5, 25)), radians(-90 + u(-14, 14))
        dist = u(0.12, 0.16) if card else 0.31 * u(1.0, 1.18)
        loc = target + dist * Vector((sin(tilt) * cos(az), sin(tilt) * sin(az), cos(tilt)))
        cam = bpy.data.objects.new('phone', cam_data)
        cam.location = loc
        cam.rotation_euler = ((target - loc).to_track_quat('-Z', 'Y').to_matrix().to_4x4() @ Matrix.Rotation(radians(u(-6, 6)), 4, 'Z')).to_euler()
        cam_data.dof.use_dof, cam_data.dof.focus_distance, cam_data.dof.aperture_fstop = True, dist * u(0.97, 1.03), 1.8
        scene.collection.objects.link(cam)
        scene.camera = cam
        # the hand shakes a little during the exposure
        cam.keyframe_insert('location', frame=1)
        cam.location = loc + Vector((u(-1, 1), u(-1, 1), u(-0.5, 0.5))) * (0.0004 if card else 0.0012)
        cam.keyframe_insert('location', frame=2)

        # the photographer: phone body, the hand and forearm that hold it, head and torso, which block part of the light
        skin = material('person', (0.25, 0.2, 0.18), 0.8)[0]
        bpy.context.view_layer.update()
        back = cam.matrix_world.to_quaternion() @ Vector((0, 0, 1))
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc + back * 0.007, rotation=cam.rotation_euler, scale=(0.075, 0.16, 0.008))
        bpy.context.object.data.materials.append(skin)
        turn = cam.matrix_world.to_quaternion()
        palm = loc + turn @ Vector((u(-0.01, 0.01), -0.055, 0.03))
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=palm, rotation=cam.rotation_euler, scale=(0.062, 0.075, 0.03))
        bpy.context.object.data.materials.append(skin)
        elbow = Vector((loc.x + rng.choice([-1, 1]) * u(0.08, 0.2), loc.y - 0.34, loc.z + u(-0.04, 0.06)))
        bpy.ops.mesh.primitive_cylinder_add(radius=0.038, depth=(elbow - palm).length, location=(palm + elbow) / 2, rotation=(elbow - palm).to_track_quat('Z', 'Y').to_euler())
        bpy.context.object.data.materials.append(skin)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.1, location=(loc.x + u(-0.05, 0.05), loc.y - 0.14, loc.z + 0.2))
        bpy.context.object.data.materials.append(skin)
        bpy.ops.mesh.primitive_cube_add(size=1, location=(loc.x, loc.y - 0.38, 0.2), scale=(0.42, 0.2, 0.7))
        bpy.context.object.data.materials.append(skin)

        # light: a ceiling panel, a weak bluish window to one side, and dim room light
        warm = u(0, 1)
        light('ceiling', (u(-0.7, 0.7), u(-0.6, 0.8), u(1.2, 1.9)), u(0.3, 1.0), u(0.3, 0.6), u(200, 400), (1, 0.80 + 0.16 * warm, 0.58 + 0.34 * warm))
        light('window', (rng.choice([-1, 1]) * u(1.5, 2.5), u(-1, 1), u(0.8, 1.5)), 1.0, 1.2, u(20, 120), (0.85, 0.92, 1))
        world = bpy.data.worlds.new('room')
        world.use_nodes = True
        bg = world.node_tree.nodes.get('Background')
        if bg:
            bg.inputs['Color'].default_value = (0.8, 0.8, 0.8, 1)
            bg.inputs['Strength'].default_value = u(0.05, 0.25)
        scene.world = world

        r = scene.render
        r.engine = 'CYCLES'
        scene.cycles.device, scene.cycles.samples, scene.cycles.use_denoising, scene.cycles.seed = 'CPU', max(8, int(SAMPLES * quick)), True, 100 + index
        r.resolution_x, r.resolution_y, r.resolution_percentage = W, H, int(100 * quick)
        r.use_motion_blur, r.motion_blur_shutter = True, 1.0
        scene.view_settings.view_transform = 'Standard'
        scene.view_settings.exposure = -3.5
        r.image_settings.file_format, r.image_settings.color_mode, r.image_settings.color_depth = 'PNG', 'RGB', '16'
        r.filepath = os.path.join(out, '.linear', file)
        scene.frame_set(1)
        bpy.ops.render.render(write_still=True)
        print('rendered', file, flush=True)


def camera_pipeline(src, dst, seed):
    """Turns a clean render into what a phone would save: lens, sensor, processing, then JPEG."""
    import cv2
    import numpy as np
    rng = np.random.default_rng(seed)
    im = cv2.imread(src, cv2.IMREAD_UNCHANGED).astype(np.float32) / 65535
    lin = np.where(im <= 0.04045, im / 12.92, ((im + 0.055) / 1.055) ** 2.4)
    lin *= rng.uniform(0.55, 0.8) / max(np.percentile(lin, 90), 1e-4)  # auto exposure, a little off
    h, w = lin.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w / 2, h / 2
    r2 = ((xx - cx) ** 2 + (yy - cy) ** 2) / (cx * cx + cy * cy)
    # lens: barrel distortion, color fringing toward the corners, darker corners
    k, fringe = rng.uniform(-0.03, 0.02), rng.uniform(0.0003, 0.0009)
    chans = []
    for c, s in zip(range(3), (1 - fringe, 1, 1 + fringe)):
        f = (1 + k * r2) * s
        chans.append(cv2.remap(lin[..., c], cx + (xx - cx) * f, cy + (yy - cy) * f, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT))
    lin = np.dstack(chans) * (1 - rng.uniform(0.15, 0.35) * r2[..., None])
    # sensor: shot noise grows with brightness, read noise does not, and demosaicing smears both
    shot, read = rng.uniform(0.0004, 0.002), 0.0015
    lin = lin + rng.normal(size=lin.shape).astype(np.float32) * np.sqrt(np.clip(lin, 0, None) * shot + read * read)
    lin = cv2.GaussianBlur(lin, (0, 0), rng.uniform(0.5, 0.8))
    # processing: white balance a little off, tone curve, contrast, the sharpening halo phones add
    lin[..., 0] *= rng.uniform(0.95, 1.05)
    lin[..., 2] *= rng.uniform(0.95, 1.05)
    lin = np.clip(lin, 0, 1)
    out = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
    out = 0.5 + (out - 0.5) * 1.08
    out = out + rng.uniform(0.5, 0.9) * (out - cv2.GaussianBlur(out, (0, 0), 1.2))
    cv2.imwrite(dst, (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(84, 93))])


if bpy:
    args = sys.argv[sys.argv.index('--') + 1:]
    render(args[0], args[1] if len(args) > 1 else '', float(args[2]) if len(args) > 2 else 1.0)
elif __name__ == '__main__':
    import subprocess
    if len(sys.argv) < 2:
        sys.exit('usage: python3 scripts/render-phone-photos.py <out folder> [name filter] [size factor]')
    out, only = os.path.abspath(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else ''
    quick = sys.argv[3] if len(sys.argv) > 3 else '1'
    os.makedirs(out, exist_ok=True)
    subprocess.run(['flatpak', 'run', 'org.blender.Blender', '-b', '--python', os.path.realpath(__file__), '--', out, only, quick], check=True, stdout=subprocess.DEVNULL)
    names = sorted(f for f in os.listdir(SRC) if f.endswith('.png'))
    for index, file in enumerate(names):
        src = os.path.join(out, '.linear', file)
        if only in file and os.path.exists(src):
            camera_pipeline(src, os.path.join(out, file.replace('.png', '.jpg')), 100 + index)
            print(file.replace('.png', '.jpg'))
