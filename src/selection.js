import * as THREE from 'three';
import AppState from './appState.js';
import { translations } from './translations.js';

export class SelectionModule {
    constructor() {
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Cache for Adjacency Graph
        this.adjacencyGraph = null;

        // F-01 Optimization: Spatial hash grid for O(k) paint stroke queries
        this.spatialGrid = null;

        // Color constants
        this.baseColor = new THREE.Color(0x888888);
        this.selectedColor = new THREE.Color(0x0088FF); // Vibrant Blue
        // F-08: track previous selection state for delta-only updateVisuals()
        this._prevSelectedFaces = new Set();

        this.isLocked = false;

        // Paint Mode Internal State
        this.isPainting = false;
        this.isErasing = false;
        this.isLeftMouseDown = false;

        // 3D Brush Cursor
        this.brushCursor = null;

        // Track key states via keydown/up (to allow E + Click or Click + E)
        this.eKeyHeld = false;
        this.rKeyHeld = false;
    }

    initEvents(container) {
        container.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        container.addEventListener('pointerup', (e) => this.onPointerUp(e));
        container.addEventListener('pointermove', (e) => this.onPointerMove(e));

        // Keyboard tracking for Paint Mode
        window.addEventListener('keydown', (e) => {
            if (e.key === 'e' || e.key === 'E') this.eKeyHeld = true;
            if (e.key === 'r' || e.key === 'R') this.rKeyHeld = true;
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === 'e' || e.key === 'E') this.eKeyHeld = false;
            if (e.key === 'r' || e.key === 'R') this.rKeyHeld = false;
        });

        // Lock Toggle Listener
        const lockToggle = document.getElementById('lockSelectionToggle');
        if (lockToggle) {
            lockToggle.addEventListener('change', (e) => {
                this.isLocked = e.target.checked;
                // Optional: visual feedback or disable other controls?
                // For now, we just block logic.

                // Disable/Enable Refine & Clear Buttons based on lock
                const clearBtn = document.getElementById('clearSelectionBtn');
                const selectAllBtn = document.getElementById('selectAllBtn');
                const paintModeToggle = document.getElementById('paintModeToggle');
                const paintModeContainer = document.getElementById('paintModeContainer');

                if (this.isLocked) {
                    if (clearBtn) clearBtn.disabled = true;
                    if (selectAllBtn) selectAllBtn.disabled = true;
                    if (paintModeToggle) {
                        paintModeToggle.disabled = true;
                        // Force disable paint mode if it was active
                        if (AppState.params.paintModeActive) {
                            paintModeToggle.checked = false;
                            AppState.params.paintModeActive = false;
                            if (this.brushCursor) this.brushCursor.visible = false;
                        }
                    }
                    if (paintModeContainer) paintModeContainer.style.opacity = '0.5';
                } else {
                    if (clearBtn) clearBtn.disabled = false;
                    if (selectAllBtn) selectAllBtn.disabled = false;
                    if (paintModeToggle) paintModeToggle.disabled = false;
                    if (paintModeContainer) paintModeContainer.style.opacity = '1';
                }
            });
        }

        // Listen to threshold changes
        const slider = document.getElementById('angleThreshold');
        const bubble = document.getElementById('angleBubble');

        const updateSliderVisuals = (val) => {
            // Min 1, Max 90
            const min = 1;
            const max = 90;
            const percent = ((val - min) / (max - min)) * 100;

            // Update CSS variable on wrapper
            const wrapper = slider.closest('.range-slider-wrapper');
            if (wrapper) {
                wrapper.style.setProperty('--val-percent', percent + '%');
            }

            // Update Bubble Text
            if (bubble) bubble.innerText = val + '°';

            // Update Bubble Position (optional fine tuning if CSS isn't enough)
            // handled by left: var(--val-percent) in CSS
        };

