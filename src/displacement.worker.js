import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { applyDisplacement } from './displacement.js';

// displacement.worker.js
// F-17: Set to true for development profiling, false for production
const DEBUG = false;

// F-03: Shared vertex welding utility â€” used by both displacement and boundary estimation.
// Quantizes vertex positions to integer grid, sorts, and assigns unique IDs to coincident vertices.
function weldVertices(positions, count, Q) {
    const uniqueIDs = new Int32Array(count);
    const map = new Map();
    let uidCounter = 0;

    for (let i = 0; i < count; i++) {
        // Quantize coordinates to Q
        const qX = Math.round(positions[i * 3] * Q);
        const qY = Math.round(positions[i * 3 + 1] * Q);
        const qZ = Math.round(positions[i * 3 + 2] * Q);

        // Safe offset guarantees positive values even for extreme bounds (±100,000,000 units)
        // Offset by 1 trillion. Requires 40 bits (2^40 = ~1.1 trillion).
        const OFFSET = 1000000000000n;
        const bx = BigInt(qX) + OFFSET;
        const by = BigInt(qY) + OFFSET;
        const bz = BigInt(qZ) + OFFSET;

        // 40 bits per axis = 120 bit key. No overlap possible.
        const key = (bx << 80n) | (by << 40n) | bz;

        let uid = map.get(key);
        if (uid === undefined) {
            uid = uidCounter++;
            map.set(key, uid);
        }
        uniqueIDs[i] = uid;
    }

    return { uniqueIDs, numUnique: uidCounter };
}

// F-HoleFix: Automatically detect and fill isolated topological holes (up to 64 edges)
function fillSmallHoles(positions, normals, selection, Q) {
    const count = positions.length / 3;
    const { uniqueIDs, numUnique } = weldVertices(positions, count, Q);
    
    const numTris = positions.length / 9;
    if (numTris < 4) return { positions, normals, selection };

    const numEdges = numTris * 3;
    
    const bndEdgeLo = new Uint32Array(numEdges);
    const bndEdgeHi = new Uint32Array(numEdges);
    const edgeDir = new Uint8Array(numEdges);
    const edgeOrigU = new Uint32Array(numEdges);
    const edgeOrigV = new Uint32Array(numEdges);
    
    let ePtr = 0;
    for (let t = 0; t < numTris; t++) {
        const vp = t * 3;
        for (let j = 0; j < 3; j++) {
            const origU = vp + j;
            const origV = vp + ((j + 1) % 3);
            const u = uniqueIDs[origU];
            const v = uniqueIDs[origV];
            
            if (u === v) continue; 
            
            bndEdgeLo[ePtr] = u < v ? u : v;
            bndEdgeHi[ePtr] = u < v ? v : u;
            edgeDir[ePtr] = u < v ? 0 : 1;
            edgeOrigU[ePtr] = origU;
            edgeOrigV[ePtr] = origV;
            ePtr++;
        }
    }
    
    const validEdges = ePtr;
    const edgeIndices = new Int32Array(validEdges);
    for (let i = 0; i < validEdges; i++) edgeIndices[i] = i;
    
    edgeIndices.sort((a, b) => {
        const d = bndEdgeLo[a] - bndEdgeLo[b];
        return d !== 0 ? d : bndEdgeHi[a] - bndEdgeHi[b];
    });
    
    const boundaryEdges = [];
    for (let i = 0; i < validEdges; i++) {
        const currIdx = edgeIndices[i];
        const lo = bndEdgeLo[currIdx];
        const hi = bndEdgeHi[currIdx];
        
        let shareCount = 1;
        let lastDir = edgeDir[currIdx];
        
        while (i + 1 < validEdges) {
            const nextIdx = edgeIndices[i + 1];
            if (bndEdgeLo[nextIdx] === lo && bndEdgeHi[nextIdx] === hi) {
                shareCount++;
                i++;
            } else {
                break;
            }
        }
        
        if (shareCount === 1) {
            if (lastDir === 0) {
                boundaryEdges.push({ u: lo, v: hi, origU: edgeOrigU[currIdx], origV: edgeOrigV[currIdx] });
            } else {
                boundaryEdges.push({ u: hi, v: lo, origU: edgeOrigU[currIdx], origV: edgeOrigV[currIdx] });
            }
        }
    }
    
    if (boundaryEdges.length === 0) return { positions, normals, selection };
    
    // Build adjacency list for boundary graph
    const adj = new Map();
    for (let i = 0; i < boundaryEdges.length; i++) {
        const edge = boundaryEdges[i];
        if (!adj.has(edge.u)) adj.set(edge.u, []);
        adj.get(edge.u).push(edge);
    }
    
    const uniqueLoops = [];
    const loopSignatures = new Set();
    
    // Use BFS to find the Minimal Cycle (shortest loop) for every boundary edge.
    // This perfectly isolates micro-holes (slits) even when they share pinch-point vertices,
    // avoiding the trap of tracing the entire macro-boundary.
    for (let i = 0; i < boundaryEdges.length; i++) {
        const startEdge = boundaryEdges[i];
        
        let pathQueue = [ [startEdge] ];
        let visited = new Set();
        visited.add(startEdge.v); // Start searching from the end of the first edge
        
        let foundCycle = null;
        
        while (pathQueue.length > 0) {
            const currentPath = pathQueue.shift();
            
            if (currentPath.length > 64) continue; // Abort if loop is too large (not a micro-hole)
            
            const tailNode = currentPath[currentPath.length - 1].v;
            
            // If the tail node loops back to the very start of the first edge, we found the minimal cycle!
            if (tailNode === startEdge.u) {
                foundCycle = currentPath;
                break;
            }
            
            const neighbors = adj.get(tailNode) || [];
            for (const nextEdge of neighbors) {
                if (nextEdge.v === startEdge.u) {
                    foundCycle = [...currentPath, nextEdge];
                    break;
                } else if (!visited.has(nextEdge.v)) {
                    visited.add(nextEdge.v);
                    pathQueue.push([...currentPath, nextEdge]);
                }
            }
            if (foundCycle) break;
        }
        
        if (foundCycle && foundCycle.length >= 3 && foundCycle.length <= 64) {
            // Normalize cycle to avoid processing the same hole multiple times starting from different edges
            const verts = foundCycle.map(e => e.u);
            let minVal = verts[0];
            let minIndex = 0;
            for (let k = 1; k < verts.length; k++) {
                if (verts[k] < minVal) {
                    minVal = verts[k];
                    minIndex = k;
                }
            }
            
            const sigArr = [];
            for (let k = 0; k < verts.length; k++) {
                sigArr.push(verts[(minIndex + k) % verts.length]);
            }
            const sig = sigArr.join(',');
            
            if (!loopSignatures.has(sig)) {
                loopSignatures.add(sig);
                uniqueLoops.push(foundCycle);
            }
        }
    }
    
    const newTrisPos = [];
    const newTrisNorm = [];
    const newTrisSel = [];
    
    for (const loop of uniqueLoops) {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        let maxEdgeSqr = -1;
        let bestRootOrigU = loop[0].origU; 
        
        // Compute Bounding Box and locate the longest edge
        for (let edge of loop) {
            const ou = edge.origU * 3;
            const ov = edge.origV * 3;
            const px = positions[ou], py = positions[ou+1], pz = positions[ou+2];
            const px2 = positions[ov], py2 = positions[ov+1], pz2 = positions[ov+2];
            
            if (px < minX) minX = px; if (px > maxX) maxX = px;
            if (py < minY) minY = py; if (py > maxY) maxY = py;
            if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
            
            const eSq = (px2-px)**2 + (py2-py)**2 + (pz2-pz)**2;
            if (eSq > maxEdgeSqr) {
                maxEdgeSqr = eSq;
                // The longest edge is guaranteed to be the sparse base edge.
                // Selecting its start vertex ensures the Triangle Fan radiates strictly inward,
                // remaining perfectly constrained within the wedge/slit avoiding overlaps.
                bestRootOrigU = edge.origU;
            }
        }
        
        const dx = maxX - minX;
        const dy = maxY - minY;
        const dz = maxZ - minZ;
        
        // Limit hole bounding box to prevent filling large intentional gaps
        if (dx < 15.0 && dy < 15.0 && dz < 15.0) {
            const verts = loop.map(e => e.origU); 
            const revVerts = [];
            for (let j = verts.length - 1; j >= 0; j--) revVerts.push(verts[j]);
            
            // Reorder so that the best root is at index 0
            let rootIdx = revVerts.indexOf(bestRootOrigU);
            if (rootIdx === -1) rootIdx = 0;
            
            const fanVerts = [];
            for (let j = 0; j < revVerts.length; j++) {
                fanVerts.push(revVerts[(rootIdx + j) % revVerts.length]);
            }
            
            const root = fanVerts[0];
            const rx = positions[root*3], ry = positions[root*3+1], rz = positions[root*3+2];
            const rs = selection[root];
            
            for (let j = 1; j < fanVerts.length - 1; j++) {
                const vA = fanVerts[j];
                const vB = fanVerts[j+1];
                
                const ax = positions[vA*3], ay = positions[vA*3+1], az = positions[vA*3+2];
                const bx = positions[vB*3], by = positions[vB*3+1], bz = positions[vB*3+2];
                
                const d1x = ax - rx, d1y = ay - ry, d1z = az - rz;
                const d2x = bx - rx, d2y = by - ry, d2z = bz - rz;
                let nx = d1y * d2z - d1z * d2y;
                let ny = d1z * d2x - d1x * d2z;
                let nz = d1x * d2y - d1y * d2x;
                const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
                if (len > 0) { nx /= len; ny /= len; nz /= len; }
                
                newTrisPos.push(rx, ry, rz, ax, ay, az, bx, by, bz);
                newTrisNorm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
                
                const selA = selection[vA];
                const selB = selection[vB];
                const sAvg = (rs + selA + selB) / 3 > 0.5 ? 1 : 0;
                newTrisSel.push(sAvg, sAvg, sAvg);
            }
        }
    }
    
    if (newTrisPos.length === 0) return { positions, normals, selection };
    
    const finalPos = new Float32Array(positions.length + newTrisPos.length);
    finalPos.set(positions);
    finalPos.set(newTrisPos, positions.length);
    
    const finalNorm = new Float32Array(normals.length + newTrisNorm.length);
    finalNorm.set(normals);
    finalNorm.set(newTrisNorm, normals.length);
    
    const finalSel = new Float32Array(selection.length + newTrisSel.length);
    finalSel.set(selection);
    finalSel.set(newTrisSel, selection.length);
    
    if (typeof DEBUG !== 'undefined' && DEBUG) console.log(`Worker: Filled small holes with ${newTrisPos.length / 9} triangles.`);
    
    return { positions: finalPos, normals: finalNorm, selection: finalSel };
}

