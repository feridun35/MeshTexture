import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import AppState from './appState.js';
import { createPreviewMaterial, updateMaterial } from './previewMaterial.js';

export class TextureEngine {
    constructor() {
        this.uniforms = {
            textureScale: { value: 0.0 }, // 0 = 1x
            textureAmp: { value: -0.40 },
            textureSharpness: { value: 10.0 },
            textureOffset: { value: 0.0 },
            textureRotation: { value: 0.0 }, // New
            uTriplanarMap: { value: null },

            // New Projection Props
            projectionMode: { value: 0 }, // 0=Triplanar, 1=Planar
            planarProjMat: { value: new THREE.Matrix4() },

            // Spherical Mode
            mappingMode: { value: 0 },
            poleSmoothness: { value: 0.0 }
        };

        // Initialize Worker
        // Use v=2.1.8 static string to allow V8 to cache JIT compilation across page loads.
        const workerUrl = new URL('./displacement.worker.js?v=2.1.8', import.meta.url);
        this.worker = new Worker(workerUrl, { type: 'module' });
        this.worker.onerror = (e) => {
            console.error("Worker Error:", e);
            alert("Bake Worker Error: " + e.message);
        };
    }

    updateUniforms() {
        if (!AppState.mesh || !AppState.mesh.material) return;

        const bounds = this.currentBounds;
        let md = 1.0;
        if (bounds && bounds.size) {
            md = Math.max(bounds.size.x, Math.max(bounds.size.y, bounds.size.z));
            if (md < 0.0001) md = 1.0;
        }

        const K = Math.pow(2.0, AppState.params.textureScale || 0);
        let sU = K / md;
        let sV = K / md;

        if (AppState.params.mappingMode === 3) {
            sU = K / (Math.PI * md);
        } else if (AppState.params.mappingMode === 4) {
            sU = K / (Math.PI * md);
            sV = K / ((Math.PI / 2.0) * md);
        }

        const settings = {
            mappingMode: AppState.params.mappingMode || 0,
            scaleU: sU,
            scaleV: sV,
            amplitude: AppState.params.textureAmplitude || 0,
            offsetU: AppState.params.textureOffset || 0,
            offsetV: AppState.params.textureOffset || 0,
            rotation: AppState.params.textureRotation || 0.0,
            bounds: bounds,
            bottomAngleLimit: 0,
            topAngleLimit: 0,
            mappingBlend: AppState.params.mappingBlend || 0,
            seamBandWidth: AppState.params.seamBandWidth || 0.35,
            symmetricDisplacement: false,
            useDisplacement: false // Visual bump only in preview
        };

        updateMaterial(AppState.mesh.material, this.uniforms.uTriplanarMap.value, settings);

        // Optional: Keep planarProjMat uniform synced for potential future hybrid use
        if (AppState.mesh.material.uniforms && AppState.mesh.material.uniforms.planarProjMat) {
            AppState.mesh.material.uniforms.planarProjMat.value.copy(AppState.params.planarProjMat);
        }

        // F-10: Shader uniforms changed → scene needs a render next frame.
        AppState.markDirty();
    }

    resetMesh(mesh, originalGeometry) {
        // Legacy/Simple reset
        if (!mesh || !originalGeometry) return;
        if (mesh.geometry) mesh.geometry.dispose();
        mesh.geometry = originalGeometry;
        mesh.geometry.computeVertexNormals();
        if (this.uniforms) this.updateUniforms();
    }

    updateActiveMesh(restoredGeometry) {
        console.log("[TextureEngine] updateActiveMesh called");
        if (!AppState.mesh || !restoredGeometry) return;

        const oldMesh = AppState.mesh;
        const scene = oldMesh.parent;

        if (!scene) {
            console.warn("Old mesh has no parent scene!");
            // Fallback to simple swap
            this.resetMesh(oldMesh, restoredGeometry);
            return;
        }

        console.log("[TextureEngine] Removing old mesh, adding new...");

        // 1. Remove Old
        scene.remove(oldMesh);

        // 2. Dispose Old
        if (oldMesh.geometry) oldMesh.geometry.dispose();
        if (oldMesh.material) {
            if (Array.isArray(oldMesh.material)) {
                oldMesh.material.forEach(m => m.dispose());
            } else {
                oldMesh.material.dispose();
            }
        }

        // 3. Create New Mesh
        // Reuse restored geometry
        const newMesh = new THREE.Mesh(restoredGeometry, null); // Material applied next
        newMesh.castShadow = true;
        newMesh.receiveShadow = true;

        // 4. Apply Material
        this.applyTriplanarMaterial(newMesh); // Creates new material and uniforms

        // 5. Add to Scene
        scene.add(newMesh);

        // 6. Update AppState Reference
        AppState.mesh = newMesh;
        console.log("[TextureEngine] Mesh Updated in AppState");

        // Mark geometry dirty for F-02: the topology has changed, so the next
        // _createSnapshot must capture this new geometry for correct Redo behaviour.
        AppState.markGeometryDirty();

        // 7. Refresh Uniforms (sync with params)
        this.updateUniforms();
    }

