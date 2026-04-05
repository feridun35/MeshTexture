# OPTIMIZATIONS.md — Full Audit Report

**Project:** 3D Mesh Texture Pro  
**Date:** 2026-03-11  
**Scope:** All 9 JavaScript source modules + index.html  
**Auditor:** Optimization Engine (senior optimization engineer pass)

---

## 1) Optimization Summary

### Current Health
The codebase is **moderately optimized**. Key wins like on-demand rendering (F-10), delta-only selection updates (F-08), transferable buffers, and lazy geometry cloning (F-02) have already been implemented. However, several **high-impact algorithmic and memory issues** remain, especially in the worker-heavy subdivision/displacement pipeline and the paint-mode selection path.

### Top 3 Highest-Impact Improvements

1. **`performRadiusFill` is O(N) per paint stroke on every face** — brute-force scan of ALL faces every pointer-move event. On a 5M-triangle mesh, that's ~45M float reads per stroke event. A spatial index (BVH) would reduce this to O(log N + k).
2. **Duplicated vertex welding/quantization code** across displacement bake (lines 96–135) and adaptive remesh boundary estimation (lines 744–850). This performs O(N log N) sort twice with identical logic — once on the main displacement path and again inside the adaptive remesh path — wasting time and memory.
3. **`structuredClone` on every slider mousedown** — `saveState()` deep-copies `AppState.params` (containing a `THREE.Matrix4` with 16 floats) on every slider interaction. `structuredClone` throws on non-cloneable objects, falling back to `JSON.parse(JSON.stringify(...))`, which also silently drops the `Matrix4` prototype. This is both wasteful and subtly buggy.

### Biggest Risk If No Changes Are Made
On meshes approaching the 5–10M triangle range, the **brute-force paint stroke** will cause visible input lag (>100ms per pointermove), making the paint tool unusable. Combined with the **O(N) adjacency build using `.includes()`** (O(N²) worst case), the app will become unresponsive on complex models.

---

## 2) Findings (Prioritized)

---

### F-01: Brute-Force Paint Stroke — O(N) Face Scan Per Pointer Move

* **Category:** Algorithm / CPU  
* **Severity:** Critical  
* **Impact:** Latency, UI responsiveness during paint mode  
* **Evidence:** `selection.js:performRadiusFill()` (lines 384–431). Iterates over *every face* in the mesh for each pointermove event. On a 5M-tri mesh, this reads 45M floats per event.  
* **Why it's inefficient:** No spatial acceleration structure. The "fast bounding sphere-ish check" (line 411) still requires iterating the entire face array.  
* **Recommended fix:** Build a **BVH (Bounding Volume Hierarchy)** over face centroids at load time (or lazily). During paint, traverse the BVH and only process faces whose bounding box intersects the brush sphere. Three.js has `computeBoundsTree()` via the [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) library.  
* **Tradeoffs / Risks:** Adds a dependency or ~500 lines of custom BVH code. Construction time is O(N log N) but amortized across all strokes.  
* **Expected impact estimate:** 10–100× faster paint strokes on large meshes.  
* **Removal Safety:** N/A (new code)  
* **Reuse Scope:** Module-wide (also speeds up smart-fill raycasting)

---

### F-02: Adjacency Build Uses `.includes()` Creating O(N²) Worst Case

* **Category:** Algorithm / CPU  
* **Severity:** High  
* **Impact:** Build time for adjacency graph (smart fill, selection)  
* **Evidence:** `selection.js:buildAdjacency()` lines 563–565:
  ```js
  if (!adjacencySets[f1].includes(f2)) adjacencySets[f1].push(f2);
  if (!adjacencySets[f2].includes(f1)) adjacencySets[f2].push(f1);
  ```
  The comment says "max degree is typically 3-6", but on meshes with T-junctions from subdivision, degree can reach 10–20+, making `.includes()` degrade.  
* **Why it's inefficient:** `.includes()` on a growing array is O(k) per call, where k is current neighbor count. Over all edges, this becomes O(E·k). With subdivision artifacts, k grows.  
* **Recommended fix:** Use a `Uint32Array`-based adjacency list with a known max-degree cap (e.g., 32). Pre-allocate `Uint32Array(faceCount * maxDegree)` + a `Uint8Array(faceCount)` for degree counts. Insertion is O(1) with bounds check. Alternatively, keep the flat array but use a `Set` for dedup during construction, then convert to array — the comment about GC pressure was about per-face `new Set()`, but a single reusable `Set` cleared per edge-list would work.  
* **Tradeoffs / Risks:** Fixed max-degree cap requires a reasonable upper bound. Overflow would need a fallback.  
* **Expected impact estimate:** 2–5× faster adjacency build on 1M+ face meshes.  
* **Removal Safety:** N/A (refactor)  
* **Reuse Scope:** Module-wide (`selection.js`)

