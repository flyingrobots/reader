# Reader scene language, version 1

One JSON object. Unknown fields are errors. Numbers are plain JSON numbers. Lengths are in scene
units; the default camera at [0, 0, 6] looking at the origin frames about 8 by 4 units.

## Top level
- "reader_scene": 1 (required)
- "title": text, up to 80 characters
- "seed": whole number (seeds every random layout, so the art is the same on every screen)
- "background": color (default "bg", the page)
- "fog": {"color", "near", "far"} or {"color", "density" 0–0.5}
- "camera": {"position": [x,y,z], "target": [x,y,z], "fov": 15–90,
  "motion": {"kind": "still"} | {"kind": "orbit", "period": s, "axis": "y", "direction": 1|-1} |
  {"kind": "sway", "amplitude": 0–1.5, "period": s} | {"kind": "dolly", "amplitude": 0–0.5, "period": s}}
- "still": {"at": 0–60} — the moment (seconds) used for the still image and reduced motion
- "lights": up to 8 of {"type": "ambient"|"hemisphere"|"directional"|"point"|"spot", "color",
  "intensity", "position", "target", "ground" (hemisphere), "distance", "decay", "angle",
  "penumbra"}; point lights may have an "id" and "animate". Default: a soft "bright" sky and one key light.
- "materials": {"<id>": material} — up to 32 named materials
- "objects": list of nodes (required)
- "links": up to 64 tethers {"from": id, "to": id, "color", "opacity", "sag": 0–5}: a thin line
  between two objects, redrawn as they move

## Colors (always relative to the reader's theme)
A token name: "bg" (page), "surface", "raised", "line", "ink" (text: strongest contrast with the
page), "muted", "faint", "accent", "accent-ink", "rust", "warning", "chart-1" … "chart-8"
(categorical hues), and two derived roles: "bright" (the lighter of page and ink: use it for light
and highlights) and "deep" (the darker: shadows). Or an object:
{"token": "chart-2", "mix": "bg", "amount": 0.4, "lightness": -0.6–0.6, "saturation": -1–1, "hue": -60–60}
or {"light": color, "dark": color} to choose by theme brightness. Themes may be light or dark:
"ink" is dark on light themes and light on dark ones, so color lights "bright" (or a hue mixed with
"bright"), never "ink". Additive blending becomes normal blending on light themes.

## Materials
{"type": "standard"|"physical"|"lambert"|"toon"|"basic", "color", "emissive",
"emissiveIntensity": 0–4, "roughness": 0–1, "metalness": 0–1, "clearcoat": 0–1, "transmission": 0–1,
"opacity": 0–1, "wireframe": bool, "flatShading": bool, "side": "front"|"back"|"double",
"blending": "normal"|"additive"}

## Nodes
Every node: "type", optional "id" (lowercase letters, digits, dashes; unique), "position" [x,y,z]
(−50…50), "rotation" [x,y,z] radians, "scale" number or [x,y,z], "animate": up to 8 animations.
- {"type": "mesh", "geometry": geometry, "material": "<material id>" or a material object}
- {"type": "group", "children": [nodes]} (nest at most 6 deep)
- {"type": "instances", "geometry", "material", "count": 1–6000, "colors": [colors],
  "layout": {"kind": "ring"|"spiral"|"helix"|"grid"|"sphere"|"scatter"|"line"|"path", …,
  "jitter": 0–1, "scaleRange": [min, max], "seed", "facing": "none"|"outward"|"center"|"tangent"|"random"},
  "each": per-instance motion {"kind": "bob"|"spin"|"pulse"|"wave", "amplitude", "period", "stagger"|"wavelength"}}
  Layout fields: ring {radius, arc}; spiral {radius, turns, growth}; helix {radius, height, turns};
  grid {columns, spacing, layers}; sphere {radius}; scatter {size: [x,y,z]}; line {from, to};
  path {points: [[x,y,z], …]}.
- {"type": "particles", "count": 1–24000, "shape": "sphere"|"shell"|"box"|"disc"|"ring",
  "radius", "size": [x,y,z], "pointSize": 0.002–0.5, "color" or "colors", "opacity",
  "blending", "seed", "motion": {"kind": "still"|"drift"|"swirl"|"rise"|"fall"|"breathe", "speed": 0–3,
  "axis", "amplitude", "period"}}