        if (slider) {
            // Initial State
            updateSliderVisuals(slider.value);

            slider.addEventListener('input', (e) => {
                const val = parseInt(e.target.value);
                AppState.params.angleThreshold = val;
                updateSliderVisuals(val);
            });
        }

        // UI Feedback: Gray out Angle Threshold, Toggle Smart Fill param
        const smartToggle = document.getElementById('smartFillToggle');
        const thresholdContainer = slider?.closest('.control-row');

        const updateUI = () => {
            const isActive = smartToggle ? smartToggle.checked : false;
            AppState.params.selectionMode = isActive;

            if (thresholdContainer) {
                if (!isActive) {
                    thresholdContainer.style.opacity = '0.4';
                    thresholdContainer.style.pointerEvents = 'none';
                } else {
                    thresholdContainer.style.opacity = '1';
                    thresholdContainer.style.pointerEvents = 'auto';
                }
            }
        };

        if (smartToggle) {
            smartToggle.addEventListener('change', updateUI);
            // Init default state
            // Force the checkbox to match AppState or vice versa? 
            // Let's assume AppState follows UI.
            updateUI();
        }

        const warningDiv = document.getElementById('selectionWarning');
        let warningTimeout;

        const showWarning = (msg) => {
            if (warningDiv) {
                warningDiv.innerText = msg;

                // Reset Animation: Remove classes, force reflow
                warningDiv.classList.remove('show', 'hide');
                void warningDiv.offsetWidth; // Trigger reflow

                // Start Entrance
                warningDiv.classList.add('show');

                if (warningTimeout) clearTimeout(warningTimeout);

                // Schedule Exit
                warningTimeout = setTimeout(() => {
                    warningDiv.classList.replace('show', 'hide');
                    // Note: We don't set display:none explicitly after animation to allow reuse, 
                    // but CSS keeps it invisible at end of fadeOut.
                }, 3000);
            }
        };