---

### F-03: Duplicated Vertex Welding/Quantization Logic

* **Category:** Algorithm / Code Reuse  
* **Severity:** High  
* **Impact:** CPU time, memory allocation, maintenance cost  
* **Evidence:**  
  - `displacement.worker.js` lines 96–135: Quantize → sort → assign unique IDs (displacement path)  
  - `displacement.worker.js` lines 744–850: Identical quantize → sort → unique ID → edge hashing (adaptive remesh boundary estimation)  
  Both paths allocate separate `Int32Array` buffers for `qX`, `qY`, `qZ`, `sortBuf`, `uniqueIDs`.  
* **Why it's inefficient:** On a 5M vertex mesh, each pass allocates ~80 MB of typed arrays and performs an O(N log N) sort. Doing it twice doubles both allocation and CPU time.  
* **Recommended fix:** Extract a shared `weldVertices(positions, count)` utility function that returns `{ uniqueIDs, numUnique }`. Call it once; pipe the result to both the displacement path and the boundary estimation path.  
* **Tradeoffs / Risks:** The two paths operate on different subsets (full mesh vs. selected faces only). The displacement weld runs on ALL vertices, while the boundary weld runs on selected-only. Unifying requires either (a) running the full weld once and filtering, or (b) parameterizing the weld function for subset input. Option (b) is cleaner.  
* **Expected impact estimate:** ~40% reduction in worker pre-computation time for remesh path.  
* **Removal Safety:** Safe (pure refactor)  
* **Reuse Scope:** `displacement.worker.js` (both task branches)

---

### F-04: `BigInt` Edge Keys Are Slow in Hot Loops

* **Category:** CPU / Algorithm  
* **Severity:** High  
* **Impact:** Sort and comparison speed in edge detection loops  
* **Evidence:**  
  - `displacement.worker.js` lines 434, 438, 442, 809, 814, 820: `(BigInt(u) << 32n) | BigInt(v)` inside tight for-loops.  
  - `selection.js` line 536: `(BigInt(lo) << 32n) | BigInt(hi)` in `buildAdjacency`.  
  V8's BigInt operations are **10–50× slower** than Number operations due to arbitrary-precision overhead and lack of JIT optimization.  
* **Why it's inefficient:** BigInt is designed for precision, not speed. Edge keys can be represented as two 32-bit integers packed into a `Float64` (using `DataView`) or stored as two columns in a `Uint32Array` and sorted lexicographically.  
* **Recommended fix:**  
  - Replace `BigUint64Array` edge keys with a **two-column `Uint32Array` sort**: Store `edgeLo[i]` and `edgeHi[i]` as separate `Uint32Array`s. Sort by `(lo, hi)` pair using a custom comparator on the index array. This avoids all BigInt allocation.  
  - Alternatively, if vertex IDs fit in 20 bits (< 1M unique vertices), pack into `(lo * 1048576 + hi)` as a safe integer.  
* **Tradeoffs / Risks:** If unique vertex IDs exceed 2^26 (~67M), the Number packing trick overflows MAX_SAFE_INTEGER. The two-column approach works universally.  
* **Expected impact estimate:** 3–10× faster edge key construction and sorting.  
* **Removal Safety:** Likely Safe (same semantics, different representation)  
* **Reuse Scope:** `displacement.worker.js` and `selection.js`

---

### F-05: `saveState()` Deep-Clones Params on Every Slider Mousedown

* **Category:** Memory / CPU  
* **Severity:** Medium  
* **Impact:** GC pressure, potential data loss (Matrix4 prototype lost)  
* **Evidence:** `appState.js:saveState()` lines 122–165. Called from `main.js` line 1189: `slider.addEventListener('mousedown', () => AppState.saveState())`. Uses `structuredClone(this.params)` which includes a `THREE.Matrix4` object.  
* **Why it's inefficient:**  
  1. `structuredClone` on `THREE.Matrix4` works (it has a `.elements` Float64Array), but the resulting clone loses the `Matrix4` prototype — it becomes a plain object with an `elements` property. This means `restoreState` silently restores a broken `planarProjMat`.  
  2. Every mousedown on ANY slider triggers a full state snapshot, even if the user just clicks without dragging.  
* **Recommended fix:**  
  1. Serialize `planarProjMat` as `Array.from(params.planarProjMat.elements)` and rehydrate in `restoreState` with `new THREE.Matrix4().fromArray(...)`.  
  2. Debounce or use `pointerdown` + `pointerup` to only save state if the slider value actually changed.  
