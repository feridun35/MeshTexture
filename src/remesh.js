import * as THREE from 'three';
import AppState from './appState.js';
import { translations } from './translations.js';
import { subdivide } from './subdivision.js';
import { decimate } from './decimation.js';

/**
 * RemeshModule — Adaptive / uniform subdivision of the selected face region.
 *
 * Architecture:
 *   1. Compute total surface area of selected faces.
 *   2. Derive an approximate maxEdgeLength to slightly exceed the target.
 *   3. Subdivide to uniform density.
 *   4. Decimate DOWN precisely to the target triangles, returning original selection mapping.
 */
export class RemeshModule {
    constructor() {
        this.currentSelectionHash = "";

        window.addEventListener('request-refine', () => this.refineSelection());

        // Reset logic on new file
        window.addEventListener('reset-app', () => {
            const limitInfo = document.getElementById('polyWarning');
            if (limitInfo) limitInfo.style.display = 'none';
        });

        // Reset firstRefineDone when selection changes
        window.addEventListener('selection-changed', () => {
            if (AppState._suppressRefineReset) return;
        });

        // Also reset when the user Undoes a Bake (restores geometry state)
        window.addEventListener('app-state-restored', () => {
            if (AppState._suppressRefineReset) return;
        });
    }

    /**
     * Build per-non-indexed-vertex face weights for the subdivision engine.
     * Weight 1.0 = excluded (don't subdivide), 0.0 = included (do subdivide).
     */
    _buildFaceWeights(geometry) {
        const vCount = geometry.attributes.position.count;
        const weights = new Float32Array(vCount);

        // By default all faces are excluded (weight = 1.0)
        weights.fill(1.0);

        // Mark selected faces as included (weight = 0.0)
        for (const faceIdx of AppState.selectedFaces) {
            const v = faceIdx * 3;
            if (v + 2 < vCount) {
                weights[v]     = 0.0;
                weights[v + 1] = 0.0;
                weights[v + 2] = 0.0;
            }
        }

        return weights;
    }

    /**
     * Compute maxEdgeLength from the TARGET triangle count and selected surface area.
     *
     * Formula derivation:
     *   - For equilateral triangles: area = (√3/4) × e²
     *   - Total selected area A ≈ targetSelectedTris × (√3/4) × e²
     *   - Solving for e: e = sqrt(4A / (√3 × targetSelectedTris))
     *
     * This way the subdivision naturally produces approximately the desired
     * number of triangles without needing post-decimate.
     */
    _computeMaxEdgeLength(geometry, faceWeights, targetTriangles) {
        const position = geometry.attributes.position;
        const vA = new THREE.Vector3();
        const vB = new THREE.Vector3();
        const vC = new THREE.Vector3();
        const edge1 = new THREE.Vector3();
        const edge2 = new THREE.Vector3();
        const cross = new THREE.Vector3();

        let selectedArea = 0;
        let selectedCount = 0;
        let unselectedCount = 0;

        for (let i = 0; i < position.count; i += 3) {
            if (faceWeights[i] < 0.5) {
                // Selected face — compute area
                vA.fromBufferAttribute(position, i);
                vB.fromBufferAttribute(position, i + 1);
                vC.fromBufferAttribute(position, i + 2);
                edge1.subVectors(vB, vA);
                edge2.subVectors(vC, vA);
                cross.crossVectors(edge1, edge2);
                selectedArea += cross.length() * 0.5;
                selectedCount++;
            } else {
                unselectedCount++;
            }
        }

        if (selectedCount === 0 || selectedArea < 1e-12) {
            // Fallback: bounding box based
            geometry.computeBoundingBox();
            const bb = geometry.boundingBox;
            const maxDim = Math.max(
                bb.max.x - bb.min.x,
                bb.max.y - bb.min.y,
                bb.max.z - bb.min.z
            );
            return Math.max(0.05, maxDim / 200);
        }

        // How many triangles should the selected region have?
        // Total budget = targetTriangles; unselected faces stay as-is.
        const targetSelectedTris = Math.max(1000, targetTriangles - unselectedCount);

        // e = sqrt(4A / (√3 × T))
        let edgeLength = Math.sqrt((4 * selectedArea) / (Math.sqrt(3) * targetSelectedTris));

        // Start conservatively (assume curved/complex geometry). 
        // We multiply by 3.0 to guarantee we don't accidentally generate 10M+ triangles on attempt 1.
        // If the geometry is actually flat, the adaptive loop will quickly scale this down.
        edgeLength *= 3.0;

        // Clamp to reasonable range
        geometry.computeBoundingBox();
        const bb = geometry.boundingBox;
        const maxDim = Math.max(
            bb.max.x - bb.min.x,
            bb.max.y - bb.min.y,
            bb.max.z - bb.min.z
        );
        // Absolute minimum boundary to prevent crashes (maxDim / ~1500 is roughly safe before OOM)
        const minEdge = maxDim / 1500; 
        const maxEdge = maxDim / 10;   // don't go too coarse (useless)

        return Math.max(minEdge, Math.min(maxEdge, edgeLength));
    }