    applyTriplanarMaterial(mesh) {
        if (!mesh) return;

        if (!mesh.geometry.attributes.fs_selection) {
            const count = mesh.geometry.attributes.position.count;
            mesh.geometry.setAttribute('fs_selection', new THREE.BufferAttribute(new Float32Array(count), 1));
        }

        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeBoundingSphere();
        this.currentBounds = {
            min: mesh.geometry.boundingBox.min,
            max: mesh.geometry.boundingBox.max,
            center: mesh.geometry.boundingSphere.center,
            size: new THREE.Vector3().subVectors(mesh.geometry.boundingBox.max, mesh.geometry.boundingBox.min)
        };

        let md = 1.0;
        if (this.currentBounds && this.currentBounds.size) {
            md = Math.max(this.currentBounds.size.x, Math.max(this.currentBounds.size.y, this.currentBounds.size.z));
            if (md < 0.0001) md = 1.0;
        }

        const K = Math.pow(2.0, AppState.params.textureScale || 0);
        let sU = K / md;
        let sV = K / md;

        if (AppState.params.mappingMode === 3) {
            sU = K / (Math.PI * md);
        } else if (AppState.params.mappingMode === 4) {
            sU = K / (Math.PI * md);
            sV = K / ((Math.PI / 2.0) * md);
        }

        const settings = {
            mappingMode: AppState.params.mappingMode || 0,
            scaleU: sU,
            scaleV: sV,
            amplitude: AppState.params.textureAmplitude || 0,
            offsetU: AppState.params.textureOffset || 0,
            offsetV: AppState.params.textureOffset || 0,
            rotation: AppState.params.textureRotation || 0.0,
            bounds: this.currentBounds,
            bottomAngleLimit: 0,
            topAngleLimit: 0,
            mappingBlend: AppState.params.mappingBlend || 0,
            seamBandWidth: AppState.params.seamBandWidth || 0.35,
            symmetricDisplacement: false,
            useDisplacement: false
        };

        mesh.material = createPreviewMaterial(this.uniforms.uTriplanarMap.value, settings);
        
        // We inject planarProjMat manually just in case
        mesh.material.uniforms.planarProjMat = { value: AppState.params.planarProjMat.clone() };
    }