* **Tradeoffs / Risks:** Changing the snapshot format requires updating both `saveState` and `restoreState`.  
* **Expected impact estimate:** Eliminates ~50% of wasted undo snapshots; fixes broken Matrix4 restoration.  
* **Removal Safety:** Needs Verification (undo/redo testing required)  
* **Reuse Scope:** `appState.js` / `main.js`

---

### F-06: `positions.slice()` Clones Entire Geometry in Worker

* **Category:** Memory  
* **Severity:** Medium  
* **Impact:** Peak memory usage during bake  
* **Evidence:** `displacement.worker.js` line 25: `const originalPositions = positions.slice()`. On a 5M-vertex mesh, `positions` is 60 MB → `slice()` allocates another 60 MB.  
* **Why it's inefficient:** The comment (F-09) explains this was chosen to halve transfer size vs. sending a separate `originalPositions` from the main thread. However, the clone is only needed for wall generation (lines 528–529). If walls are not generated (all-selected or none-selected), the clone is wasted.  
* **Recommended fix:** Defer the clone until after the early exit check (line 410). If `selFaceCount === 0 || selFaceCount === faceCount`, skip the clone entirely.  
* **Tradeoffs / Risks:** Minimal — just move the `slice()` call after the early return.  
* **Expected impact estimate:** Saves 60 MB peak memory when no walls are needed (common case for full-model bakes).  
* **Removal Safety:** Safe  
* **Reuse Scope:** `displacement.worker.js`

---

### F-07: Recursive `processTriangle` May Stack Overflow at High Depth

* **Category:** Reliability  
* **Severity:** Medium  
* **Impact:** Crash on deeply subdivided large triangles  
* **Evidence:** `displacement.worker.js` lines 999–1074. `MAX_DEPTH = 20`, meaning up to 20 recursive calls deep. Each call pushes ~60 float arguments + locals onto the stack. At depth 20, that's ~20 stack frames × ~500 bytes ≈ 10 KB per recursive chain — safe for a single chain, but with fan-out, the call tree can be very deep if many triangles cascade.  
* **Why it's inefficient:** JavaScript engines typically allow 10K–15K stack frames. With 20 levels of recursion and no tail-call optimization, this is near the limit. More practically, recursive calls prevent JIT optimization of the hot path.  
* **Recommended fix:** Convert to an **iterative stack** using an explicit `Float64Array` work queue. Push triangle vertex/normal data + depth onto the queue; process in a while loop.  
* **Tradeoffs / Risks:** Iterative version is slightly more complex to read but eliminates stack overflow risk entirely.  
* **Expected impact estimate:** Prevents rare crash; ~10% faster due to better JIT optimization of flat loops.  
* **Removal Safety:** Needs Verification  
* **Reuse Scope:** `displacement.worker.js`

---

### F-08: ViewCube Creates Temporary `Vector3` Objects Every Frame

* **Category:** Memory / GC  
* **Severity:** Low  
* **Impact:** GC pressure during continuous camera orbit  
* **Evidence:** `viewCube.js:update()` line 353: `const camDir = new THREE.Vector3()...` and `tweenMainCamera` lines 205–262 create multiple `new THREE.Vector3()` and `new THREE.Quaternion()` per animation frame.  
* **Why it's inefficient:** Allocating objects in the render loop causes GC spikes. Three.js recommends pre-allocating scratch vectors.  
* **Recommended fix:** Pre-allocate `_camDir`, `_qStart`, `_qEnd`, `_currentUp`, `_currentZ` as class properties. Reuse them in `update()` and tween methods.  
* **Tradeoffs / Risks:** None — standard Three.js best practice.  
* **Expected impact estimate:** Eliminates ~6 object allocations per frame during orbit/tween.  
* **Removal Safety:** Safe  
* **Reuse Scope:** `viewCube.js`

---

### F-09: `expandBuffers()` Doubles Allocation Without Upper Bound

* **Category:** Memory / Reliability  
* **Severity:** Medium  
* **Impact:** OOM crash during wall generation or remesh  
* **Evidence:**  
  - `displacement.worker.js` lines 468–477: `wPos.length * 2` with no cap.  
  - `displacement.worker.js` lines 947–952: `newPos.length * 2` with no cap.  
* **Why it's inefficient:** If initial allocation is too small and many expansions are needed, the doubling strategy can overshoot available memory. Each expansion also copies the entire existing buffer.  
* **Recommended fix:** Add a maximum allocation cap (e.g., `CRASH_PREVENTION_LIMIT * 9`) and throw a meaningful error if exceeded rather than crashing with an OOM.  
* **Tradeoffs / Risks:** Cap would need to be generous enough for legitimate large meshes.  
* **Expected impact estimate:** Prevents uncontrolled memory growth that leads to tab crashes.  
* **Removal Safety:** Safe  
* **Reuse Scope:** `displacement.worker.js`

---