    refineSelection(suppressSave = false) {
        return new Promise(async (resolve, reject) => {
            if (!AppState.isMeshReady()) {
                resolve();
                return;
            }

            // Save state before refine
            if (!suppressSave) {
                AppState.saveGeometryState();
            }

            const geometry = AppState.mesh.geometry;
            const currentCount = geometry.attributes.position.count;
            const selectedCount = AppState.selectedFaces.size;

            if (selectedCount === 0) {
                window.dispatchEvent(new Event('refine-complete'));
                resolve();
                return;
            }

            // Hard block only at browser crash limit (10M)
            const currentTriangles = currentCount / 3;
            const limitInfo = document.getElementById('polyWarning');

            if (currentTriangles > 9000000) {
                if (limitInfo) {
                    limitInfo.innerText = translations[AppState.currentLang || 'en'].polyLimitReached;
                    limitInfo.style.display = 'block';
                }
                console.warn(`Refine blocked: Exceeds 9M polygons. Crash prevention active.`);
                setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('refine-complete', { detail: { limitReached: true } }));
                    resolve();
                }, 0);
                return;
            }
            if (limitInfo) limitInfo.style.display = 'none';

            // --- UI Feedback ---
            document.body.style.cursor = 'wait';

            try {
                // Build face weights (inverse of selection: 1.0 = excluded)
                const faceWeights = this._buildFaceWeights(geometry);

                // Yield to UI before heavy work
                await new Promise(r => requestAnimationFrame(r));

                // Read user's polygon budget
                const polyLimitSlider = document.getElementById('polyLimit');
                const polyLimitVal = polyLimitSlider ? parseInt(polyLimitSlider.value) * 1000000 : 5000000;

                // Compute initial maxEdgeLength
                let currentEdgeLength = this._computeMaxEdgeLength(geometry, faceWeights, polyLimitVal);
                console.log(`[RemeshModule] Initial target: ${polyLimitVal} tris, optimal base edge length: ${currentEdgeLength.toFixed(4)}`);

                let subdivided = null;
                let triCount = 0;
                let safetyHit = false;

                // Adaptive Subdivision Loop: Find the edge length that perfectly exceeds the budget.
                // We do this internally against the BASELINE geometry to prevent runaway selection bleeding.
                for (let attempt = 0; attempt < 5; attempt++) {
                    const { geometry: tempSub, safetyCapHit } = await subdivide(
                        geometry,
                        currentEdgeLength,
                        null,       // no progress callback needed
                        faceWeights,
                        { fast: false }
                    );

                    triCount = tempSub.attributes.position.count / 3;
                    console.log(`[RemeshModule] Subdivide Attempt ${attempt + 1}: edge=${currentEdgeLength.toFixed(4)} -> produced ${triCount} triangles`);

                    // If we reached our target or hit the safety block, keep this geometry and stop!
                    // We use 90% tolerance in case QEM doesn't feel like destroying perfectly flat topology
                    if (triCount >= polyLimitVal * 0.90 || safetyCapHit || attempt === 4) {
                        subdivided = tempSub;
                        safetyHit = safetyCapHit;
                        break;
                    }

                    // Undershot! Geometry might be very flat (like planes).
                    // Dispose the useless intermediate geometry and scale the edge length down.
                    tempSub.dispose();
                    
                    // Ratio of how much we undershot
                    const ratio = polyLimitVal / Math.max(1, triCount);
                    // Dampen the ratio so we don't multiply edge lengths by 10x instantly (avoids spikes to 45M)
                    const clampRatio = Math.min(ratio, 3.0); 
                    // To multiply triangles by clampRatio, we divide edgeLength by sqrt(clampRatio)
                    currentEdgeLength = currentEdgeLength / Math.sqrt(clampRatio);
                }

                // Extract arrays from the final subdivided geometry
                const newPos = subdivided.attributes.position.array;
                const newNorm = subdivided.attributes.normal.array;

                // Build selection array from excludeWeight attribute
                const excludeWeight = subdivided.attributes.excludeWeight
                    ? subdivided.attributes.excludeWeight.array
                    : null;

                const vCount = newPos.length / 3;
                let newSel = new Float32Array(vCount);

                if (excludeWeight) {
                    for (let t = 0; t < triCount; t++) {
                        const w = excludeWeight[t * 3];
                        const sel = w > 0.5 ? 0.0 : 1.0;
                        newSel[t * 3]     = sel;
                        newSel[t * 3 + 1] = sel;
                        newSel[t * 3 + 2] = sel;
                    }
                } else {
                    newSel.fill(1.0);
                }

                // Dispose the intermediate subdivided geometry as its arrays are pulled out
                subdivided.dispose();

                console.log(`[RemeshModule] Final Subdivision result: ${triCount} triangles`);

                let finalPos = newPos;
                let finalNorm = newNorm;
                let finalSel = newSel;

                if (triCount > polyLimitVal) {
                    console.log(`[RemeshModule] Post-decimate refining down to ${polyLimitVal} triangles...`);
                    // Build a temporary geometry for accurate decimation
                    const tempGeo = new THREE.BufferGeometry();
                    tempGeo.setAttribute('position', new THREE.BufferAttribute(
                        newPos instanceof Float32Array ? newPos : new Float32Array(newPos), 3));
                    tempGeo.setAttribute('normal', new THREE.BufferAttribute(
                        newNorm instanceof Float32Array ? newNorm : new Float32Array(newNorm), 3));
                    // The fs_selection array is properly mapped by decimate's new internal logic!
                    tempGeo.setAttribute('fs_selection', new THREE.BufferAttribute(newSel, 1));

                    const decimated = await decimate(
                        tempGeo,
                        polyLimitVal,
                        Infinity,  // Target only Triangles, not error tolerance
                        null,
                        newSel     // selection array tells QEM to freeze unselected!
                    );

                    tempGeo.dispose();

                    if (decimated && decimated.attributes.position.count < newPos.length / 3 * 3) {
                        finalPos = decimated.attributes.position.array;
                        finalNorm = decimated.attributes.normal.array;
                        triCount = finalPos.length / 9;
                        
                        // Grab the preserved selection array mapped perfectly by decimate()
                        const decSelAttr = decimated.attributes.fs_selection;
                        if (decSelAttr) {
                            finalSel = decSelAttr.array;
                        }

                        decimated.dispose();
                        console.log(`[RemeshModule] Decimate completed, exact triangle count: ${triCount}`);
                    }
                }

                // Apply result (deferred to let UI breathe)
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        this.applyRemeshResult(finalPos, finalNorm, finalSel);
                        this.finalizeUI();
                        resolve();
                    }, 50);
                });

            } catch (err) {
                console.error('[RemeshModule] Subdivision failed:', err);
                alert('Remesh failed: ' + err.message);
                this.finalizeUI();
                reject(err);
            }
        });
    }

    applyRemeshResult(newPos, newNorm, newSel) {
        const vCount = newPos.length / 3;
        const triCount = vCount / 3;

        // --- Prevent OOM Crash with Wireframe ---
        if (triCount > 8000000 && AppState.params.wireframe) {
            AppState.params.wireframe = false;
            if (AppState.mesh && AppState.mesh.material) {
                AppState.mesh.material.wireframe = false;
            }
            const wfToggle = document.getElementById('wireframeToggle');
            if (wfToggle) wfToggle.checked = false;
            console.warn("Wireframe auto-disabled to prevent out-of-memory crash on dense mesh.");
        }

        // Create new Geometry
        const newGeo = new THREE.BufferGeometry();
        newGeo.setAttribute('position', new THREE.BufferAttribute(
            newPos instanceof Float32Array ? newPos : new Float32Array(newPos), 3));
        newGeo.setAttribute('normal', new THREE.BufferAttribute(
            newNorm instanceof Float32Array ? newNorm : new Float32Array(newNorm), 3));

        // Reconstruct Selection Set from newSel buffer
        const newSelectedFaces = new Set();
        for (let i = 0; i < triCount; i++) {
            if (newSel[3 * i] > 0.5) {
                newSelectedFaces.add(i);
            }
        }

        newGeo.setAttribute('fs_selection', new THREE.BufferAttribute(
            newSel instanceof Float32Array ? newSel : new Float32Array(newSel), 1));

        // Dispose old
        if (AppState.mesh.geometry) AppState.mesh.geometry.dispose();
        AppState.mesh.geometry = newGeo;

        // Mark geometry dirty for undo/redo
        AppState.markGeometryDirty();

        // Update AppState
        AppState.selectedFaces = newSelectedFaces;

        // Suppress the selection-changed event from resetting firstRefineDone.
        AppState._suppressRefineReset = true;
        try {
            // Reset Adjacency + Spatial Grid (geometry changed) and do a full visual reset
            if (AppState.selectionModule) {
                AppState.selectionModule.adjacencyGraph = null;
                AppState.selectionModule.spatialGrid = null;
                AppState.selectionModule.updateVisuals(true);
            }
        } finally {
            AppState._suppressRefineReset = false;
        }

        // Stats
        const polyCount = document.getElementById('polyCount');
        if (polyCount) polyCount.innerText = triCount;

        const selCount = document.getElementById('selectedCount');
        if (selCount) selCount.innerText = newSelectedFaces.size;

        window.dispatchEvent(new CustomEvent('refine-complete', { detail: { limitReached: false } }));
    }

    finalizeUI() {
        document.body.style.cursor = 'default';
        const modal = document.getElementById('progressModal');
        if (modal) modal.style.display = 'none';
    }
}