self.onmessage = function (e) {
    const data = e.data;

    // --- DISPLACEMENT BAKE LOGIC ---
    // Note: remesh task removed â€” subdivision now runs on main thread via subdivision.js
    const {
        positions,       // Float32Array (Transferable)
        normals,         // Float32Array (Transferable)
        selection,       // Float32Array (Transferable)
        textureData,     // Uint8ClampedArray
        width,
        height,
        params
    } = data;

    // F-06: Deferred to after displacement loop â€” only needed for wall generation.
    // The welding step below uses `positions` directly (they haven't been mutated yet).
    let originalPositions = null;

    const {
        scale,
        offset,
        amp,
        rotation,
        sharpness,
        mappingMode,
        planarProjMat,
        poleSmoothness
    } = params;

    if (!positions || !normals || !textureData) {
        self.postMessage({ error: "Missing data" });
        return;
    }

    const count = positions.length / 3;

    // --- Helpers ---
    const rotate2D = (u, v, rad) => {
        const mid = 0.5;
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        return {
            u: c * (u - mid) + s * (v - mid) + mid,
            v: c * (v - mid) - s * (u - mid) + mid
        };
    };

    const sample = (u, v) => {
        u = u - Math.floor(u);
        v = v - Math.floor(v);
        const x = Math.floor(u * (width - 1));
        const y = Math.floor((1.0 - v) * (height - 1));
        const idx = (y * width + x) * 4;
        return textureData[idx] / 255.0;
    };

    const getPoleFade = (v) => {
        if (poleSmoothness <= 0.0) return 1.0;
        const dist = Math.min(v, 1.0 - v);
        const t = Math.max(0, Math.min(1, dist / poleSmoothness));
        return t * t * (3 - 2 * t);
    };

    const applyMatrix4 = (x, y, z, m) => {
        const e = m;
        const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
        return {
            x: (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
            y: (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
            z: (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
        };
    };

    const transformDirection = (x, y, z, m) => {
        const e = m;
        const nx = x * e[0] + y * e[4] + z * e[8];
        const ny = x * e[1] + y * e[5] + z * e[9];
        const nz = x * e[2] + y * e[6] + z * e[10];
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len === 0) return { x: 0, y: 0, z: 0 };
        return { x: nx / len, y: ny / len, z: nz / len };
    };

    const mW = params.matrixWorld;

    // --- 0. PRE-COMPUTATION: WELDING & SMOOTH NORMALS ---
    self.postMessage({ task: 'status', key: 'statusWelding', next: 'statusTexture' });
    if (DEBUG) console.time("Worker: Pre-computation / Quantization");
    const Q = 1000000;
    // F-03: Use shared weldVertices utility (eliminates duplicated quantize/sort/assign code)
    // F-06: Uses `positions` directly â€” they are identical to originalPositions at this point.
    const { uniqueIDs, numUnique: _numUnique } = weldVertices(positions, count, Q);
    if (DEBUG) console.timeEnd("Worker: Pre-computation / Quantization");

    if (DEBUG) console.time("Worker: Smooth Normals pre-computation");

    // F-Sealed: Evaluate selection strictly per face to avoid slanted gradients.
    // A face is selected if ANY of its vertices is painted (>0.5).
    // F-Sealed: Evaluate selection strictly per face
    const faceCount = count / 3;
    const faceSelected = new Uint8Array(faceCount);
    let selFaceCount = 0;

    for (let f = 0; f < faceCount; f++) {
        const vIdx = f * 3;
        // STRICT: ALL 3 vertices must be selected for a face to receive displacement.
        // Using OR here caused boundary faces (sharing vertices with the selected region)
        // to receive displacement, creating the "texture bleeding" artifacts.
        if (selection[vIdx] > 0.5 && selection[vIdx + 1] > 0.5 && selection[vIdx + 2] > 0.5) {
            faceSelected[f] = 1;
            selFaceCount++;
        }
    }

    // 1. Calculate flat face normals for ALL faces
    const numFaces = faceCount;
    const faceNormalsX = new Float32Array(numFaces);
    const faceNormalsY = new Float32Array(numFaces);
    const faceNormalsZ = new Float32Array(numFaces);

    for (let f = 0; f < numFaces; f++) {
        const i3 = f * 9;
        const ax = positions[i3], ay = positions[i3+1], az = positions[i3+2];
        const bx = positions[i3+3], by = positions[i3+4], bz = positions[i3+5];
        const cx = positions[i3+6], cy = positions[i3+7], cz = positions[i3+8];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        let nx = uy*vz - uz*vy;
        let ny = uz*vx - ux*vz;
        let nz = ux*vy - uy*vx;
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
        if (len > 0) {
            faceNormalsX[f] = nx/len;
            faceNormalsY[f] = ny/len;
            faceNormalsZ[f] = nz/len;
        }
    }

    const numUnique = _numUnique;
    // 2. Accumulate pure Selected smooth normals
    const smoothSelNormals = new Float32Array(numUnique * 3);
    for (let f = 0; f < numFaces; f++) {
        if (faceSelected[f] === 1) {
            const nx = faceNormalsX[f];
            const ny = faceNormalsY[f];
            const nz = faceNormalsZ[f];
            for (let j = 0; j < 3; j++) {
                const uid = uniqueIDs[f * 3 + j];
                smoothSelNormals[uid*3] += nx;
                smoothSelNormals[uid*3+1] += ny;
                smoothSelNormals[uid*3+2] += nz;
            }
        }
    }

    const isBoundaryVertex = new Uint8Array(numUnique);
    for (let f = 0; f < numFaces; f++) {
        if (faceSelected[f] === 0) {
            for (let j = 0; j < 3; j++) {
                const uid = uniqueIDs[f * 3 + j];
                // If it has a selected normal, and is part of an unselected face, it's a boundary vertex!
                const px = smoothSelNormals[uid*3];
                const py = smoothSelNormals[uid*3+1];
                const pz = smoothSelNormals[uid*3+2];
                if ((px*px + py*py + pz*pz) > 0.0001) {
                    isBoundaryVertex[uid] = 1;
                }
            }
        }
    }

    // --- MASTER BOUNDARY EXTENSION ---
    // Subdivided boundary midpoints belong purely to selected faces and were missed above.
    // We find them by checking collinearity against the macroscopic (unselected) boundary edges.
    const uidToPos = new Float32Array(numUnique * 3);
    for (let i = 0; i < count; i++) {
        const uid = uniqueIDs[i];
        uidToPos[uid * 3] = positions[i * 3];
        uidToPos[uid * 3 + 1] = positions[i * 3 + 1];
        uidToPos[uid * 3 + 2] = positions[i * 3 + 2];
    }

    let uFaceCount = 0;
    for (let f = 0; f < numFaces; f++) {
        if (faceSelected[f] === 0) uFaceCount++;
    }
    
    if (uFaceCount > 0 && uFaceCount < numFaces) {
        const unselEdgeLo = new Uint32Array(uFaceCount * 3);
        const unselEdgeHi = new Uint32Array(uFaceCount * 3);
        let uEdgeCount = 0;

        for (let f = 0; f < numFaces; f++) {
            if (faceSelected[f] === 0) {
                for (let j = 0; j < 3; j++) {
                    const u = uniqueIDs[f * 3 + j];
                    const v = uniqueIDs[f * 3 + ((j + 1) % 3)];
                    unselEdgeLo[uEdgeCount] = u < v ? u : v;
                    unselEdgeHi[uEdgeCount] = u < v ? v : u;
                    uEdgeCount++;
                }
            }
        }

        const unselEdgeIndices = new Int32Array(uEdgeCount);
        for (let i = 0; i < uEdgeCount; i++) unselEdgeIndices[i] = i;
        unselEdgeIndices.sort((a, b) => {
            const d = unselEdgeLo[a] - unselEdgeLo[b];
            return d !== 0 ? d : unselEdgeHi[a] - unselEdgeHi[b];
        });

        const mEdges = [];
        for (let i = 0; i < uEdgeCount; i++) {
            const currIdx = unselEdgeIndices[i];
            const lo = unselEdgeLo[currIdx];
            const hi = unselEdgeHi[currIdx];

            let isShared = false;
            if (i + 1 < uEdgeCount) {
                const nextIdx = unselEdgeIndices[i + 1];
                if (unselEdgeLo[nextIdx] === lo && unselEdgeHi[nextIdx] === hi) {
                    isShared = true;
                    i++;
                    while (i + 1 < uEdgeCount && unselEdgeLo[unselEdgeIndices[i + 1]] === lo && unselEdgeHi[unselEdgeIndices[i + 1]] === hi) i++;
                }
            }

            if (!isShared) {
                const ax = uidToPos[lo * 3], ay = uidToPos[lo * 3 + 1], az = uidToPos[lo * 3 + 2];
                const bx = uidToPos[hi * 3], by = uidToPos[hi * 3 + 1], bz = uidToPos[hi * 3 + 2];
                mEdges.push({
                    ax, ay, az, bx, by, bz,
                    minX: Math.min(ax, bx) - 0.0001, maxX: Math.max(ax, bx) + 0.0001,
                    minY: Math.min(ay, by) - 0.0001, maxY: Math.max(ay, by) + 0.0001,
                    minZ: Math.min(az, bz) - 0.0001, maxZ: Math.max(az, bz) + 0.0001,
                    lenSq: (bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2
                });
            }
        }

        // --- 1. Compute Global Bounds of mEdges ---
        let bMinX = Infinity, bMinY = Infinity, bMinZ = Infinity;
        let bMaxX = -Infinity, bMaxY = -Infinity, bMaxZ = -Infinity;
        for (let j = 0; j < mEdges.length; j++) { // Changed uEdgeCount to mEdges.length
            const edge = mEdges[j];
            if (!edge) continue;
            if (edge.minX < bMinX) bMinX = edge.minX;
            if (edge.maxX > bMaxX) bMaxX = edge.maxX;
            if (edge.minY < bMinY) bMinY = edge.minY;
            if (edge.maxY > bMaxY) bMaxY = edge.maxY;
            if (edge.minZ < bMinZ) bMinZ = edge.minZ;
            if (edge.maxZ > bMaxZ) bMaxZ = edge.maxZ;
        }

        // Add tolerance to global bounds
        const TOL = 0.005;
        bMinX -= TOL; bMaxX += TOL;
        bMinY -= TOL; bMaxY += TOL;
        bMinZ -= TOL; bMaxZ += TOL;

        // --- 2. Build 3D Spatial Hash Grid ---
        const gridDim = 50; // 50x50x50 grid
        const dx = (bMaxX - bMinX) || 1;
        const dy = (bMaxY - bMinY) || 1;
        const dz = (bMaxZ - bMinZ) || 1;

        const getGridHash = (x, y, z) => {
            const cx = Math.max(0, Math.min(gridDim - 1, Math.floor(((x - bMinX) / dx) * gridDim)));
            const cy = Math.max(0, Math.min(gridDim - 1, Math.floor(((y - bMinY) / dy) * gridDim)));
            const cz = Math.max(0, Math.min(gridDim - 1, Math.floor(((z - bMinZ) / dz) * gridDim)));
            return cx + cy * gridDim + cz * gridDim * gridDim;
        };

        const edgeGrid = new Map();
        for (let j = 0; j < mEdges.length; j++) {
            const edge = mEdges[j];
            const minCx = Math.max(0, Math.min(gridDim - 1, Math.floor(((edge.minX - TOL - bMinX) / dx) * gridDim)));
            const maxCx = Math.max(0, Math.min(gridDim - 1, Math.floor(((edge.maxX + TOL - bMinX) / dx) * gridDim)));
            const minCy = Math.max(0, Math.min(gridDim - 1, Math.floor(((edge.minY - TOL - bMinY) / dy) * gridDim)));
            const maxCy = Math.max(0, Math.min(gridDim - 1, Math.floor(((edge.maxY + TOL - bMinY) / dy) * gridDim)));
            const minCz = Math.max(0, Math.min(gridDim - 1, Math.floor(((edge.minZ - TOL - bMinZ) / dz) * gridDim)));
            const maxCz = Math.max(0, Math.min(gridDim - 1, Math.floor(((edge.maxZ + TOL - bMinZ) / dz) * gridDim)));
            
            for (let cx = minCx; cx <= maxCx; cx++) {
                for (let cy = minCy; cy <= maxCy; cy++) {
                    for (let cz = minCz; cz <= maxCz; cz++) {
                        const hash = cx + cy * gridDim + cz * gridDim * gridDim;
                        let cell = edgeGrid.get(hash);
                        if (!cell) {
                            cell = [];
                            edgeGrid.set(hash, cell);
                        }
                        cell.push(edge);
                    }
                }
            }
        }

        // --- 3. Evaluate Vertices Extremely Fast ---
        for (let i = 0; i < numUnique; i++) {
            if (isBoundaryVertex[i] === 1) continue;
            
            const nx = smoothSelNormals[i * 3];
            const ny = smoothSelNormals[i * 3 + 1];
            const nz = smoothSelNormals[i * 3 + 2];
            if (nx * nx + ny * ny + nz * nz < 0.000001) continue;

            const px = uidToPos[i * 3], py = uidToPos[i * 3 + 1], pz = uidToPos[i * 3 + 2];

            // Filter out 99% of vertices immediately
            if (px < bMinX || px > bMaxX || py < bMinY || py > bMaxY || pz < bMinZ || pz > bMaxZ) {
                continue;
            }

            const hash = getGridHash(px, py, pz);
            const cellEdges = edgeGrid.get(hash);
            if (!cellEdges) continue;

            for (let j = 0; j < cellEdges.length; j++) {
                const edge = cellEdges[j];
                // Increased bounding box tolerance from 0.0001 to 0.005
                if (px >= edge.minX - 0.005 && px <= edge.maxX + 0.005 &&
                    py >= edge.minY - 0.005 && py <= edge.maxY + 0.005 &&
                    pz >= edge.minZ - 0.005 && pz <= edge.maxZ + 0.005) {
                    
                    if (edge.lenSq < 1e-12) {
                        const dx = px - edge.ax, dp_y = py - edge.ay, dz = pz - edge.az;
                        if (dx * dx + dp_y * dp_y + dz * dz < 1e-5) {
                            isBoundaryVertex[i] = 1;
                            break;
                        }
                    } else {
                        const abx = edge.bx - edge.ax, aby = edge.by - edge.ay, abz = edge.bz - edge.az;
                        const apx = px - edge.ax, apy = py - edge.ay, apz = pz - edge.az;

                        let t = (apx * abx + apy * aby + apz * abz) / edge.lenSq;
                        if (t < 0) t = 0; else if (t > 1) t = 1;

                        const dx = px - (edge.ax + t * abx);
                        const dp_y = py - (edge.ay + t * aby);
                        const dz = pz - (edge.az + t * abz);

                        // Increased tolerance from 1e-8 to 1e-5 (approx distance 0.003 units)
                        if (dx * dx + dp_y * dp_y + dz * dz < 1e-5) {
                            isBoundaryVertex[i] = 1;
                            break;
                        }
                    }
                }
            }
        }
    }

    for (let i = 0; i < numUnique; i++) {
        const uix = i * 3;
        let nx = smoothSelNormals[uix];
        let ny = smoothSelNormals[uix+1];
        let nz = smoothSelNormals[uix+2];
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
        if (len > 0.000001) {
            smoothSelNormals[uix] = nx/len;
            smoothSelNormals[uix+1] = ny/len;
            smoothSelNormals[uix+2] = nz/len;
        }
    }

    // 3. For each boundary vertex, ensure it does not overhang its unselected neighbors.
    // This perfectly prevents the "Geniş Açılı Taşma" (bleeding over >90 angles) locally
    // without ruining orthogonal multi-face selections or causing lateral texture stretching.
    for (let f = 0; f < numFaces; f++) {
        if (faceSelected[f] === 0) {
            const fnx = faceNormalsX[f], fny = faceNormalsY[f], fnz = faceNormalsZ[f];
            for (let j = 0; j < 3; j++) {
                const uid = uniqueIDs[f * 3 + j];
                if (isBoundaryVertex[uid] === 1) {
                    const uix = uid * 3;
                    let nx = smoothSelNormals[uix];
                    let ny = smoothSelNormals[uix+1];
                    let nz = smoothSelNormals[uix+2];
                    
                    // If the displacement vector points OUTWARD cross the unselected face's plane...
                    const dot = nx * fnx + ny * fny + nz * fnz;
                    if (dot > 0) { 
                        // Project it so it slides flush against the unselected boundary
                        nx -= dot * fnx;
                        ny -= dot * fny;
                        nz -= dot * fnz;

                        const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
                        if (len > 0.000001) {
                            smoothSelNormals[uix] = nx/len;
                            smoothSelNormals[uix+1] = ny/len;
                            smoothSelNormals[uix+2] = nz/len;
                        }
                    }
                }
            }
        }
    }
    if (DEBUG) console.timeEnd("Worker: Smooth Normals pre-computation");

    // Alias to minimize refactor downstream
    const smoothNormalsAccum = smoothSelNormals;

    // --- 0.5. DISTANCE-TO-BOUNDARY CLAMPING (EXPERT FIX & OPTIMIZED) ---
    self.postMessage({ task: 'status', key: 'statusDistanceField', next: 'statusTexture' });
    if (DEBUG) console.time("Worker: Distance Field");

    const numEdges = selFaceCount * 3;
    const edgeHead = new Int32Array(numUnique).fill(-1);
    const edgeNext = new Int32Array(numEdges);
    const edgeHiArr = new Int32Array(numEdges);
    const edgeMetaArr = new Uint32Array(numEdges);
    const edgeShared = new Uint8Array(numEdges); // 0: single, 1: shared
    
    let ptr = 0;
    for (let f = 0; f < faceCount; f++) {
        if (faceSelected[f] === 1) {
            const i = f * 3;
            const u = uniqueIDs[i];
            const v = uniqueIDs[i + 1];
            const w = uniqueIDs[i + 2];

            let lo, hi, slot;
            
            // Edge 0: u-v
            lo = u < v ? u : v; hi = u < v ? v : u;
            slot = edgeHead[lo];
            while(slot !== -1) { if (edgeHiArr[slot] === hi) { edgeShared[slot] = 1; break; } slot = edgeNext[slot]; }
            if (slot === -1) { edgeHiArr[ptr] = hi; edgeMetaArr[ptr] = i; edgeShared[ptr] = 0; edgeNext[ptr] = edgeHead[lo]; edgeHead[lo] = ptr++; }

            // Edge 1: v-w
            lo = v < w ? v : w; hi = v < w ? w : v;
            slot = edgeHead[lo];
            while(slot !== -1) { if (edgeHiArr[slot] === hi) { edgeShared[slot] = 1; break; } slot = edgeNext[slot]; }
            if (slot === -1) { edgeHiArr[ptr] = hi; edgeMetaArr[ptr] = i + 1; edgeShared[ptr] = 0; edgeNext[ptr] = edgeHead[lo]; edgeHead[lo] = ptr++; }

            // Edge 2: w-u
            lo = w < u ? w : u; hi = w < u ? u : w;
            slot = edgeHead[lo];
            while(slot !== -1) { if (edgeHiArr[slot] === hi) { edgeShared[slot] = 1; break; } slot = edgeNext[slot]; }
            if (slot === -1) { edgeHiArr[ptr] = hi; edgeMetaArr[ptr] = i + 2; edgeShared[ptr] = 0; edgeNext[ptr] = edgeHead[lo]; edgeHead[lo] = ptr++; }
        }
    }

    const isSelectedUID = new Uint8Array(numUnique);
    for (let f = 0; f < faceCount; f++) {
        if (faceSelected[f] === 1) {
            isSelectedUID[uniqueIDs[f*3]] = 1;
            isSelectedUID[uniqueIDs[f*3+1]] = 1;
            isSelectedUID[uniqueIDs[f*3+2]] = 1;
        }
    }
    // --- 0.5. EXACT DISTANCE FIELD CLAMPING (Hard-Cut Safety Pass) ---
    self.postMessage({ task: 'status', key: 'statusDistanceField', next: 'statusTexture' });
    if (DEBUG) console.time("Worker: Exact Distance to Boundary");

    // Collect true boundary line segments
    const bEdgesX1 = []; const bEdgesY1 = []; const bEdgesZ1 = [];
    const bEdgesX2 = []; const bEdgesY2 = []; const bEdgesZ2 = [];

    for (let u = 0; u < numUnique; u++) {
        for (let slot = edgeHead[u]; slot !== -1; slot = edgeNext[slot]) {
            if (edgeShared[slot] === 0) {
                const v = edgeHiArr[slot];
                // Both must be boundary vertices to form a boundary edge segment
                if (isBoundaryVertex[u] === 1 && isBoundaryVertex[v] === 1) {
                    bEdgesX1.push(uidToPos[u*3]); bEdgesY1.push(uidToPos[u*3+1]); bEdgesZ1.push(uidToPos[u*3+2]);
                    bEdgesX2.push(uidToPos[v*3]); bEdgesY2.push(uidToPos[v*3+1]); bEdgesZ2.push(uidToPos[v*3+2]);
                }
            }
        }
    }

    const numBEdges = bEdgesX1.length;
    const minDistSqArr = new Float64Array(numUnique);
    
    // Pre-calculate lengths to save inner loop ops
    const edgeLensSq = new Float64Array(numBEdges);
    for(let e=0; e<numBEdges; e++){
        const dx = bEdgesX2[e] - bEdgesX1[e];
        const dy = bEdgesY2[e] - bEdgesY1[e];
        const dz = bEdgesZ2[e] - bEdgesZ1[e];
        edgeLensSq[e] = dx*dx + dy*dy + dz*dz;
    }

    // Process only selected vertices exactly
    for (let u = 0; u < numUnique; u++) {
        if (isSelectedUID[u] === 1) {
            if (isBoundaryVertex[u] === 1) {
                minDistSqArr[u] = 0.0;
                continue;
            }

            const px = uidToPos[u*3];
            const py = uidToPos[u*3+1];
            const pz = uidToPos[u*3+2];
            
            let minSq = 999999999.0;
            for (let e = 0; e < numBEdges; e++) {
                const ax = bEdgesX1[e], ay = bEdgesY1[e], az = bEdgesZ1[e];
                const lenSq = edgeLensSq[e];
                
                let distSq;
                if (lenSq < 1e-12) {
                    const dx = px - ax, dy = py - ay, dz = pz - az;
                    distSq = dx*dx + dy*dy + dz*dz;
                } else {
                    const abx = bEdgesX2[e] - ax;
                    const aby = bEdgesY2[e] - ay;
                    const abz = bEdgesZ2[e] - az;
                    let t = ((px - ax)*abx + (py - ay)*aby + (pz - az)*abz) / lenSq;
                    if (t < 0) t = 0; else if (t > 1) t = 1;
                    const dx = px - (ax + t*abx);
                    const dy = py - (ay + t*aby);
                    const dz = pz - (az + t*abz);
                    distSq = dx*dx + dy*dy + dz*dz;
                }
                
                if (distSq < minSq) minSq = distSq;
            }
            minDistSqArr[u] = minSq;
        }
    }

    const minDistToBnd = new Float32Array(numUnique);
    for (let i = 0; i < numUnique; i++) {
        if (isSelectedUID[i] === 1) {
            // Distance = Euclidean Distance. 
            // Add subtle 0.005 buffer so clamped triangles don't shrink to strictly zero area at boundaries
            minDistToBnd[i] = Math.sqrt(minDistSqArr[i]) + 0.005;
        } else {
            minDistToBnd[i] = 0.0;
        }
    }
    
    if (DEBUG) console.timeEnd("Worker: Exact Distance to Boundary");

    // --- 1. DISPLACEMENT LOOP ---
    self.postMessage({ task: 'status', key: 'statusTexture', next: 'statusWallGen' });
    if (DEBUG) console.time("Worker: Displacement Loop");

    // Construct THREE.BufferGeometry to use with applyDisplacement
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    if (selection) {
        geometry.setAttribute('selection', new THREE.BufferAttribute(selection, 1));
    }

    const imageData = { data: textureData };
    
    // Calculate bounds if not fully provided (though textureEngine will send it, safety fallback)
    let boundsBounds = params.bounds || { min:{x:0,y:0,z:0}, max:{x:0,y:0,z:0}, center:{x:0,y:0,z:0}, size:{x:1,y:1,z:1} };

    let md = 1.0;
    if (boundsBounds && boundsBounds.size) {
        md = Math.max(boundsBounds.size.x, Math.max(boundsBounds.size.y, boundsBounds.size.z));
        if (md < 0.0001) md = 1.0;
    }

    const K = Math.pow(2.0, scale || 0);
    let scaleU_val = K / md;
    let scaleV_val = K / md;

    if (mappingMode === 3) {
        scaleU_val = K / (Math.PI * md);
    } else if (mappingMode === 4) {
        scaleU_val = K / (Math.PI * md);
        scaleV_val = K / ((Math.PI / 2.0) * md);
    }

    const settings = {
        mappingMode: mappingMode,
        scaleU: scaleU_val,
        scaleV: scaleV_val,
        offsetU: offset,
        offsetV: offset,
        amplitude: amp,
        rotation: params.rotation ? params.rotation * (180 / Math.PI) : 0, // wait applyDisplacement expects degrees
        symmetricDisplacement: false, // Folder A does not center around 0.5
        bottomAngleLimit: 0,
        topAngleLimit: 0,
        mappingBlend: params.mappingBlend || 0,
        seamBandWidth: params.seamBandWidth || 0.35,
        rotationZ: params.rotation || 0,
        matrixWorld: params.matrixWorld ? new THREE.Matrix4().fromArray(params.matrixWorld) : null,
        planarProjMat: params.planarProjMat ? new THREE.Matrix4().fromArray(params.planarProjMat) : null
    };

    const onProgress = (p) => {
        // can send progress back
    };

    // Apply modular displacement
    const displacedGeo = applyDisplacement(
        geometry,
        imageData,
        width,
        height,
        settings,
        boundsBounds,
        onProgress,
        uniqueIDs,
        isBoundaryVertex,
        smoothNormalsAccum,
        minDistToBnd
    );

    // Write back displaced positions and normals to the raw arrays
    positions.set(displacedGeo.attributes.position.array);
    normals.set(displacedGeo.attributes.normal.array);

    if (DEBUG) console.timeEnd("Worker: Displacement Loop");

    // --- 2. WALL GENERATION (MEMORY OPTIMIZED) ---
    // Strategy:
    // 1. (Already Done) Quantize Original Vertices to get Coincident Indices.
    // 2. Identify Edges of SELECTED faces.
    // 3. Sort Edges to find Boundary (appears once).
    // 4. Generate Geometry into pre-allocated buffer.

    // Step B: Collect Edges of Selected Faces
    // Step B: Collect Edges of Selected Faces
    self.postMessage({ task: 'status', key: 'statusWallGen', next: 'statusFinishing' });
    if (DEBUG) console.time("Worker: Wall Generation");
    
    // If NO faces are selected, there's nothing to do, return early.
    if (selFaceCount === 0) {
        self.postMessage({ 
            positions: positions, 
            normals: normals, 
            status: 'complete' 
        }, [positions.buffer, normals.buffer]);
        return;
    }

    // F-06: Clone positions NOW â€” only when walls are actually needed.
    // This saves ~60MB on full-model or empty-selection bakes (which exit above).
    originalPositions = positions.slice();

    // (Edge extraction logic was moved upstream for the Distance Field calculation)
    // We reuse edgeHead, edgeNext, edgeShared, and edgeMetaArr created above.

    // Step C: Identify Boundary & Generate Walls
    // Iterate over uniquely identified borders

    let wPos = new Float32Array(65536 * 9); // Start with ~20k tris
    let wNorm = new Float32Array(65536 * 9);
    let wPtr = 0;

    const expand = () => {
        const newSize = wPos.length * 2;
        const nP = new Float32Array(newSize);
        nP.set(wPos);
        wPos = nP;

        const nN = new Float32Array(newSize);
        nN.set(wNorm);
        wNorm = nN;
    };

    // Sub/Cross/Norm Helpers
    // F-18: Pre-allocate cross result to avoid object allocation in hot loop
    const _crossResult = { x: 0, y: 0, z: 0 };
    const cross = (ax, ay, az, bx, by, bz) => {
        _crossResult.x = ay * bz - az * by;
        _crossResult.y = az * bx - ax * bz;
        _crossResult.z = ax * by - ay * bx;
        return _crossResult;
    };

    for (let u = 0; u < numUnique; u++) {
        for (let slot = edgeHead[u]; slot !== -1; slot = edgeNext[slot]) {
            if (edgeShared[slot] === 0) {
                // Unshared edge found! But is it a true boundary, or just an internal T-junction 
                // caused by adaptive longest-edge bisection?
                const meta = edgeMetaArr[slot];
                // Recover face base to handle wrap around
                const faceBase = Math.floor(meta / 3) * 3;
                const local = meta % 3;

                let idx1 = meta;
                let idx2 = (local === 2) ? faceBase : meta + 1; // Wrap i+2 -> i
                
                // CRITICAL FIX: To prevent millions of false walls dropping down from T-Junctions 
                // inside the heavily subdivided selected area, we verify that BOTH vertices were
                // detected as true boundary vertices (sharing an unselected face) during pre-computation.
                const uid1 = uniqueIDs[idx1];
                const uid2 = uniqueIDs[idx2];
                if (isBoundaryVertex[uid1] === 0 || isBoundaryVertex[uid2] === 0) {
                    continue; // This is a false boundary (internal T-junction). Skip it!
                }

            // Wall Vertices
            // Top: Displaced (positions)
            // Bot: Original (originalPositions)

            const p1tx = positions[idx1 * 3], p1ty = positions[idx1 * 3 + 1], p1tz = positions[idx1 * 3 + 2];
            const p2tx = positions[idx2 * 3], p2ty = positions[idx2 * 3 + 1], p2tz = positions[idx2 * 3 + 2];

            const p1bx = originalPositions[idx1 * 3], p1by = originalPositions[idx1 * 3 + 1], p1bz = originalPositions[idx1 * 3 + 2];
            const p2bx = originalPositions[idx2 * 3], p2by = originalPositions[idx2 * 3 + 1], p2bz = originalPositions[idx2 * 3 + 2];

            // Check Height Diff
            const d1 = (p1tx - p1bx) ** 2 + (p1ty - p1by) ** 2 + (p1tz - p1bz) ** 2;
            const d2 = (p2tx - p2bx) ** 2 + (p2ty - p2by) ** 2 + (p2tz - p2bz) ** 2;
            if (d1 < 1e-9 && d2 < 1e-9) continue;

            // Expand?
            if (wPtr + 18 > wPos.length) expand();

            // Calc Normal (Fix winding/normal: cross B with A gives outward normal)
            const vAx = p2tx - p1tx, vAy = p2ty - p1ty, vAz = p2tz - p1tz;
            const vBx = p1bx - p1tx, vBy = p1by - p1ty, vBz = p1bz - p1tz;
            const c = cross(vBx, vBy, vBz, vAx, vAy, vAz);
            const l = Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z);
            const nx = l ? c.x / l : 0, ny = l ? c.y / l : 0, nz = l ? c.z / l : 0;

            // Quad (2 Tris) - CCW Winding for outward facing normals
            // Tri 1: T1, T2, B1
            wPos[wPtr] = p1tx; wPos[wPtr + 1] = p1ty; wPos[wPtr + 2] = p1tz;
            wNorm[wPtr] = nx; wNorm[wPtr + 1] = ny; wNorm[wPtr + 2] = nz; wPtr += 3;

            wPos[wPtr] = p2tx; wPos[wPtr + 1] = p2ty; wPos[wPtr + 2] = p2tz;
            wNorm[wPtr] = nx; wNorm[wPtr + 1] = ny; wNorm[wPtr + 2] = nz; wPtr += 3;

            wPos[wPtr] = p1bx; wPos[wPtr + 1] = p1by; wPos[wPtr + 2] = p1bz;
            wNorm[wPtr] = nx; wNorm[wPtr + 1] = ny; wNorm[wPtr + 2] = nz; wPtr += 3;

            // Tri 2: T2, B2, B1
            wPos[wPtr] = p2tx; wPos[wPtr + 1] = p2ty; wPos[wPtr + 2] = p2tz;
            wNorm[wPtr] = nx; wNorm[wPtr + 1] = ny; wNorm[wPtr + 2] = nz; wPtr += 3;

            wPos[wPtr] = p2bx; wPos[wPtr + 1] = p2by; wPos[wPtr + 2] = p2bz;
            wNorm[wPtr] = nx; wNorm[wPtr + 1] = ny; wNorm[wPtr + 2] = nz; wPtr += 3;

            wPos[wPtr] = p1bx; wPos[wPtr + 1] = p1by; wPos[wPtr + 2] = p1bz;
            wNorm[wPtr] = nx; wNorm[wPtr + 1] = ny; wNorm[wPtr + 2] = nz; wPtr += 3;
            }
        }
    }
    if (DEBUG) console.timeEnd("Worker: Wall Generation");

    // --- 3. MERGE & COMPUTE NORMALS (ZERO COPY OPTIMIZATION) ---
    if (DEBUG) console.time("Worker: Finalize Geometry");

    // A. Compute Normals for Displaced Mesh
    // For SELECTED faces: accumulate smooth normals per unique vertex (uses already-built uniqueIDs weld)
    //   â†’ eliminates visible T-junction seam lines from LEB subdivision.
    // For UNSELECTED faces: keep flat normals so the original unfactored mesh looks correct.
    const numVertices = positions.length / 3;
    const numFacesTotal = numVertices / 3; // triangle soup

    // Pass 1: compute per-face flat normal for ALL faces (needed for accum and unselected)
    const faceNX = new Float32Array(numFacesTotal);
    const faceNY = new Float32Array(numFacesTotal);
    const faceNZ = new Float32Array(numFacesTotal);
    for (let f = 0; f < numFacesTotal; f++) {
        const i3 = f * 9;
        const ax = positions[i3], ay = positions[i3+1], az = positions[i3+2];
        const bx = positions[i3+3], by = positions[i3+4], bz = positions[i3+5];
        const cx = positions[i3+6], cy = positions[i3+7], cz = positions[i3+8];
        const ux = bx-ax, uy = by-ay, uz = bz-az;
        const vx = cx-ax, vy = cy-ay, vz = cz-az;
        let nx = uy*vz - uz*vy;
        let ny = uz*vx - ux*vz;
        let nz = ux*vy - uy*vx;
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
        if (len > 0) { nx /= len; ny /= len; nz /= len; }
        faceNX[f] = nx; faceNY[f] = ny; faceNZ[f] = nz;
    }

    // Pass 2: accumulate smooth normals per welded vertex â€” only for SELECTED faces
    const selSmNX = new Float32Array(numUnique);
    const selSmNY = new Float32Array(numUnique);
    const selSmNZ = new Float32Array(numUnique);
    for (let f = 0; f < faceCount; f++) {
        if (faceSelected[f] === 0) continue;
        const nx = faceNX[f], ny = faceNY[f], nz = faceNZ[f];
        for (let j = 0; j < 3; j++) {
            const uid = uniqueIDs[f * 3 + j];
            selSmNX[uid] += nx;
            selSmNY[uid] += ny;
            selSmNZ[uid] += nz;
        }
    }
    // Normalize accumulated normals
    for (let u = 0; u < numUnique; u++) {
        const len = Math.sqrt(selSmNX[u]*selSmNX[u] + selSmNY[u]*selSmNY[u] + selSmNZ[u]*selSmNZ[u]);
        if (len > 0) { selSmNX[u] /= len; selSmNY[u] /= len; selSmNZ[u] /= len; }
    }

    // Pass 3: write normals into buffer
    for (let f = 0; f < numFacesTotal; f++) {
        const i3 = f * 9;
        if (f < faceCount && faceSelected[f] === 1) {
            // Smooth normals for selected displaced faces
            for (let j = 0; j < 3; j++) {
                const uid = uniqueIDs[f * 3 + j];
                normals[i3 + j*3]     = selSmNX[uid];
                normals[i3 + j*3 + 1] = selSmNY[uid];
                normals[i3 + j*3 + 2] = selSmNZ[uid];
            }
        } else {
            // Flat normals for unselected faces
            const nx = faceNX[f], ny = faceNY[f], nz = faceNZ[f];
            normals[i3]   = nx; normals[i3+1] = ny; normals[i3+2] = nz;
            normals[i3+3] = nx; normals[i3+4] = ny; normals[i3+5] = nz;
            normals[i3+6] = nx; normals[i3+7] = ny; normals[i3+8] = nz;
        }
    }

    // B. Merge with Walls
    const finalWPos = wPos.slice(0, wPtr);
    const finalWNorm = wNorm.slice(0, wPtr);

    let outputPos, outputNorm, outputSel;

    if (wPtr > 0) {
        // We must allocate a new buffer to hold both.
        // This is the only allocation. 
        const totalLen = positions.length + finalWPos.length;
        outputPos = new Float32Array(totalLen);
        outputNorm = new Float32Array(totalLen);

        // Selection: one value per vertex. Original faces keep their faceSelected value.
        // Wall / unselected faces get 0.
        const origFaceCount = positions.length / 9;
        const wallFaceCount = finalWPos.length / 9;
        outputSel = new Float32Array((origFaceCount + wallFaceCount) * 3);
        for (let f = 0; f < origFaceCount; f++) {
            const sel = f < faceCount ? faceSelected[f] : 0;
            outputSel[f * 3]     = sel;
            outputSel[f * 3 + 1] = sel;
            outputSel[f * 3 + 2] = sel;
        }
        // Walls stay 0

        // Copy Displaced Mesh
        outputPos.set(positions, 0);
        outputNorm.set(normals, 0);

        // Copy Walls
        outputPos.set(finalWPos, positions.length);
        outputNorm.set(finalWNorm, normals.length);
    } else {
        // No walls, pass original (modified) buffers directly
        outputPos = positions;
        outputNorm = normals;
        // Build selection buffer from faceSelected
        outputSel = new Float32Array(faceCount * 3);
        for (let f = 0; f < faceCount; f++) {
            const sel = faceSelected[f];
            outputSel[f * 3] = sel; outputSel[f * 3 + 1] = sel; outputSel[f * 3 + 2] = sel;
        }
    }

    if (DEBUG) console.timeEnd("Worker: Finalize Geometry");

    // Fix single-triangle holes before sending mesh back to main thread
    const fixedGeom = fillSmallHoles(outputPos, outputNorm, outputSel, Q);

    self.postMessage({
        positions: fixedGeom.positions, 
        normals: fixedGeom.normals,  
        selection: fixedGeom.selection, 
        status: 'complete'
    }, [fixedGeom.positions.buffer, fixedGeom.normals.buffer, fixedGeom.selection.buffer]);
};

// --- END OF DISPLACEMENT WORKER ---
// Legacy handleRemesh removed - subdivision now runs on main thread via subdivision.js