### F-10: `_prevSelectedFaces` Creates a New `Set` on Every `updateVisuals`

* **Category:** Memory / GC  
* **Severity:** Low  
* **Impact:** GC pressure during rapid paint strokes  
* **Evidence:** `selection.js` line 649: `this._prevSelectedFaces = new Set(current)`. During paint mode, `updateVisuals(false)` is called on every pointermove, creating a new `Set(current)` each time. If `current` has 100K entries, this allocates a 100K-entry Set every ~16ms.  
* **Why it's inefficient:** The Set constructor iterates the source and inserts each element. On large selections, this is noticeable.  
* **Recommended fix:** Instead of cloning the entire Set, maintain a **dirty-face list** during paint strokes. Track which faces were added/removed in the current stroke, then apply only those deltas. Clear the dirty list on pointerup.  
* **Tradeoffs / Risks:** Slightly more complex state management. Need to handle edge cases where a face is toggled multiple times in one stroke.  
* **Expected impact estimate:** Eliminates O(N) Set construction per pointermove during paint.  
* **Removal Safety:** Needs Verification  
* **Reuse Scope:** `selection.js`

---

### F-11: Texture Blob URL Never Revoked

* **Category:** Memory / Resource Leak  
* **Severity:** Medium  
* **Impact:** Memory leak — each loaded texture retains a blob URL in memory  
* **Evidence:** `textureEngine.js:loadTexture()` line 556: `const url = URL.createObjectURL(file)`. The `URL.revokeObjectURL(url)` is never called after the texture loads.  
* **Why it's inefficient:** Each `createObjectURL` holds a reference to the file blob in memory. If the user loads multiple textures (e.g., trying different patterns), previous blobs are never freed.  
* **Recommended fix:** Call `URL.revokeObjectURL(url)` inside the `loader.load` success callback, after the texture is created.  
* **Tradeoffs / Risks:** None — Three.js TextureLoader copies the image data into a GPU texture; the blob URL is no longer needed after load.  
* **Expected impact estimate:** Prevents accumulating blob references (~1–50 MB per texture).  
* **Removal Safety:** Safe  
* **Reuse Scope:** `textureEngine.js`

---

### F-12: `setUI` / `updateSlider` Helper Duplicated 3 Times

* **Category:** Code Reuse  
* **Severity:** Low  
* **Impact:** Maintenance cost, bug surface  
* **Evidence:**  
  - `main.js:setUI()` inside preset click handler (lines 493–508)  
  - `main.js:updateSlider()` inside app-state-restored listener (lines 309–324)  
  - `main.js:setupSlider:updateFill()` (lines 1169–1176)  
  These three functions perform the same "set slider value, compute percent, update CSS custom properties" logic with slightly different signatures.  
* **Why it's inefficient:** Any bug fix or feature change (e.g., new slider property) must be replicated in 3 places. Drift risk is high.  
* **Recommended fix:** Extract a single `syncSliderUI(sliderId, value, isRot)` utility and call it from all three locations.  
* **Tradeoffs / Risks:** None — pure refactor.  
* **Expected impact estimate:** Reduces ~60 lines of duplicated code.  
* **Removal Safety:** Safe  
* **Reuse Scope:** `main.js`

---

### F-13: Duplicate `app-state-restored` Event Listener

* **Category:** Dead Code / Reliability  
* **Severity:** Low  
* **Impact:** Both listeners fire on every undo/redo, doing overlapping work  
* **Evidence:**  
  - `main.js` lines 197–239: First `app-state-restored` listener (updates buttons, sliders, poly count).  
  - `main.js` lines 306–366: Second `app-state-restored` listener (updates sliders, toggles, visuals, calls `checkApplyButtonState`).  
  Both update the same UI elements (sliders, buttons) with partially overlapping logic. The first one sets `texAmpInput` but not other sliders; the second one sets all sliders.  
* **Why it's inefficient:** Double DOM reads/writes on every undo/redo. Partially redundant state restoration. Risk of the two listeners fighting over element state.  
* **Recommended fix:** Merge into a single `app-state-restored` handler.  
* **Tradeoffs / Risks:** Need to verify that the combined handler covers all cases from both.  
* **Expected impact estimate:** Eliminates ~40 lines; prevents subtle ordering bugs.  
* **Removal Safety:** Needs Verification  
* **Reuse Scope:** `main.js`

---

### F-14: `animate()` Calls `controls.update()` Every Frame Even When Idle

