import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import AppState from './appState.js';

export class LoaderModule {
    constructor() {
        this.loader = new STLLoader();
    }

    loadSTL(file, onProgress, onError) {
        if (!file) return;

        const url = URL.createObjectURL(file);

        this.loader.load(url, (geometry) => {
            if (AppState.mesh) {
                AppState.scene.remove(AppState.mesh);
                if (AppState.mesh.geometry) AppState.mesh.geometry.dispose();
                if (AppState.mesh.material && AppState.mesh.material.dispose) AppState.mesh.material.dispose();
                AppState.mesh = null;
                AppState.clearSelection();
                if (AppState.selectionModule) {
                    AppState.selectionModule.adjacencyGraph = null;
                    AppState.selectionModule.spatialGrid = null; // F-01: invalidate spatial grid
                    AppState.selectionModule.vertexConnectivity = null;
                }
            }

            // Centralize
            if (geometry.center) geometry.center();
            geometry.computeVertexNormals();
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();

            // Default Material (No Shader yet)
            const material = new THREE.MeshStandardMaterial({
                color: 0x888888,
                roughness: 0.5,
                metalness: 0.1,
                side: THREE.DoubleSide,
                vertexColors: true // Important for Selection Visuals
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            AppState.mesh = mesh;
            AppState.originalFilename = file.name;
            AppState.scene.add(mesh);

            this.focusCamera(geometry);

            const count = geometry.attributes.position.count / 3;
            const polyEl = document.getElementById('polyCount');
            if (polyEl) polyEl.innerText = count.toLocaleString();

            // Some binary STL files embed non-standard color bytes that Three.js STLLoader
            // parses as a 'color' vertex attribute (all black). Strip it here so updateVisuals
            // can initialize it cleanly to gray (0.5) via the F-08 forceFullReset path.
            if (geometry.attributes.color) {
                geometry.deleteAttribute('color');
            }

            // Force Initialization of Selection Attributes for Shader safety
            // forceFullReset=true: new geometry, the delta state from any previous session is invalid.
            if (AppState.selectionModule) {
                AppState.selectionModule._prevSelectedFaces = new Set(); // clear stale delta state
                AppState.selectionModule.updateVisuals(true);
            }

            // Centralized Reset
            window.dispatchEvent(new Event('reset-app'));

            URL.revokeObjectURL(url);
            console.log("STL Loaded:", file.name);

            if (onProgress) onProgress(100);

        }, (xhr) => {
            if (xhr.lengthComputable && onProgress) {
                const percent = (xhr.loaded / xhr.total) * 100;
                onProgress(percent);
            }
        }, (error) => {
            console.error("Error loading STL:", error);
            if (onError) onError(error);
            else alert("Failed to load STL file.");
        });
    }

    focusCamera(geometry) {
        if (!AppState.camera || !AppState.controls) return;

        // Target World Origin (0,0,0) since geometry is centered
        const center = new THREE.Vector3(0, 0, 0);

        const radius = geometry.boundingSphere ? geometry.boundingSphere.radius : 10;
        const fov = AppState.camera.fov * (Math.PI / 180);
        let distance = Math.abs(radius / Math.sin(fov / 2));
        distance *= 1.5; // 1.5x Padding for nice view

        const direction = new THREE.Vector3(0, 1, 2).normalize(); // 3/4 View

        AppState.controls.target.copy(center);
        AppState.camera.position.copy(direction.multiplyScalar(distance));
        AppState.camera.lookAt(center);
        AppState.controls.update();

        AppState.camera.near = radius / 100;
        AppState.camera.far = radius * 100;
        AppState.camera.updateProjectionMatrix();
    }
}