    updateProjectionBasis(mesh, forceAlign = false) {
        if (!mesh) return;

        if (!forceAlign) {
            // Default: Use object's local space for stable triplanar mapping.
            // This prevents the texture from sliding or rotating when the user's selection changes,
            // ensuring consistent texturing regardless of whether 1 face or all faces are selected.
            const worldToLocal = mesh.matrixWorld.clone().invert();

            // Update AppState
            AppState.params.planarProjMat.copy(worldToLocal);

            // Ensure Uniforms are synced
            this.updateUniforms();
            return;
        }

        // --- ALIGN TO SELECTION (forceAlign = true) ---
        if (AppState.selectedFaces.size === 0) return;

        const positions = mesh.geometry.attributes.position;
        const matrixWorld = mesh.matrixWorld;

        const selectedIndices = Array.from(AppState.selectedFaces);
        const numSelected = selectedIndices.length;

        // --- F-05: Pre-allocated scratch Vector3s (no per-call allocation) ---
        const _sA = new THREE.Vector3();
        const _sB = new THREE.Vector3();
        const _sC = new THREE.Vector3();

        // --- 1. SAMPLE NORMALS (Geometric) ---
        const getFaceNormal = (faceIdx, target) => {
            const i = faceIdx * 9;
            _sA.set(positions.array[i], positions.array[i + 1], positions.array[i + 2]);
            _sB.set(positions.array[i + 3], positions.array[i + 4], positions.array[i + 5]);
            _sC.set(positions.array[i + 6], positions.array[i + 7], positions.array[i + 8]);
            _sB.sub(_sA);
            _sC.sub(_sA);
            target.crossVectors(_sB, _sC).normalize();
            return target;
        };

        const getFaceCenter = (faceIdx, target) => {
            const i = faceIdx * 9;
            const ax = positions.array[i], ay = positions.array[i + 1], az = positions.array[i + 2];
            const bx = positions.array[i + 3], by = positions.array[i + 4], bz = positions.array[i + 5];
            const cx = positions.array[i + 6], cy = positions.array[i + 7], cz = positions.array[i + 8];
            target.set(ax + bx + cx, ay + by + cy, az + bz + cz).multiplyScalar(1 / 3);
            return target;
        };

        // Pick Candidates - Deterministic Stride
        const sampleCount = Math.min(numSelected, 200);
        const stride = Math.max(1, Math.floor(numSelected / sampleCount));
        const candidates = [];
        const _temp = new THREE.Vector3();

        for (let i = 0; i < sampleCount; i++) {
            const idx = selectedIndices[i * stride];
            const norm = getFaceNormal(idx, new THREE.Vector3());
            candidates.push(norm);
        }

        // --- 2. FIND DOMINANT CLUSTER ---
        let bestNormal = new THREE.Vector3(0, 1, 0);
        let maxScore = -1;

        const checkCount = Math.min(numSelected, 500);
        const checkStride = Math.max(1, Math.floor(numSelected / checkCount));

        for (const candidate of candidates) {
            let score = 0;
            const absX = Math.abs(candidate.x);
            const absY = Math.abs(candidate.y);
            const absZ = Math.abs(candidate.z);
            const isAxisAligned = (absX > 0.99 || absY > 0.99 || absZ > 0.99);

            for (let k = 0; k < checkCount; k++) {
                const idx = selectedIndices[k * checkStride];
                getFaceNormal(idx, _temp);

                const d = _temp.dot(candidate);
                if (d > 0.5) {
                    const power = isAxisAligned ? 25 : 20;
                    score += Math.pow(d, power);
                }
            }

            if (isAxisAligned) score *= 1.1;

            if (score > maxScore) {
                maxScore = score;
                bestNormal.copy(candidate);
            }
        }

        // --- 3. REFINE AVERAGE & CENTER ---
        const finalNormal = new THREE.Vector3();
        const finalCenter = new THREE.Vector3();
        let alignCount = 0;

        const iterStep = (numSelected > 20000) ? 5 : 1;

        for (let i = 0; i < numSelected; i += iterStep) {
            const idx = selectedIndices[i];
            getFaceNormal(idx, _temp);

            if (_temp.dot(bestNormal) > 0.9) {
                finalNormal.add(_temp);
                alignCount++;
            }
        }

        if (alignCount > 0) {
            finalNormal.normalize();
        } else {
            finalNormal.copy(bestNormal).normalize();
        }

        // Pinned Center: Always use the global mesh center instead of selection center
        // to prevent asymmetric ghosting and texture sliding between different selections.
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        mesh.geometry.boundingBox.getCenter(finalCenter);

        // Transform to World Space
        finalNormal.transformDirection(matrixWorld).normalize();
        finalCenter.applyMatrix4(matrixWorld);

        // --- 4. BUILD MATRIX ---
        const dummyObj = new THREE.Object3D();
        dummyObj.position.copy(finalCenter);
        dummyObj.lookAt(finalCenter.clone().add(finalNormal));
        dummyObj.updateMatrix();

        const worldToLocal = dummyObj.matrix.clone().invert();

        // Update AppState
        AppState.params.planarProjMat.copy(worldToLocal);

        // Ensure Uniforms are synced
        this.updateUniforms();
    }

    loadTexture(file) {
        if (!file) return;
        const loader = new THREE.TextureLoader();
        const url = URL.createObjectURL(file);

        loader.load(url, (tex) => {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            this.uniforms.uTriplanarMap.value = tex;

            // Enable UI Controls
            const controls = document.getElementById('textureControls');
            if (controls) {
                controls.style.opacity = '1';
                controls.style.pointerEvents = 'auto';
            }

            const exportBtn = document.getElementById('exportBtn');
            if (exportBtn) exportBtn.disabled = false;

            if (AppState.mesh) {
                // Force Material Update
                if (!AppState.mesh.material || AppState.mesh.material.type !== 'ShaderMaterial') {
                    this.applyTriplanarMaterial(AppState.mesh);
                } else {
                    AppState.mesh.material.needsUpdate = true;
                    this.updateUniforms(); 
                }
            }

            // Notify UI
            window.dispatchEvent(new Event('texture-loaded'));

        }, undefined, (err) => {
            console.error("Texture Load Error:", err);
            alert("Error loading texture image.");
            window.dispatchEvent(new Event('texture-error'));
        });
    }