* **Category:** CPU  
* **Severity:** Low  
* **Impact:** Continuous CPU wake-ups even when the app is idle  
* **Evidence:** `main.js` line 1603: `if (AppState.controls) AppState.controls.update()` runs on every `requestAnimationFrame`, regardless of whether the camera is moving or damping.  
* **Why it's inefficient:** When the user is not interacting, `controls.update()` still computes damping deltas (which are zero) and triggers `change` events (which set `needsRender = true`), causing an unnecessary render.  
* **Recommended fix:** Track whether controls are currently damping via `controls.addEventListener('start', ...)` and `controls.addEventListener('end', ...)`. Only call `controls.update()` while damping is active.  
* **Tradeoffs / Risks:** OrbitControls' damping requires continuous `update()` calls until settled. The `end` event fires too early in some Three.js versions. A safer approach: only call `update()` if the controls reported a change in the last frame OR if a tween is active.  
* **Expected impact estimate:** Reduces idle CPU from ~2–5% to ~0%.  
* **Removal Safety:** Needs Verification  
* **Reuse Scope:** `main.js`

---

### F-15: `getTextMaterial()` Checks Theme 3 Times via DOM Read

* **Category:** Frontend / CPU  
* **Severity:** Low  
* **Impact:** Repeated DOM attribute reads during ViewCube initialization  
* **Evidence:** `viewCube.js:getTextMaterial()` lines 71, 77, 82: `document.documentElement.getAttribute('data-theme')` is called 3 times per face label (6 faces × 3 reads = 18 DOM reads).  
* **Why it's inefficient:** DOM `getAttribute` is not free — it crosses the JS-DOM boundary.  
* **Recommended fix:** Cache the theme value once at the top of `getTextMaterial`:
  ```js
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  ```
* **Tradeoffs / Risks:** None.  
* **Expected impact estimate:** Negligible individually, but good practice.  
* **Removal Safety:** Safe  
* **Reuse Scope:** `viewCube.js`

---

### F-16: STL Export Creates Synchronous Blob on Main Thread

* **Category:** I/O / Latency  
* **Severity:** Medium  
* **Impact:** UI freeze during export of large meshes  
* **Evidence:** `main.js` lines 1059–1079. `exporter.parse(AppState.mesh, { binary: true })` runs synchronously on the main thread, blocking the UI for the duration of the serialization. For a 5M-triangle mesh, this could take 2–5 seconds.  
* **Why it's inefficient:** The main thread is blocked during serialization, making the app appear frozen.  
* **Recommended fix:** Move STL serialization to a Web Worker. Send the position/normal Float32Arrays via transferable; construct the binary STL in the worker; transfer the resulting ArrayBuffer back; create the Blob on the main thread.  
* **Tradeoffs / Risks:** Requires a new worker or reusing the existing displacement worker with a `task: 'export'` message type.  
* **Expected impact estimate:** Eliminates 2–5s UI freeze during export.  
* **Removal Safety:** N/A (new feature)  
* **Reuse Scope:** `main.js` / new worker task

---

### F-17: `console.time` / `console.log` Left in Production Worker Code

* **Category:** I/O / Build  
* **Severity:** Low  
* **Impact:** Minor performance overhead; console noise in production  
* **Evidence:** `displacement.worker.js` has 15+ `console.time`/`console.timeEnd`/`console.log` calls scattered throughout the worker.  
* **Why it's inefficient:** Each `console.time`/`timeEnd` call has overhead (~0.01ms each) and will clutter the console in production. More importantly, `console.log` with string interpolation forces string construction even when the console is not open.  
* **Recommended fix:** Gate behind a `DEBUG` flag or strip in production build: `const DEBUG = false; if (DEBUG) console.time(...)`.  
* **Tradeoffs / Risks:** Losing debug info during development. Solution: use build-time dead code elimination.  
* **Expected impact estimate:** Marginal CPU savings; cleaner production console.  
* **Removal Safety:** Safe  
* **Reuse Scope:** `displacement.worker.js`

---

### F-18: `cross()` Helper Returns Object Literal in Hot Loop

* **Category:** Memory / GC  
* **Severity:** Low  
* **Impact:** Object allocation in wall generation loop  
* **Evidence:** `displacement.worker.js` line 480-482: `const cross = (ax, ay, az, bx, by, bz) => { return { x: ..., y: ..., z: ... }; }`. Called once per boundary edge in the wall generation loop (potentially 100K+ times).  
* **Why it's inefficient:** Each call allocates a new object `{ x, y, z }`. V8 can optimize this with hidden classes, but the GC pressure remains for 100K+ allocations.  
* **Recommended fix:** Use a pre-allocated reusable result object: `const _cross = { x: 0, y: 0, z: 0 };` and mutate it inside the function.  
* **Tradeoffs / Risks:** Caller must use the result immediately before the next call (which is always the case here).  
* **Expected impact estimate:** Eliminates ~100K short-lived allocations during wall generation.  
* **Removal Safety:** Safe  
* **Reuse Scope:** `displacement.worker.js`

---

### F-19: `selectAll()` Loops to Add Every Face Index to a Set

