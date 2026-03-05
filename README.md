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
