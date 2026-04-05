import * as THREE from 'three';

/**
 * Centralized State Management
 * Holds all globally shared references to prevent prop-drilling and ensure consistency.
 */
const AppState = {
    // Three.js Core
    scene: null,
    camera: null,
    renderer: null,
    controls: null,

    // Scene Objects
    mesh: null,         // The main loaded STL mesh
    raycaster: null,

    // User Data
    selectedFaces: new Set(), // Indices of selected faces

    // --- ON-DEMAND RENDERING (F-10) ---
    // Set to true whenever the scene visually changes.
    // The animate loop only calls renderer.render() when this is true,
    // then clears it — preventing constant GPU/CPU burn while idle.
    needsRender: true, // Start true so the first frame always renders

    /**
     * Signal that the scene has changed and needs a render on the next frame.
     * Call this after any visual state change: texture load, uniform update,
     * mesh swap, selection change, theme switch, etc.
     */
    markDirty() {
        this.needsRender = true;
    },

    // Application Params
    params: {
        selectionMode: true, // false = simple, true = smart
        wireframe: false,
        angleThreshold: 30,   // degrees

        // Texture Params
        textureScale: 0.0,
        textureAmplitude: 0.40,
        textureSharpness: 20.0,
        textureOffset: 0.0,
        textureRotation: 0.0, // Degrees
        // patternMode Removed

        // Mapping Modes
        mappingMode: 5, // 5 = Triplanar
        poleSmoothness: 0.0, // 0.0 - 1.0
        isBaked: false, // Track bake state

        // Paint Mode Params
        paintModeActive: false,
        paintBrushSize: 3,
        paintAngleThreshold: 45,
        paintIgnoreBackfacing: true,

        projectionMode: 0, // 0=Triplanar, 1=Planar
        planarProjMat: new THREE.Matrix4(),
        
        simplifyIntensity: 2, // 1-5 intensity for texture decimation


        // F-20: diffuseMap and displacementMap removed — these were dead params.
        // Texture is stored on uniforms (textureEngine), not duplicated here.
    },

    // F-14: Tracks whether a bake is in progress.
    // Used by checkApplyButtonState to prevent double-bake without relying on
    // brittle English-only innerText checks (which broke in Turkish locale).
    isBaking: false,

    // Suppresses the 'selection-changed' listener in RemeshModule from resetting
    // firstRefineDone when the event is fired internally by applyRemeshResult → updateVisuals.
    _suppressRefineReset: false,

    /**
     * Safe Mesh Accessor
     * @returns {boolean} True if mesh is loaded and valid
     */
    isMeshReady() {
        return !!(this.mesh && this.mesh.geometry);
    },

    /**
     * Clear Selection safely
     */
    /**
     * Clear Selection safely
     */
    clearSelection() {
        if (this.selectedFaces) {
            this.selectedFaces.clear();
        }
    },

    // --- UNDO / REDO SYSTEM ---
    undoStack: [],
    redoStack: [],
    MAX_HISTORY: 10,

    /**
     * Tracks whether the geometry has been structurally modified since the last snapshot.
     * Only set to true by saveGeometryState() (before bake) or markGeometryDirty()
     * (before refine). _createSnapshot() clears it after capturing the clone.
     * This prevents cloning the full geometry buffer on every slider undo.
     */
    _geometryDirty: false,

    /**
     * Call this before any operation that modifies mesh geometry topology/positions.
     * Ensures the next _createSnapshot() will capture a geometry clone for Redo.
     */
    markGeometryDirty() {
        this._geometryDirty = true;
    },

    /**
     * Saves the CURRENT state to the undoStack.
     * Call this BEFORE making a change.
     */
    saveState() {
        // F-05: Manually serialize Matrix4 before cloning to preserve prototype
        const matElements = this.params.planarProjMat ? Array.from(this.params.planarProjMat.elements) : null;
        const origMat = this.params.planarProjMat;
        this.params.planarProjMat = matElements; // Temporarily replace with plain array

        let paramsCopy;
        try {
            paramsCopy = structuredClone(this.params);
        } catch (e) {
            paramsCopy = JSON.parse(JSON.stringify(this.params));
        }

        this.params.planarProjMat = origMat; // Restore original Matrix4

        // 2. Snapshot Selection (Set -> Array)
        const selectionCopy = Array.from(this.selectedFaces);

        // 3. Snapshot Geometry (Only if it exists)
        // We generally Assume geometry doesn't change often vs params.
        // However, for "Bake", we need to revert geometry. 
        // Strategy: We store a specific "geometryCheckpoint" only when we explicitly want to save geometry (before bake).
        // Since most ops don't change Geo, we don't clone it every time.
        // BUT, simple "undo" needs to know if it should restore geometry.
        // Let's rely on a flag or just store it if we are about to bake.
        // For simplicity: We will NOT clone geometry here automatically. 
        // The 'Bake' function in main.js will manually attach the old geometry to the state object if needed?
        // Better: store a reference to the geometry UUID. If undoing involves a different UUID, we might need to rely on the fact 
        // that we saved a CLONE of the geometry in the Undo step.

        // Revised Strategy:
        // We will store the actual CLONE of the geometry ONLY if we are performing a destructive action (like Bake).
        // Standard saveState for sliders/selection will NOT save geometry to save memory.

        const state = {
            type: 'standard',
            params: paramsCopy,
            selectedFaces: selectionCopy,
            timestamp: Date.now()
        };

        this.undoStack.push(state);
        if (this.undoStack.length > this.MAX_HISTORY) {
            this.undoStack.shift(); // Remove oldest
        }

        // clear Redo safely (unless we are in the middle of undoing? No, new action clears redo)
        this.redoStack = [];
        this.updateUndoRedoUI();
    },

    /**
     * Special Save for Geometry Changes (Baking)
     * call BEFORE baking.
     */
    saveGeometryState() {
        if (!this.mesh) return;

        // F-05: Manually serialize Matrix4
        const matElements = this.params.planarProjMat ? Array.from(this.params.planarProjMat.elements) : null;
        const origMat = this.params.planarProjMat;
        this.params.planarProjMat = matElements;

        let paramsCopy;
        try {
            paramsCopy = structuredClone(this.params);
        } catch (e) {
            paramsCopy = JSON.parse(JSON.stringify(this.params));
        }

        this.params.planarProjMat = origMat; // Restore original Matrix4
        const selectionCopy = Array.from(this.selectedFaces);

        // Clone Geometry (Expensive but necessary for Bake Undo)
        const geoClone = this.mesh.geometry.clone();

        const state = {
            type: 'geometry',
            params: paramsCopy,
            selectedFaces: selectionCopy,
            geometry: geoClone, // Store the geometry object
            timestamp: Date.now()
        };

        this.undoStack.push(state);
        if (this.undoStack.length > this.MAX_HISTORY) {
            // If we drop a geometry state, we should dispose it to avoid leaks?
            const dropped = this.undoStack.shift();
            if (dropped.geometry) dropped.geometry.dispose();
        }

        // Mark geometry dirty so _createSnapshot captures the current (pre-bake) shape for Redo
        this._geometryDirty = true;
        this.redoStack = [];
        this.updateUndoRedoUI();
    },

    undo() {
        if (this.undoStack.length === 0) return;

        // 1. Capture current state for Redo.
        // Before the baked geometry existed, the user is at a post-bake state,
        // so _geometryDirty should already be true from saveGeometryState.
        // For standard (param-only) undos, we skip the expensive clone.
        const currentState = this._createSnapshot();
        this.redoStack.push(currentState);

        // 2. Pop Undo
        const prevState = this.undoStack.pop();

        // 3. Restore
        this.restoreState(prevState);
        this.updateUndoRedoUI();
    },

    redo() {
        if (this.redoStack.length === 0) return;

        // 1. Capture current state for Undo (lazy geometry clone).
        const currentState = this._createSnapshot();
        // Dispose old redo geometry that gets bumped off if undo stack would overflow
        this.undoStack.push(currentState);
        if (this.undoStack.length > this.MAX_HISTORY) {
            const dropped = this.undoStack.shift();
            if (dropped.geometry) dropped.geometry.dispose();
        }

        // 2. Pop Redo
        const nextState = this.redoStack.pop();

        // 3. Restore
        this.restoreState(nextState);
        this.updateUndoRedoUI();
    },

    _createSnapshot() {
        // Internal helper to create state object of CURRENT world for the opposite stack.
        // F-05: Manually serialize Matrix4
        const matElements = this.params.planarProjMat ? Array.from(this.params.planarProjMat.elements) : null;
        const origMat = this.params.planarProjMat;
        this.params.planarProjMat = matElements;

        let paramsCopy;
        try {
            paramsCopy = structuredClone(this.params);
        } catch (e) {
            paramsCopy = JSON.parse(JSON.stringify(this.params));
        }

        this.params.planarProjMat = origMat; // Restore original Matrix4

        const selectionCopy = Array.from(this.selectedFaces);

        // --- LAZY GEOMETRY CLONE (F-02 optimization) ---
        // Only clone geometry when _geometryDirty is true, i.e. a bake or refine
        // has structurally changed the mesh since the last snapshot.
        // For slider/selection-only undos, geometry hasn't changed — skip the clone.
        // This prevents allocating hundreds of MB on every ordinary Ctrl+Z.
        let geoClone = null;
        if (this._geometryDirty && this.mesh && this.mesh.geometry) {
            geoClone = this.mesh.geometry.clone();
            // Clear the flag — geometry is now captured.
            this._geometryDirty = false;
        }

        return {
            type: 'snapshot',
            params: paramsCopy,
            selectedFaces: selectionCopy,
            geometry: geoClone
        };
    },

    restoreState(state) {
        // 1. Restore Params
        // We need to be careful not to overwrite objects/references we don't want to lose, 
        // but replacing the whole tree is usually fine for these simple params.
        // Exceptions: nulls or maps not in JSON.
        // existing params:
        /*
        params: {
            selectionMode: false,
            wireframe: false,
            angleThreshold: 30,
            textureScale: 0.0,
            textureAmplitude: -0.40,
            textureSharpness: 10.0,
            textureOffset: 0.0,
            textureRotation: 0.0,
            mappingMode: 0,
            poleSmoothness: 0.0,
            projectionMode: 0,
            planarProjMat: Object (Matrix4) -> JSON stringify makes it an object, need to rehydrate?
            diffuseMap: null, // Image/Texture object. JSON won't preserve this!
            displacementMap: null
        }
        */

        // Rehydrate Logic
        // We only overwrite the SCALAR/Serializable values. 
        // We preserve Resources (Maps) and Complex Objects unless we serialize them manually.

        const p = state.params;
        const current = this.params;

        current.selectionMode = p.selectionMode;
        current.wireframe = p.wireframe;
        current.angleThreshold = p.angleThreshold;

        current.textureScale = p.textureScale;
        current.textureAmplitude = p.textureAmplitude;
        current.textureSharpness = p.textureSharpness;
        current.textureOffset = p.textureOffset;
        current.textureRotation = p.textureRotation;

        current.mappingMode = p.mappingMode;
        current.poleSmoothness = p.poleSmoothness;

        // F-05: Restore projectionMode and rehydrate planarProjMat from array
        if (p.projectionMode !== undefined) current.projectionMode = p.projectionMode;
        if (p.planarProjMat) {
            if (Array.isArray(p.planarProjMat)) {
                current.planarProjMat = new THREE.Matrix4().fromArray(p.planarProjMat);
            } else if (p.planarProjMat.elements) {
                current.planarProjMat = new THREE.Matrix4().fromArray(
                    Array.isArray(p.planarProjMat.elements) ? p.planarProjMat.elements : Array.from(p.planarProjMat.elements)
                );
            }
        }

        // Restore Paint Params
        if (p.paintModeActive !== undefined) current.paintModeActive = p.paintModeActive;
        if (p.paintBrushSize !== undefined) current.paintBrushSize = p.paintBrushSize;
        if (p.paintAngleThreshold !== undefined) current.paintAngleThreshold = p.paintAngleThreshold;
        if (p.paintIgnoreBackfacing !== undefined) current.paintIgnoreBackfacing = p.paintIgnoreBackfacing;

        // Restore Selection
        this.selectedFaces = new Set(state.selectedFaces);

        // Geometry Restore
        if (state.geometry && this.mesh) {
            const currentCount = this.mesh.geometry.attributes.position.count;
            const restoredCount = state.geometry.attributes.position.count;

            console.log(`[Restore] Current vCount: ${currentCount}, Restored vCount: ${restoredCount}`);

            if (currentCount !== restoredCount && this.textureEngine && typeof this.textureEngine.updateActiveMesh === 'function') {
                console.log("[Restore] Triggering updateActiveMesh for Topology Change");
                // FORCE COMPLETE SWAP for Topology Changes (Refine Undo)
                this.textureEngine.updateActiveMesh(state.geometry.clone());
            }
            else if (this.textureEngine && typeof this.textureEngine.resetMesh === 'function') {
                console.log("[Restore] Triggering resetMesh (standard)");
                // Simple Swap (Bake Undo)
                this.textureEngine.resetMesh(this.mesh, state.geometry.clone());
            } else {
                console.warn("[Restore] Fallback geometry restore");
                this.mesh.geometry = state.geometry.clone();
                this.mesh.geometry.computeVertexNormals();
            }
        }

        // Force Uniform Update (CRITICAL for Redo of Bake)
        if (this.textureEngine) {
            this.textureEngine.updateUniforms();
        }

        // Update Global UI
        // Dispatch event with state data so main.js can update 'Baked' button text etc.
        const event = new CustomEvent('app-state-restored', { detail: state });
        window.dispatchEvent(event);
    },

    updateUndoRedoUI() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');

        if (undoBtn) {
            undoBtn.disabled = this.undoStack.length === 0;
            if (undoBtn.disabled) undoBtn.classList.add('disabled');
            else undoBtn.classList.remove('disabled');
        }

        if (redoBtn) {
            redoBtn.disabled = this.redoStack.length === 0;
            if (redoBtn.disabled) redoBtn.classList.add('disabled');
            else redoBtn.classList.remove('disabled');
        }
    }
};

window.AppState = AppState; // For debugging access
export default AppState;