* **Category:** Algorithm  
* **Severity:** Low  
* **Impact:** O(N) for trivial "select everything" operation  
* **Evidence:** `selection.js` lines 701–703:
  ```js
  for (let i = 0; i < faceCount; i++) { AppState.selectedFaces.add(i); }
  ```
  For 5M faces, this creates 5M Set entries one at a time.  
* **Why it's inefficient:** A Set with 5M integer entries uses ~160 MB of memory. A `Uint8Array(faceCount)` bitfield would use 5 MB.  
* **Recommended fix:** Consider replacing `selectedFaces: Set` with a `Uint8Array` bitfield for selection state. `selectAll()` becomes `selectionBits.fill(1)` (O(1) amortized). `has(i)` becomes `selectionBits[i] === 1` (O(1)). `add(i)` becomes `selectionBits[i] = 1` (O(1)). The Set overhead is 30× higher than a typed array.  
* **Tradeoffs / Risks:** Major refactor across `appState.js`, `selection.js`, `remesh.js`, `main.js`. Requires replacing all `.has()`, `.add()`, `.delete()`, `.size`, `for...of` patterns. High effort but high payoff.  
* **Expected impact estimate:** 30× less memory for selection state; O(1) selectAll/clearAll.  
* **Removal Safety:** Needs Verification  
* **Reuse Scope:** Service-wide (every module touches `selectedFaces`)

---

### F-20: Theme Change Doesn't Rebuild ViewCube Textures

* **Category:** Frontend / Correctness  
* **Severity:** Low  
* **Impact:** ViewCube labels stay in old theme colors after toggle  
* **Evidence:** `viewCube.js:getTextMaterial()` reads theme at construction time (line 71). `main.js` theme toggle (line 800) changes `data-theme` but never re-initializes ViewCube materials.  
* **Why it's inefficient:** Not a performance issue but a visual bug. Including here because the fix intersects with F-15 (caching theme reads).  
* **Recommended fix:** Listen for theme changes in `ViewCube` and rebuild materials, or generate both theme variants at init and swap.  
* **Tradeoffs / Risks:** Rebuilding creates 6 new canvas textures; minimal cost (~10ms).  
* **Expected impact estimate:** Fixes visual bug.  
* **Removal Safety:** Safe  
* **Reuse Scope:** `viewCube.js`

---

### F-21: `remesh.js` Reads Poly Limit from DOM on Every Refine Call

* **Category:** I/O / Architecture  
* **Severity:** Low  
* **Impact:** Cross-boundary DOM read in computation path  
* **Evidence:** `remesh.js` lines 74–75:
  ```js
  const polyLimitSlider = document.getElementById('polyLimit');
  const polyLimitVal = polyLimitSlider ? parseInt(polyLimitSlider.value) * 1000000 : 5000000;
  ```
  Same pattern repeated in `finalizeUI()` lines 250–251.  