        const clearBtn = document.getElementById('clearSelectionBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                // Visual Effect (0.7s) - Trigger immediately
                clearBtn.classList.add('clicked');
                setTimeout(() => {
                    clearBtn.classList.remove('clicked');
                    clearBtn.blur();
                }, 700);

                if (!AppState.mesh) {
                    showWarning(translations[AppState.currentLang || 'en'].loadStlFirst);
                    return;
                }

                if (AppState.selectedFaces.size === 0) {
                    showWarning(translations[AppState.currentLang || 'en'].selectFacesFirst);
                    return;
                }

                // SAVE STATE
                AppState.saveState();

                this.clearAll();
            });
        }

        const selectAllBtn = document.getElementById('selectAllBtn');
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => {
                // SAVE STATE (inside selectAll? No, better here or inside?)
                // selectAll() implementation checks for mesh.
                // We should check mesh first to avoid empty saves.
                if (AppState.mesh) AppState.saveState();

                // Visual Effect (1s)
                selectAllBtn.classList.add('clicked');
                setTimeout(() => {
                    selectAllBtn.classList.remove('clicked');
                    selectAllBtn.blur();
                }, 700);

                this.selectAll();
            });
        }

        // Initialize 3D Brush Cursor
        this.initBrushCursor();
    }

    initBrushCursor() {
        const geometry = new THREE.RingGeometry(0.9, 1.0, 32);

        const material = new THREE.MeshBasicMaterial({
            color: 0x0088ff,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8,
            depthTest: false
        });
        this.brushCursor = new THREE.Mesh(geometry, material);
        this.brushCursor.visible = false;
        this.brushCursor.renderOrder = 999;

        if (AppState.scene) {
            AppState.scene.add(this.brushCursor);
        }
    }

    onPointerDown(event) {
        if (!AppState.isMeshReady()) return;
        if (event.target.closest('.sidebar') || event.target.closest('.preset-popover')) return;
        if (this.isLocked) return;

        // Left Click Tracking
        if (event.button === 0) {
            this.isLeftMouseDown = true;

            // Start Paint/Erase strokes if Paint Mode is active and keys are held
            if (AppState.params.paintModeActive) {
                if (this.eKeyHeld) {
                    this.isPainting = true;
                    this.disableOrbitControls();
                    AppState.saveState(); // Snapshot once before stroke
                } else if (this.rKeyHeld) {
                    this.isErasing = true;
                    this.disableOrbitControls();
                    AppState.saveState(); // Snapshot once before stroke
                }
            }
        }

        // Standard Selection (Non-Paint) only requires left click
        if (!AppState.params.paintModeActive && event.button === 0) {
            this.updateMouse(event);
            this.raycaster.setFromCamera(this.mouse, AppState.camera);
            const intersects = this.raycaster.intersectObject(AppState.mesh);

            if (intersects.length > 0) {
                const hit = intersects[0];
                const faceIndex = hit.faceIndex;

                if (faceIndex !== undefined) {
                    AppState.saveState();
                    const isSelected = AppState.selectedFaces.has(faceIndex);
                    const shouldSelect = !isSelected;

                    if (AppState.params.selectionMode) {
                        this.performSmartFill(faceIndex, shouldSelect);
                    } else {
                        if (shouldSelect) AppState.selectedFaces.add(faceIndex);
                        else AppState.selectedFaces.delete(faceIndex);
                    }
                    this.updateVisuals();
                    document.getElementById('selectedCount').innerText = AppState.selectedFaces.size;
                    if (AppState.textureEngine) AppState.textureEngine.updateProjectionBasis(AppState.mesh);
                }
            }
        }

        // If painting started instantly on click
        if (this.isPainting || this.isErasing) {
            this.processPaintStroke(event);
        }
    }

    onPointerUp(event) {
        if (event.button === 0) {
            this.isLeftMouseDown = false;
            this.isPainting = false;
            this.isErasing = false;
            this.enableOrbitControls();
        }
    }

    onPointerMove(event) {
        if (!AppState.isMeshReady()) return;

        this.updateMouse(event);
        this.raycaster.setFromCamera(this.mouse, AppState.camera);

        // Handle 3D Brush Cursor visibility and position
        if (AppState.params.paintModeActive) {
            const intersects = this.raycaster.intersectObject(AppState.mesh);
            if (intersects.length > 0) {
                const hit = intersects[0];

                // Align brush to surface normal
                if (this.brushCursor) {
                    this.brushCursor.visible = true;
                    this.brushCursor.position.copy(hit.point);
                    // Slight offset to prevent z-fighting
                    this.brushCursor.position.addScaledVector(hit.face.normal, 0.1);

                    // Look at normal
                    const target = hit.point.clone().add(hit.face.normal);
                    this.brushCursor.lookAt(target);

                    // Scale brush
                    const scale = AppState.params.paintBrushSize;
                    this.brushCursor.scale.set(scale, scale, scale);
                }
            } else if (this.brushCursor) {
                this.brushCursor.visible = false;
            }
            AppState.markDirty(); // Need render for cursor movement
        } else if (this.brushCursor && this.brushCursor.visible) {
            this.brushCursor.visible = false;
            AppState.markDirty();
        }

        // Handle Continuous Paint Stroke
        if ((this.isPainting || this.isErasing) && this.isLeftMouseDown) {
            this.processPaintStroke(event);
        }
    }

    processPaintStroke(event) {
        const intersects = this.raycaster.intersectObject(AppState.mesh);
        if (intersects.length > 0) {
            const hit = intersects[0];
            const size = AppState.params.paintBrushSize;
            const isAdding = this.isPainting;

            this.performRadiusFill(hit.point, hit.face.normal, size, isAdding);
            this.updateVisuals(false); // fast delta update

            const countEl = document.getElementById('selectedCount');
            if (countEl) countEl.innerText = AppState.selectedFaces.size;
        }
    }

    updateMouse(event) {
        const rect = AppState.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    disableOrbitControls() {
        if (AppState.controls) {
            AppState.controls.enableRotate = false;
            AppState.controls.enablePan = false;
        }
    }

    enableOrbitControls() {
        if (AppState.controls) {
            AppState.controls.enableRotate = true;
            AppState.controls.enablePan = true;
        }
    }

    /**
     * F-01 Optimization: Build a spatial hash grid over face centroids.
     * Cells are sized to the mesh's bounding sphere / 50 (or a minimum of brush size).
     * Face indices are stored in a flat Int32Array with an offset table for O(1) cell lookup.
     */
    buildSpatialGrid() {
        if (!AppState.mesh) return null;
        const positions = AppState.mesh.geometry.attributes.position.array;
        const faceCount = positions.length / 9;
        if (faceCount === 0) return null;

        // 1. Compute all centroids and determine bounds
        const cx = new Float32Array(faceCount);
        const cy = new Float32Array(faceCount);
        const cz = new Float32Array(faceCount);

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (let i = 0; i < faceCount; i++) {
            const idx = i * 9;
            const centX = (positions[idx] + positions[idx + 3] + positions[idx + 6]) / 3;
            const centY = (positions[idx + 1] + positions[idx + 4] + positions[idx + 7]) / 3;
            const centZ = (positions[idx + 2] + positions[idx + 5] + positions[idx + 8]) / 3;
            cx[i] = centX; cy[i] = centY; cz[i] = centZ;
            if (centX < minX) minX = centX; if (centX > maxX) maxX = centX;
            if (centY < minY) minY = centY; if (centY > maxY) maxY = centY;
            if (centZ < minZ) minZ = centZ; if (centZ > maxZ) maxZ = centZ;
        }

        // 2. Determine cell size: target ~50 cells per axis (capped at 100 to limit memory)
        const spanX = maxX - minX || 1;
        const spanY = maxY - minY || 1;
        const spanZ = maxZ - minZ || 1;
        const maxSpan = Math.max(spanX, spanY, spanZ);
        const cellSize = Math.max(maxSpan / 50, 0.001); // avoid degenerate zero-size cells
        const invCell = 1.0 / cellSize;

        const gridNx = Math.ceil(spanX * invCell) + 1;
        const gridNy = Math.ceil(spanY * invCell) + 1;
        const gridNz = Math.ceil(spanZ * invCell) + 1;

        // Safety: if grid would have > 5M cells, fall back to coarser grid
        const totalCells = gridNx * gridNy * gridNz;
        let actualCellSize = cellSize;
        let actualInvCell = invCell;
        let nx = gridNx, ny = gridNy, nz = gridNz;
        if (totalCells > 5000000) {
            actualCellSize = maxSpan / 20;
            actualInvCell = 1.0 / actualCellSize;
            nx = Math.ceil(spanX * actualInvCell) + 1;
            ny = Math.ceil(spanY * actualInvCell) + 1;
            nz = Math.ceil(spanZ * actualInvCell) + 1;
        }

        // 3. Count faces per cell
        const cellCount = nx * ny * nz;
        const counts = new Int32Array(cellCount);

        const cellOf = (x, y, z) => {
            const ix = Math.floor((x - minX) * actualInvCell);
            const iy = Math.floor((y - minY) * actualInvCell);
            const iz = Math.floor((z - minZ) * actualInvCell);
            return ix * ny * nz + iy * nz + iz;
        };

        for (let i = 0; i < faceCount; i++) {
            counts[cellOf(cx[i], cy[i], cz[i])]++;
        }

        // 4. Compute offsets (prefix sum)
        const offsets = new Int32Array(cellCount + 1);
        for (let i = 0; i < cellCount; i++) {
            offsets[i + 1] = offsets[i] + counts[i];
        }

        // 5. Fill face indices into flat array
        const indices = new Int32Array(faceCount);
        const writePos = new Int32Array(cellCount); // current write position per cell

        for (let i = 0; i < faceCount; i++) {
            const cell = cellOf(cx[i], cy[i], cz[i]);
            indices[offsets[cell] + writePos[cell]] = i;
            writePos[cell]++;
        }

        return {
            cx, cy, cz,
            indices, offsets,
            cellSize: actualCellSize,
            invCell: actualInvCell,
            minX, minY, minZ,
            nx, ny, nz
        };
    }

    performRadiusFill(centerPoint, centerNormal, radius, isAdding) {
        if (!AppState.mesh) return;
        const geometry = AppState.mesh.geometry;
        const normals = geometry.attributes.normal.array;

        const rSq = radius * radius;
        const angleThresh = AppState.params.paintAngleThreshold * (Math.PI / 180);
        const dotThresh = Math.cos(angleThresh);

        const ignoreBackfacing = AppState.params.paintIgnoreBackfacing;
        const viewVec = new THREE.Vector3().subVectors(AppState.camera.position, centerPoint).normalize();
        const fNormal = new THREE.Vector3();

        // F-01: Lazily build spatial grid on first paint stroke
        if (!this.spatialGrid) {
            this.spatialGrid = this.buildSpatialGrid();
        }
        const grid = this.spatialGrid;
        if (!grid) return; // no geometry

        // Determine which grid cells overlap the brush sphere
        const cpx = centerPoint.x, cpy = centerPoint.y, cpz = centerPoint.z;
        const ixMin = Math.max(0, Math.floor((cpx - radius - grid.minX) * grid.invCell));
        const iyMin = Math.max(0, Math.floor((cpy - radius - grid.minY) * grid.invCell));
        const izMin = Math.max(0, Math.floor((cpz - radius - grid.minZ) * grid.invCell));
        const ixMax = Math.min(grid.nx - 1, Math.floor((cpx + radius - grid.minX) * grid.invCell));
        const iyMax = Math.min(grid.ny - 1, Math.floor((cpy + radius - grid.minY) * grid.invCell));
        const izMax = Math.min(grid.nz - 1, Math.floor((cpz + radius - grid.minZ) * grid.invCell));

        // Iterate only over cells that could contain faces within the brush radius
        for (let ix = ixMin; ix <= ixMax; ix++) {
            for (let iy = iyMin; iy <= iyMax; iy++) {
                for (let iz = izMin; iz <= izMax; iz++) {
                    const cell = ix * grid.ny * grid.nz + iy * grid.nz + iz;
                    const start = grid.offsets[cell];
                    const end = grid.offsets[cell + 1];

                    for (let j = start; j < end; j++) {
                        const i = grid.indices[j];

                        // Distance check using pre-computed centroid
                        const dx = grid.cx[i] - cpx;
                        const dy = grid.cy[i] - cpy;
                        const dz = grid.cz[i] - cpz;
                        if (dx * dx + dy * dy + dz * dz > rSq) continue;

                        // Angle + backface checks (unchanged logic)
                        const nIdx = i * 9;
                        fNormal.set(normals[nIdx], normals[nIdx + 1], normals[nIdx + 2]);

                        if (ignoreBackfacing && fNormal.dot(viewVec) < 0) continue;
                        if (fNormal.dot(centerNormal) < dotThresh) continue;

                        if (isAdding) {
                            AppState.selectedFaces.add(i);
                        } else {
                            AppState.selectedFaces.delete(i);
                        }
                    }
                }
            }
        }
    }

    performSmartFill(startIndex, shouldSelect) {
        if (!AppState.mesh) return;
        const geometry = AppState.mesh.geometry;
        const normals = geometry.attributes.normal;

        // 1. Build Adjacency (Lazy)
        if (!this.adjacencyGraph) {
            this.adjacencyGraph = this.buildAdjacency(geometry);
        }

        // 2. BFS Flood Fill
        const visited = new Set();
        const queue = [startIndex];

        const startNormal = new THREE.Vector3();
        startNormal.fromBufferAttribute(normals, startIndex * 3);

        const thresholdAngle = AppState.params.angleThreshold * (Math.PI / 180);
        const thresholdDot = Math.cos(thresholdAngle);

        // Process Start Node
        visited.add(startIndex);
        if (shouldSelect) {
            AppState.selectedFaces.add(startIndex);
        } else {
            AppState.selectedFaces.delete(startIndex);
        }

        const tempNormal = new THREE.Vector3();

        let head = 0;
        while (head < queue.length) {
            const currentIdx = queue[head++];
            const neighbors = this.adjacencyGraph[currentIdx];

            if (!neighbors) continue;

            for (let neighborIdx of neighbors) {
                if (!visited.has(neighborIdx)) {
                    visited.add(neighborIdx);

                    // Check Normal Similarity
                    tempNormal.fromBufferAttribute(normals, neighborIdx * 3);

                    // Connected & Planar check
                    if (tempNormal.dot(startNormal) >= thresholdDot) {
                        if (shouldSelect) {
                            AppState.selectedFaces.add(neighborIdx);
                        } else {
                            AppState.selectedFaces.delete(neighborIdx);
                        }
                        queue.push(neighborIdx);
                    }
                }
            }
        }
    }

    buildAdjacency(geometry) {
        const positions = geometry.attributes.position.array;
        const faceCount = positions.length / 9;

        // F-04: Replace BigInt vertex keys with Number-safe packing.
        // Precision: 10000 = 4 decimal places. Safe for coords up to ±400k.
        const P = 10000;
        const vertMap = new Map();
        let vertCount = 0;

        const getVertId = (x, y, z) => {
            const qx = Math.round(x * P);
            const qy = Math.round(y * P);
            const qz = Math.round(z * P);
            // Number-safe 53-bit pack: works for |qx|,|qy|,|qz| < ~21000 (safe at P=10000 for coords ±2.1)
            // For larger coords, use string key as fallback
            const key = `${qx},${qy},${qz}`;
            let id = vertMap.get(key);
            if (id === undefined) {
                id = vertCount++;
                vertMap.set(key, id);
            }
            return id;
        };

        // F-04: Replace BigInt edge keys with two-column Uint32Array sort.
        // Collect all edges as (lo, hi, faceIdx) triples, then sort by (lo, hi).
        const numEdges = faceCount * 3;
        const edgeLo = new Uint32Array(numEdges);
        const edgeHi = new Uint32Array(numEdges);
        const edgeFace = new Uint32Array(numEdges);

        let ePtr = 0;
        for (let f = 0; f < faceCount; f++) {
            const i = f * 9;
            const v1 = getVertId(positions[i], positions[i + 1], positions[i + 2]);
            const v2 = getVertId(positions[i + 3], positions[i + 4], positions[i + 5]);
            const v3 = getVertId(positions[i + 6], positions[i + 7], positions[i + 8]);

            const addEdge = (a, b) => {
                edgeLo[ePtr] = a < b ? a : b;
                edgeHi[ePtr] = a < b ? b : a;
                edgeFace[ePtr] = f;
                ePtr++;
            };
            addEdge(v1, v2);
            addEdge(v2, v3);
            addEdge(v3, v1);
        }

        // Sort edge indices by (lo, hi) lexicographically — no BigInt needed
        const edgeIndices = new Uint32Array(numEdges);
        for (let i = 0; i < numEdges; i++) edgeIndices[i] = i;
        edgeIndices.sort((a, b) => {
            const d = edgeLo[a] - edgeLo[b];
            return d !== 0 ? d : edgeHi[a] - edgeHi[b];
        });

        // F-02: Build adjacency with bounded typed-array neighbor lists.
        // Max degree is typically 3-6; cap at 32 to be safe.
        const MAX_DEG = 32;
        const adjData = new Uint32Array(faceCount * MAX_DEG);
        const adjDeg = new Uint8Array(faceCount); // current fill level per face

        const addNeighbor = (f1, f2) => {
            const base1 = f1 * MAX_DEG;
            const deg1 = adjDeg[f1];
            if (deg1 >= MAX_DEG) return;
            // Check for duplicate in bounded typed array (tiny scan, max 32)
            for (let k = 0; k < deg1; k++) {
                if (adjData[base1 + k] === f2) return;
            }
            adjData[base1 + deg1] = f2;
            adjDeg[f1] = deg1 + 1;
        };

        // Walk sorted edges: consecutive identical (lo,hi) pairs share an edge
        let i = 0;
        while (i < numEdges) {
            let j = i + 1;
            while (j < numEdges &&
                   edgeLo[edgeIndices[j]] === edgeLo[edgeIndices[i]] &&
                   edgeHi[edgeIndices[j]] === edgeHi[edgeIndices[i]]) {
                j++;
            }
            // Faces i..j-1 share this edge — make them neighbors
            for (let a = i; a < j; a++) {
                for (let b = a + 1; b < j; b++) {
                    const f1 = edgeFace[edgeIndices[a]];
                    const f2 = edgeFace[edgeIndices[b]];
                    if (f1 !== f2) {
                        addNeighbor(f1, f2);
                        addNeighbor(f2, f1);
                    }
                }
            }
            i = j;
        }

        // Convert to arrays for BFS compatibility (for...of iteration)
        const adjacencySets = new Array(faceCount);
        for (let f = 0; f < faceCount; f++) {
            const deg = adjDeg[f];
            if (deg > 0) {
                const base = f * MAX_DEG;
                adjacencySets[f] = Array.from(adjData.subarray(base, base + deg));
            }
        }
        return adjacencySets;
    }

    updateVisuals(forceFullReset = false) {
        if (!AppState.mesh) return;
        const geometry = AppState.mesh.geometry;

        // Ensure color attribute exists and is sized correctly
        if (!geometry.attributes.color || geometry.attributes.color.count !== geometry.attributes.position.count) {
            const count = geometry.attributes.position.count;
            const colors = new Float32Array(count * 3).fill(0.5);
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        }

        // Ensure FS Selection Attribute
        if (!geometry.attributes.fs_selection || geometry.attributes.fs_selection.count !== geometry.attributes.position.count) {
            const count = geometry.attributes.position.count;
            geometry.setAttribute('fs_selection', new THREE.BufferAttribute(new Float32Array(count), 1));
        }

        const colors = geometry.attributes.color.array;
        const selectionAttr = geometry.attributes.fs_selection.array;
        const current = AppState.selectedFaces;

        // F-08: Delta-only buffer update.
        // After a remesh or geometry swap (forceFullReset=true), do the old full approach.
        // Otherwise, compute the diff between _prevSelectedFaces and current and only
        // write to changed entries — keeping O(|changed|) instead of O(N) on every call.
        if (forceFullReset) {
            colors.fill(0.5);
            selectionAttr.fill(0.0);
            this._prevSelectedFaces.clear();
        }

        const sr = this.selectedColor.r;
        const sg = this.selectedColor.g;
        const sb = this.selectedColor.b;

        if (forceFullReset) {
            // Full pass: set all currently selected faces
            for (const faceIdx of current) {
                const v1 = faceIdx * 9;
                const i1 = faceIdx * 3;
                colors[v1] = sr; colors[v1 + 1] = sg; colors[v1 + 2] = sb;
                colors[v1 + 3] = sr; colors[v1 + 4] = sg; colors[v1 + 5] = sb;
                colors[v1 + 6] = sr; colors[v1 + 7] = sg; colors[v1 + 8] = sb;
                selectionAttr[i1] = 1.0; selectionAttr[i1 + 1] = 1.0; selectionAttr[i1 + 2] = 1.0;
            }
        } else {
            // Delta pass: only fix faces that changed

            // 1. Faces that were selected but are now deselected → reset to gray
            for (const faceIdx of this._prevSelectedFaces) {
                if (!current.has(faceIdx)) {
                    const v1 = faceIdx * 9;
                    const i1 = faceIdx * 3;
                    colors[v1] = 0.5; colors[v1 + 1] = 0.5; colors[v1 + 2] = 0.5;
                    colors[v1 + 3] = 0.5; colors[v1 + 4] = 0.5; colors[v1 + 5] = 0.5;
                    colors[v1 + 6] = 0.5; colors[v1 + 7] = 0.5; colors[v1 + 8] = 0.5;
                    selectionAttr[i1] = 0.0; selectionAttr[i1 + 1] = 0.0; selectionAttr[i1 + 2] = 0.0;
                }
            }

            // 2. Faces newly selected → paint blue
            for (const faceIdx of current) {
                if (!this._prevSelectedFaces.has(faceIdx)) {
                    const v1 = faceIdx * 9;
                    const i1 = faceIdx * 3;
                    colors[v1] = sr; colors[v1 + 1] = sg; colors[v1 + 2] = sb;
                    colors[v1 + 3] = sr; colors[v1 + 4] = sg; colors[v1 + 5] = sb;
                    colors[v1 + 6] = sr; colors[v1 + 7] = sg; colors[v1 + 8] = sb;
                    selectionAttr[i1] = 1.0; selectionAttr[i1 + 1] = 1.0; selectionAttr[i1 + 2] = 1.0;
                }
            }
        }

        // F-10: Swap reference instead of cloning (old Set gets GC'd)
        this._prevSelectedFaces = new Set(current);

        geometry.attributes.color.needsUpdate = true;
        geometry.attributes.fs_selection.needsUpdate = true;

        if (!AppState.mesh.material.vertexColors) {
            AppState.mesh.material.vertexColors = true;
            AppState.mesh.material.needsUpdate = true;
        }

        // Signal the renderer that the scene changed (F-10 integration)
        AppState.markDirty();

        // Notify UI
        window.dispatchEvent(new Event('selection-changed'));
    }

    clearAll() {
        AppState.clearSelection();
        // forceFullReset=true: ensures the entire color buffer is reset to gray,
        // guarding against any stale or STL-embedded colors left in the buffer.
        this.updateVisuals(true);
        document.getElementById('selectedCount').innerText = 0;
        // Keep connectivity cache as geometry doesn't change on clear, only on load.
    }

    selectAll() {
        if (!AppState.mesh) {
            const warningDiv = document.getElementById('selectionWarning');
            if (warningDiv) {
                warningDiv.innerText = translations[AppState.currentLang || 'en'].loadStlFirst;
                // Reset Animation
                warningDiv.classList.remove('show', 'hide');
                void warningDiv.offsetWidth;
                warningDiv.classList.add('show');

                setTimeout(() => {
                    warningDiv.classList.replace('show', 'hide');
                }, 3000);
            }
            return;
        }

        const positionAttr = AppState.mesh.geometry.attributes.position;
        // Each face has 3 vertices
        const faceCount = positionAttr.count / 3;

        // CRITICAL FIX: The Set must be cleared before adding all faces to ensure 
        // older indices from larger pre-undo geometries are purged. Otherwise,
        // the "Selected" count can exceed the total "Triangles" count.
        AppState.clearSelection();

        for (let i = 0; i < faceCount; i++) {
            AppState.selectedFaces.add(i);
        }

        // forceFullReset=true: going from 0 → all selected is always a
        // full repaint — delta would miss any stale color state in the buffer.
        this.updateVisuals(true);
        document.getElementById('selectedCount').innerText = AppState.selectedFaces.size;

        // Auto-Detect Projection Mode (Curve vs Flat) - optional update
        if (AppState.textureEngine) {
            AppState.textureEngine.updateProjectionBasis(AppState.mesh);
        }
    }
}