- {"type": "line", "points": [[x,y,z], …] (2–512), "closed": bool, "smooth": bool, "color", "opacity"}

## Geometry
"box" {size [x,y,z], segments} · "sphere" {radius, widthSegments ≤64, heightSegments ≤48} ·
"icosahedron" | "octahedron" | "dodecahedron" | "tetrahedron" {radius, detail 0–5} ·
"torus" {radius, tube, radialSegments, tubularSegments, arc} · "torusKnot" {radius, tube, p, q,
tubularSegments, radialSegments} · "cylinder" {radiusTop, radiusBottom, height, radialSegments,
heightSegments, openEnded} · "cone" {radius, height, radialSegments, openEnded} · "capsule" {radius,
length} · "plane" {size [w,h], segments [x,y] ≤128, "wave": {"amplitude", "wavelength", "period"}} ·
"circle" {radius, segments} · "ring" {inner, outer, segments} · "lathe" {points [[radius, y], …]
(2–256), segments} · "extrude" {shape [[x,y], …] (3–256), holes [[[x,y], …]], depth, bevel 0–1} ·
"tube" {points [[x,y,z], …] (2–256), radius, tubularSegments, radialSegments, closed} ·
"parametric" {surface: "klein"|"mobius"|"saddle"|"shell"|"helicoid"|"wave"|"dupin"|"spherical-harmonic",
slices, stacks, a, b, c (−10…10), size} · "custom" {vertices [[x,y,z], …] (≤4096), faces [[i,j,k], …] (≤8192)}

## Animations (slow: every period is 2–600 seconds)
- {"kind": "spin", "axis": "x"|"y"|"z"|[x,y,z], "period", "direction": 1|-1}
- {"kind": "oscillate", "property": "position.x|y|z"|"rotation.x|y|z"|"scale"|"opacity"|"emissiveIntensity",
  "amplitude", "period", "phase": 0–1}
- {"kind": "orbit", "radius", "period", "axis", "phase", "center": [x,y,z] or "around": id}
- {"kind": "wander", "amplitude", "speed": 0.005–1, "seed"} — smooth drift
- {"kind": "follow", "target": id, "offset": [x,y,z], "stiffness": 0.1–20, "damping": 0.05–10} — a spring
- {"kind": "look", "target": id} — keep facing another object
- {"kind": "react", "source": id, "property": "scale"|"opacity"|"emissiveIntensity"|"position.y",
  "near", "far", "from", "to"} — the value goes from "from" (at distance near) to "to" (at far)

## Budgets
At most 240 nodes, 400 animations, 6000 instances, 24000 particles and about 400,000 triangles in
all. Follow and orbit-around targets must not form a cycle. Ids must exist where referenced.

## Example
```json
{"reader_scene": 1, "title": "Two currents", "seed": 7,
 "camera": {"position": [0, 1.2, 6.5], "target": [0, 0, 0], "fov": 35, "motion": {"kind": "sway", "amplitude": 0.4, "period": 60}},
 "fog": {"color": "bg", "near": 6, "far": 14},
 "lights": [{"type": "hemisphere", "color": "bright", "ground": "bg", "intensity": 0.8},
            {"type": "directional", "color": "accent", "intensity": 1.6, "position": [3, 4, 5]}],
 "materials": {"core": {"type": "physical", "color": "accent", "roughness": 0.35, "clearcoat": 0.6},
               "glass": {"type": "standard", "color": {"token": "chart-2", "mix": "bg", "amount": 0.3}, "opacity": 0.55}},
 "objects": [
   {"type": "mesh", "id": "heart", "geometry": {"type": "icosahedron", "radius": 0.8, "detail": 3}, "material": "core",
    "animate": [{"kind": "oscillate", "property": "scale", "amplitude": 0.04, "period": 9}]},
   {"type": "mesh", "id": "moon", "geometry": {"type": "sphere", "radius": 0.22}, "material": "glass",
    "animate": [{"kind": "orbit", "around": "heart", "radius": 1.8, "period": 40}]},
   {"type": "particles", "count": 1500, "shape": "shell", "radius": 3.2, "pointSize": 0.02, "color": "muted",
    "opacity": 0.6, "motion": {"kind": "swirl", "speed": 0.05}}],
 "links": [{"from": "heart", "to": "moon", "color": "faint", "sag": 0.3}]}
```