* **Why it's inefficient:** DOM reads are slow compared to reading from AppState. This also tightly couples the computation module to the DOM structure.  
* **Recommended fix:** Store `polyLimit` in `AppState.params` (synced by the slider's `input` handler). Read from AppState instead of DOM.  
* **Tradeoffs / Risks:** Requires adding `polyLimit` to AppState params and updating the slider handler.  
* **Expected impact estimate:** Marginal speed improvement; better architecture.  
* **Removal Safety:** Safe  
* **Reuse Scope:** `remesh.js` / `main.js`

---

### F-22: Triplanar Sampling Calls `Math.pow()` with Non-Integer Exponent in Hot Loop

* **Category:** CPU  
* **Severity:** Low  
* **Impact:** Minor CPU overhead in displacement loop  
* **Evidence:** `displacement.worker.js` lines 364–366:
  ```js
  let bx = Math.pow(absNormX / maxNorm, p);
  ```
  where `p = 4.0 + sharpness` (typically 14–24). `Math.pow` with non-integer exponent is slower than repeated multiplication.  
* **Why it's inefficient:** For integer exponents, exponentiation by squaring is faster. For typical sharpness values, `p` is an integer.  
* **Recommended fix:** If `p` is guaranteed integer, replace with a custom `intPow(base, exp)` using squaring. Otherwise, keep `Math.pow` — the JIT handles it reasonably.  
* **Tradeoffs / Risks:** Only worth it if sharpness is always integer-valued (it is, based on slider configuration: step=1, range 0–20).  
* **Expected impact estimate:** ~5% faster triplanar sampling.  
* **Removal Safety:** Safe  
* **Reuse Scope:** `displacement.worker.js`

---

### F-23: Undo/Redo Geometry Clones Are Never Disposed on Stack Clear

* **Category:** Memory / Resource Leak  
* **Severity:** Medium  
* **Impact:** GPU memory leak  
* **Evidence:** `appState.js` line 163: `this.redoStack = []` discards the redo stack without disposing any contained `geometry` objects. Same on line 203. Only `undoStack.shift()` (line 198) disposes the dropped item.  
* **Why it's inefficient:** `BufferGeometry.dispose()` must be called to free GPU-side buffers. Setting `redoStack = []` orphans any geometry objects, leaking GPU memory.  
* **Recommended fix:** Before clearing the redo stack, iterate and dispose:
  ```js
  this.redoStack.forEach(s => { if (s.geometry) s.geometry.dispose(); });
  this.redoStack = [];
  ```
* **Tradeoffs / Risks:** None.  
* **Expected impact estimate:** Prevents GPU memory leak (~50–200 MB per bake undo cycle).  
* **Removal Safety:** Safe  
* **Reuse Scope:** `appState.js`

---

### F-24: `loadSTL` is `async` but Never `await`s Anything

* **Category:** Dead Code / Maintainability  
* **Severity:** Low  
* **Impact:** Misleading API  
* **Evidence:** `loader.js` line 10: `async loadSTL(file, onProgress, onError)` — the function body uses callback-based `this.loader.load(url, callback)` and never uses `await`.  
* **Why it's inefficient:** The `async` keyword is misleading. Callers might `await` it expecting the load to complete, but it returns a resolved promise immediately (before the STL finishes loading).  
* **Recommended fix:** Either remove `async` or convert the internal callback to a proper Promise with `await`.  
* **Tradeoffs / Risks:** If callers are already fire-and-forget, removing `async` is safe. If any caller awaits this, converting to Promise is needed.  
* **Expected impact estimate:** Code clarity only.  
* **Removal Safety:** Likely Safe  
* **Reuse Scope:** `loader.js`

---

## 3) Quick Wins (Do First)

| # | Finding | Time | Impact |
|---|---------|------|--------|
| 1 | **F-11:** Revoke texture blob URL after load | 1 line | Fixes memory leak |
| 2 | **F-23:** Dispose redo stack geometries before clearing | 3 lines | Fixes GPU memory leak |
| 3 | **F-06:** Defer `positions.slice()` after early exit check | Move 1 line | Saves 60 MB in common case |
| 4 | **F-18:** Pre-allocate `cross()` result object | 5 lines | Eliminates 100K+ heap allocs |
| 5 | **F-15:** Cache theme attribute in `getTextMaterial` | 2 lines | Eliminates 18 DOM reads |
| 6 | **F-17:** Gate console timing behind DEBUG flag | 15 lines | Cleaner production |
| 7 | **F-12:** Extract shared `syncSliderUI` helper | ~30 min | Eliminates 60 lines duplication |
| 8 | **F-08:** Pre-allocate ViewCube scratch vectors | 10 lines | Eliminates per-frame GC |

---

## 4) Deeper Optimizations (Do Next)

| # | Finding | Effort | Impact |
|---|---------|--------|--------|
| 1 | **F-01:** Add BVH for paint stroke spatial queries | 2–4 hrs | 10–100× faster paint on large meshes |
| 2 | **F-04:** Replace BigInt edge keys with Uint32 pair sort | 2–3 hrs | 3–10× faster edge processing |
| 3 | **F-03:** Extract shared vertex weld utility | 1–2 hrs | ~40% faster worker pre-computation |
| 4 | **F-19:** Replace `Set` selection with `Uint8Array` bitfield | 4–8 hrs | 30× less memory; O(1) selectAll |
| 5 | **F-07:** Convert recursive subdivision to iterative stack | 2–3 hrs | Eliminates stack overflow risk; ~10% faster |
| 6 | **F-16:** Move STL export to Web Worker | 2–3 hrs | Eliminates 2–5s UI freeze |
| 7 | **F-02:** Replace `.includes()` with fixed-degree array in adjacency | 1–2 hrs | 2–5× faster adjacency build |
| 8 | **F-05:** Fix Matrix4 serialization in undo/redo | 1 hr | Fixes broken projection matrix restoration |
| 9 | **F-10:** Track dirty faces during paint instead of cloning Set | 2 hrs | Eliminates O(N) Set construction per stroke |

---

## 5) Validation Plan

### Benchmarks
1. **Paint Stroke Latency:**  
   - Load a 5M-triangle mesh, select all, enable paint mode  
   - Measure `performance.now()` delta per `processPaintStroke()` call  
   - Target: <10ms per stroke event (currently likely 50–200ms)

2. **Worker Bake Duration:**  
   - Load Benchy model, select top surface, set poly limit to 5M  
   - Measure `console.time("Worker: Pre-computation / Quantization")` and `"Worker: Displacement Loop"` and `"Worker: Wall Generation"`  
   - Target: <20% improvement after F-03 and F-04

3. **Memory Profile:**  
   - Use Chrome DevTools Memory tab  
   - Load texture → bake → undo → redo → load new texture → bake  
   - Check for retained Blobs (F-11) and orphaned BufferGeometries (F-23)  
   - Target: 0 retained blobs; 0 orphaned geometries after full cycle

### Profiling Strategy
- **CPU:** Chrome DevTools Performance tab → Record during bake pipeline → identify longest tasks
- **Memory:** Heap snapshots before/after bake cycle → diff retained objects
- **Worker:** Use `performance.now()` in worker `postMessage` round-trip timing

### Metrics to Compare Before/After
| Metric | Baseline | Target |
|--------|----------|--------|
| Paint stroke latency (5M mesh) | ~100ms | <10ms |
| Worker pre-computation time | measured | -40% |
| Peak memory during bake (5M mesh) | measured | -30% |
| Idle CPU % | ~2–5% | <0.5% |
| Undo/redo memory leak | present | 0 |

### Test Cases for Correctness
1. **Bake correctness:** Bake with triplanar/spherical/cylindrical → export STL → import in slicer → verify no inverted normals
2. **Undo/redo cycle:** Slider change → undo → redo → verify params restored exactly (including `planarProjMat`)
3. **Selection consistency:** Select all → clear → select subset → paint → verify `selectedFaces` matches visual
4. **Wall generation:** Partial selection on Benchy → bake → verify walls are manifold in slicer
5. **Edge cases:** Single-triangle selection, entire-mesh selection, empty selection → verify no crashes

---

## 6) Optimized Code / Patches

### Patch 1: Fix Texture Blob URL Leak (F-11)

**File:** `src/textureEngine.js`  
```diff
 loader.load(url, (tex) => {
+    URL.revokeObjectURL(url);
     tex.wrapS = THREE.RepeatWrapping;
```

---

### Patch 2: Dispose Redo Stack Geometries (F-23)

**File:** `src/appState.js`  
```diff
-    this.redoStack = [];
+    this.redoStack.forEach(s => { if (s.geometry) s.geometry.dispose(); });
+    this.redoStack = [];
```
Apply at both line 163 and line 203.

---

### Patch 3: Defer `positions.slice()` (F-06)

**File:** `src/displacement.worker.js`  
```diff
-    // F-09: Clone positions here in the worker before mutation.
-    const originalPositions = positions.slice();
     ...
     // --- 2. WALL GENERATION ---
+    // F-09: Clone positions here — only needed when walls will actually be generated.
+    const originalPositions = positions.slice();
```
Move the clone from line 25 to just before line 407 (after the early exit checks at lines 410–417).

---

### Patch 4: Pre-allocate Cross Product Result (F-18)

**File:** `src/displacement.worker.js`  
```diff
-    const cross = (ax, ay, az, bx, by, bz) => {
-        return { x: ay * bz - az * by, y: az * bx - ax * bz, z: ax * by - ay * bx };
-    };
+    const _crossResult = { x: 0, y: 0, z: 0 };
+    const cross = (ax, ay, az, bx, by, bz) => {
+        _crossResult.x = ay * bz - az * by;
+        _crossResult.y = az * bx - ax * bz;
+        _crossResult.z = ax * by - ay * bx;
+        return _crossResult;
+    };
```

---

### Patch 5: Cache Theme in ViewCube (F-15)

**File:** `src/viewCube.js`  
```diff
 getTextMaterial(text) {
     const canvas = document.createElement('canvas');
     canvas.width = 256;
     canvas.height = 256;
     const ctx = canvas.getContext('2d');
+    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
     
-    ctx.fillStyle = '#e6e9ec'; 
-    if (document.documentElement.getAttribute('data-theme') === 'dark') {
-        ctx.fillStyle = '#2a2d30';
-    }
+    ctx.fillStyle = isDark ? '#2a2d30' : '#e6e9ec';
     ctx.fillRect(0, 0, 256, 256);

-    ctx.strokeStyle = document.documentElement.getAttribute('data-theme') === 'dark' ? '#555' : '#b0b8c0';
+    ctx.strokeStyle = isDark ? '#555' : '#b0b8c0';
     ctx.lineWidth = 12;
     ctx.strokeRect(0, 0, 256, 256);

-    ctx.fillStyle = document.documentElement.getAttribute('data-theme') === 'dark' ? '#eee' : '#556677';
+    ctx.fillStyle = isDark ? '#eee' : '#556677';
```

---

### Patch 6: Revoke STL Blob URL in Loader (Already Done — Verification)

**File:** `src/loader.js` — Line 74 already has `URL.revokeObjectURL(url)`. ✓ Correct.

---

*End of Optimization Audit.*
