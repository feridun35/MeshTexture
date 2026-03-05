# MeshTexture
### Physical 3D Texturing for the Maker Era. No CAD bloat. No Slicer crashes.

[**Launch MeshTexture**](https://www.meshtexture.com) | [**Report a Bug**](https://github.com/feridun35/MeshTexture/issues)

---

> **"Adding a knurling pattern shouldn't take three hours of CAD work and a computer restart."** > MeshTexture is a high-performance, browser-based engineering tool designed to apply complex physical textures directly to STL files. Built by a maker, for makers.
<img width="2560" height="1461" alt="Ekran görüntüsü 2026-03-05 2308411" src="https://github.com/user-attachments/assets/95ab5ad3-bbbd-4677-b652-9b2a8d67b7c3" />

## 🧬 The Origin: From Engineer to Developer

As a **Mechanical Engineering student** and an avid user of the **Bambu Lab P1S**, I hit a wall that every maker eventually faces: **The Texture Gap.**

Existing CAD software like Fusion 360 or SolidWorks are masterpieces of precision, but they fail miserably when asked to handle the millions of polygons required for realistic physical textures. On the other hand, artistic tools like Blender offer the power but come with a steep learning curve that many engineers simply don't have time for.

**The result?** Slicers crashing, hours wasted in "Not Responding" windows, and models that look great on screen but are "unprintable" in reality.

### The Mission
MeshTexture was born out of a simple necessity: To create a tool that handles the heavy lifting of geometric displacement without the overhead of a full CAD suite. 
- **Lightweight:** Runs in your browser.
- **Engineered:** Focused on manifold (water-tight) geometry.
- **Slicer-Ready:** Outputs files that your printer actually understands.

## 🔄 The Smart Workflow: 3 Steps to Print

MeshTexture handles all the geometric complexity in the background, so you can focus on the design.

1. **Select:** Import your STL and click the surfaces you want to texture. Our **Smart Fill** (Angle-based BFS) picks the right faces instantly.
2. **Texture:** Pick a pattern from the library or upload your own. The engine **automatically** optimizes the mesh density (Refine) to match your chosen detail level.
3. **Bake:** Click "Apply" to make the texture physical. The engine ensures the model is **Manifold (Water-tight)** and generates an optimized, binary STL ready for your slicer.

Tutorial Video :  https://www.youtube.com/watch?v=AHr5NL9hm3o
<img width="4000" height="1516" alt="collage" src="https://github.com/user-attachments/assets/e62951da-6bff-4450-b4a5-f970521a6873" />

## 🖨️ Slicer-Ready: Designed for Physical Reality

A beautiful model on screen is useless if it doesn't print. MeshTexture ensures every export is optimized for the actual manufacturing process.

### Why Our Models Print Better:
- **Manifold Integrity:** The engine performs a real-time **isManifold** check, ensuring your model is "water-tight" and won't confuse your slicer's path generation.
- **Automated Wall Generation:** When surface displacement occurs, the engine automatically bridges the gap between the original base and the new texture with vertical "walls," preventing non-manifold edges.
- **Binary STL Optimization:** Exports are handled using a specialized **STLExporter** that ensures maximum compatibility with Bambu Studio, Cura, and PrusaSlicer.
- **Isotropic Uniformity:** Our **1:2 Edge Bisection** subdivision logic keeps triangle shapes uniform, eliminating the "sliver" artifacts common in automated subdivision tools.
<img width="2560" height="1528" alt="image" src="https://github.com/user-attachments/assets/b73bbec3-8d7c-42b7-bf9e-3fbd267680ae" />


## 🗺️ Roadmap: The Future of MeshTexture

MeshTexture is evolving from a robust geometric engine into a comprehensive professional texturing suite.

- **[ ] Local Texture Painting:** Brush-based masking to apply different textures to specific sub-regions of a selection.
- **[ ] Industrial Texture Library:** A curated collection of ISO-standard engineering patterns (knurling, safety grips, technical meshes).
- **[ ] Advanced UV Unwrapping:** Automated spherical and cylindrical mapping for complex organic geometries.
- **[ ] Edge Decimation (Simplify):** High-speed planar simplification to reduce file sizes for ultra-high polygon models without losing detail.


## ⚠️ The Texture Gap: Why Traditional Tools Fail

The 3D printing community has been trapped between two extremes:
1. **CAD Bottleneck:** Parametric software (Fusion 360, SolidWorks) is designed for precision, not for millions of triangular faces. Adding a complex displacement map often leads to the dreaded "Not Responding" screen or file sizes that are impossible to export.
2. **The Slicer Crash:** Even if you manage to generate a textured model in artistic software, most slicers (Bambu Studio, Cura, etc.) struggle to process the massive polygon counts, leading to lag, visual artifacts, or total software failure.

**MeshTexture solves this by treating geometry like data, not just lines on a screen.**

## 🧠 Engineering Under the Hood: Breaking the 1.4GB Limit

MeshTexture isn't just a wrapper for Three.js; it's a high-performance geometric engine optimized for the browser. 

### Key Innovations:
- **TypedArray Memory Management:** By transitioning from standard JS objects to low-level **Float64Array** and **Int32Array** architectures, we reduced RAM consumption from **1.5GB to under 100MB** for models with 7M+ polygons. This makes Chrome's 1.4GB Heap Limit a problem of the past.
- **Isotropic Topology:** Unlike standard subdivision, our engine uses a **Longest-Edge Bisection (1:2 Split)** logic. This ensures equilateral triangle shapes, providing a uniform base for textures and preventing "sliver" artifacts in physical prints.
- **Parallel Processing:** All heavy geometric calculations are offloaded to **Web Workers**, keeping the UI responsive even while processing millions of vertices.
<img width="2560" height="1393" alt="Ekran görüntüsü 2026-03-05 0018091" src="https://github.com/user-attachments/assets/878209c0-f13b-4b38-95ce-2051b3321dda" />

Reddit Threads : 
https://www.reddit.com/r/3Dprinting/comments/1qlx3sb/i_built_a_free_web_tool_to_embossengrave_physical/ 
https://www.reddit.com/r/3Dprinting/comments/1rivxie/texture_prints_update/
---

## 🔒 Legal & Copyright

**© 2026 Feridun Oktar. All rights reserved.**

The source code of MeshTexture is proprietary. This repository is for documentation, technical specifications, and project showcase purposes only. 

No license is granted for the distribution, modification, or commercial use of the underlying software architecture, algorithms, or front-end code. For inquiries or collaboration, please open an issue or contact me through the platform.