    // --- CPU BAKING FOR EXPORT ---

    bakeGeometry(mesh) {
        return new Promise((resolve, reject) => {
            if (!mesh || !this.uniforms.uTriplanarMap.value) {
                reject(new Error("No mesh or texture loaded"));
                return;
            }

            const tex = this.uniforms.uTriplanarMap.value;
            const img = tex.image;

            // 1. Create Canvas to read pixels (Main Thread)
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            // Get raw data
            const imgData = ctx.getImageData(0, 0, img.width, img.height);
            const textureData = imgData.data; // Uint8ClampedArray

            // 2. Prepare Geometry Data
            const oldGeo = mesh.geometry;
            const posAttr = oldGeo.attributes.position;
            const normAttr = oldGeo.attributes.normal;
            const selAttr = oldGeo.attributes.fs_selection;

            // Clone Buffers for Worker (Transferable)
            // F-09: Only one positions buffer is sent. The worker clones it internally
            // before the displacement loop to get originalPositions for wall generation.
            // This halves the main-thread allocation and transfer payload.
            const positions = new Float32Array(posAttr.array);
            const normals = new Float32Array(normAttr.array);
            const selection = selAttr ? new Float32Array(selAttr.array) : new Float32Array(positions.length / 3);

            // Add Bounds so worker knows the model size!
            // currentBounds should be populated by applyTriplanarMaterial / initialize
            let boundsData = this.currentBounds;
            if (!boundsData) {
                oldGeo.computeBoundingBox();
                oldGeo.computeBoundingSphere();
                boundsData = {
                    min: oldGeo.boundingBox.min,
                    max: oldGeo.boundingBox.max,
                    center: oldGeo.boundingSphere.center,
                    size: new THREE.Vector3().subVectors(oldGeo.boundingBox.max, oldGeo.boundingBox.min)
                };
            }

            const params = {
                scale: AppState.params.textureScale,
                offset: AppState.params.textureOffset,
                amp: AppState.params.textureAmplitude,
                rotation: (AppState.params.textureRotation || 0) * (Math.PI / 180),
                sharpness: AppState.params.textureSharpness,
                mappingMode: AppState.params.mappingMode || 0, // Fallback to MODE_PLANAR_XY/0 or 5 for triplanar
                poleSmoothness: AppState.params.poleSmoothness,
                bounds: boundsData,
                planarProjMat: AppState.params.planarProjMat.elements, 
                matrixWorld: mesh.matrixWorld.elements
            };

            // 3. Setup Worker Listener
            this.worker.onmessage = (e) => {
                const data = e.data;

                // Handle Status Updates
                if (data.task === 'status') {
                    window.dispatchEvent(new CustomEvent('bake-status', {
                        detail: { key: data.key, next: data.next }
                    }));
                    return;
                }

                if (data.error) {
                    reject(new Error(data.error));
                    return;
                }

                // Success
                const positions = data.positions; // Merged Float32Array from Transferable
                const normals = data.normals;     // Merged Float32Array from Transferable
                const selectionData = data.selection; // Per-vertex selection (1=selected, 0=not)

                // 4. Create Geometry (ZERO COPY)
                // The worker has already merged walls and computed normals.
                // We directly use the buffers.

                const finalGeo = new THREE.BufferGeometry();
                finalGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                finalGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

                // Attach selection as fs_selection so SimplifierWorker can do selective simplification.
                if (selectionData) {
                    finalGeo.setAttribute('fs_selection', new THREE.BufferAttribute(selectionData, 1));
                }

                // Add default vertex colors (gray) so material with vertexColors:true
                // has valid data. Without this, some GPU drivers render a black screen.
                const colorArray = new Float32Array(positions.length);
                colorArray.fill(0.5); // neutral gray
                finalGeo.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));

                finalGeo.computeBoundingBox();
                finalGeo.computeBoundingSphere();

                resolve(finalGeo);
            };

            // 4. Send Message (Zero Copy)
            // F-09: originalPositions removed from transfer — worker clones positions itself.
            this.worker.postMessage({
                positions: positions,
                normals: normals,
                selection: selection,
                textureData: textureData,
                width: img.width,
                height: img.height,
                params: params
            }, [positions.buffer, normals.buffer, selection.buffer]);

        });
    }
}
