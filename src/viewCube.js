import * as THREE from 'three';
import AppState from './appState.js';

export class ViewCube {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;
        
        this.scene = new THREE.Scene();
        
        // Use OrthographicCamera to prevent perspective distortion on the cube 
        // which makes it look exactly like Fusion 360's HUD ViewCube
        this.camera = new THREE.OrthographicCamera(-1.2, 1.2, 1.2, -1.2, 0.1, 100);
        this.camera.position.set(0, 0, 3);
        
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);
        
        // Lighting
        const ambient = new THREE.AmbientLight(0xffffff, 2.5);
        this.scene.add(ambient);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(2, 5, 5);
        this.scene.add(dirLight);

        this.cubeGroup = new THREE.Group();
        this.scene.add(this.cubeGroup);

        this.interactTargets = [];
        this.hoveredTarget = null;
        this.needsRender = true;
        // F-08: Pre-allocate scratch vectors to avoid GC in update()
        this._scratchDir = new THREE.Vector3();
        // F-20: Track current theme to rebuild materials on change
        this._currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        
        this.initCube();
        
        // Raycasting
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.container.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.container.addEventListener('mouseleave', this.onMouseLeave.bind(this));
        this.container.addEventListener('click', this.onClick.bind(this));
        
        // Observe container resize (optional)
        const resizeObserver = new ResizeObserver(() => {
            if (this.container.clientWidth === 0) return;
            this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
            this.needsRender = true;
        });
        resizeObserver.observe(this.container);

        // Home Button
        this.homeBtn = document.getElementById('viewCubeHomeBtn');
        if (this.homeBtn) {
            this.homeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.tweenMainCameraToHome();
            });
        }
    }

    getTextMaterial(text) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#e6e9ec'; 
        // F-15: Cache theme attribute once instead of 3 DOM reads
        const theme = document.documentElement.getAttribute('data-theme');
        const isDark = theme === 'dark';
        if (isDark) {
            ctx.fillStyle = '#2a2d30';
        }
        ctx.fillRect(0, 0, 256, 256);

        // Border inside
        ctx.strokeStyle = isDark ? '#555' : '#b0b8c0';
        ctx.lineWidth = 12;
        ctx.strokeRect(0, 0, 256, 256);

        // Text
        ctx.fillStyle = isDark ? '#eee' : '#556677';
        ctx.font = 'bold 50px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 128);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        
        return new THREE.MeshLambertMaterial({ 
            map: tex, 
            side: THREE.DoubleSide
        });
    }

    initCube() {
        // Visual Background Cube
        const mats = [
            this.getTextMaterial('RIGHT'),
            this.getTextMaterial('LEFT'),
            this.getTextMaterial('TOP'),
            this.getTextMaterial('BOTTOM'),
            this.getTextMaterial('FRONT'),
            this.getTextMaterial('BACK')
        ];
        
        // Make visual cube slightly smaller so interact targets handle hover perfectly without Z-fighting
        const boxGeo = new THREE.BoxGeometry(0.98, 0.98, 0.98);
        this.visualCube = new THREE.Mesh(boxGeo, mats);
        this.cubeGroup.add(this.visualCube);

        // Interact Targets (Seamlessly tiled 26 sub-boxes representing corners, edges, faces)
        const highlightMat = new THREE.MeshBasicMaterial({ 
            color: 0x2196F3, // Accent blue 
            transparent: true, 
            opacity: 0.4, 
            depthWrite: false, // Prevents depth issues when rendering over visual cube
            side: THREE.FrontSide
        });

        // Split the 1x1x1 volume into a 3x3x3 grid:
        // Center block size: 0.6, Edge blocks size: 0.2
        const getSize = (idx) => idx === 0 ? 0.6 : 0.2;
        const getPos = (idx) => idx === 0 ? 0 : (idx * 0.4);

        for (let x = -1; x <= 1; x++) {
            for (let y = -1; y <= 1; y++) {
                for (let z = -1; z <= 1; z++) {
                    if (x === 0 && y === 0 && z === 0) continue;

                    const sx = getSize(x), sy = getSize(y), sz = getSize(z);
                    const px = getPos(x), py = getPos(y), pz = getPos(z);

                    // Slightly inflate target boxes to cover the visual cube precisely
                    const geo = new THREE.BoxGeometry(sx + 0.01, sy + 0.01, sz + 0.01);
                    // unique material per mesh so they highlight individually
                    const mesh = new THREE.Mesh(geo, highlightMat.clone()); 
                    mesh.position.set(px, py, pz);
                    mesh.material.opacity = 0; // Hidden initially
                    mesh.material.visible = false;
                    
                    // The combined direction vector for camera tweening
                    mesh.userData.dir = new THREE.Vector3(x, y, z).normalize();
                    
                    this.cubeGroup.add(mesh);
                    this.interactTargets.push(mesh);
                }
            }
        }
    }

    onMouseMove(e) {
        if (!this.container) return;
        const rect = this.container.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.interactTargets);

        let hit = null;
        if (intersects.length > 0) {
            hit = intersects[0].object;
        }

        if (this.hoveredTarget !== hit) {
            if (this.hoveredTarget) {
                this.hoveredTarget.material.visible = false;
                this.hoveredTarget.material.opacity = 0;
            }
            this.hoveredTarget = hit;
            if (this.hoveredTarget) {
                this.hoveredTarget.material.visible = true;
                this.hoveredTarget.material.opacity = 0.5;
                this.container.style.cursor = 'pointer';
            } else {
                this.container.style.cursor = 'default';
            }
            this.needsRender = true;
        }
    }

    onMouseLeave() {
        if (this.hoveredTarget) {
            this.hoveredTarget.material.visible = false;
            this.hoveredTarget.material.opacity = 0;
            this.hoveredTarget = null;
            this.container.style.cursor = 'default';
            this.needsRender = true;
        }
    }

    onClick() {
        if (this.hoveredTarget && AppState.camera && AppState.controls) {
            const dir = this.hoveredTarget.userData.dir;
            this.tweenMainCamera(dir);
        }
    }

    tweenMainCamera(targetNormal) {
        if (!AppState.camera || !AppState.controls) return;
        
        const startPos = AppState.camera.position.clone();
        const targetPos = AppState.controls.target.clone();
        const distance = startPos.distanceTo(targetPos);
        
        let targetUp = new THREE.Vector3(0, 1, 0);
        
        // Handle gimbal lock when looking exactly up or down
        if (Math.abs(targetNormal.y) > 0.99) {
            targetUp.set(0, 0, -Math.sign(targetNormal.y)); 
        }

        const endPos = targetPos.clone().add(targetNormal.clone().multiplyScalar(distance));
        
        // Prepare exact End Quaternion using a dummy camera
        const dummyCam = AppState.camera.clone();
        dummyCam.position.copy(endPos);
        dummyCam.up.copy(targetUp);
        dummyCam.lookAt(targetPos);
        
        const qStart = AppState.camera.quaternion.clone();
        const qEnd = dummyCam.quaternion.clone();

        const duration = 500;
        const startTime = performance.now();
        
        const animateTween = (time) => {
            let progress = (time - startTime) / duration;
            if (progress > 1) progress = 1;
            
            // Ease in-out cubic
            const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
            
            // Slerp the camera orientation directly
            const qCurrent = new THREE.Quaternion().copy(qStart).slerp(qEnd, ease);
            
            // Extract the perfect "up" vector mathematically from the interpolated quaternion
            const currentUp = new THREE.Vector3(0, 1, 0).applyQuaternion(qCurrent);
            AppState.camera.up.copy(currentUp).normalize();
            
            // Extract the correct local +Z direction from the quaternion and use it to orbit position spherically
            const currentZ = new THREE.Vector3(0, 0, 1).applyQuaternion(qCurrent);
            AppState.camera.position.copy(targetPos).add(currentZ.multiplyScalar(distance));

            AppState.controls.update(); 
            AppState.markDirty();
            
            if (progress < 1) {
                this.activeTween = requestAnimationFrame(animateTween);
            } else {
                this.activeTween = null;
                // Final pass to ensure exact exactitude
                AppState.camera.position.copy(endPos);
                AppState.camera.up.copy(targetUp);
                AppState.camera.quaternion.copy(qEnd);
                AppState.controls.update();
                AppState.markDirty();
            }
        };
        
        if (this.activeTween) cancelAnimationFrame(this.activeTween);
        this.activeTween = requestAnimationFrame(animateTween);
    }

    tweenMainCameraToHome() {
        if (!AppState.camera || !AppState.controls) return;
        
        const startPos = AppState.camera.position.clone();
        const startTarget = AppState.controls.target.clone();
        const startDist = startPos.distanceTo(startTarget);
        
        let endTarget = new THREE.Vector3(0, 0, 0);
        let endPos = new THREE.Vector3(20, 20, 20); // Isometric top-right-front

        // If a mesh exists, frame it better
        if (AppState.mesh) {
            AppState.mesh.geometry.computeBoundingSphere();
            const center = AppState.mesh.geometry.boundingSphere.center.clone();
            // Apply scale/position if any has been changed
            center.applyMatrix4(AppState.mesh.matrixWorld);
            endTarget.copy(center);
            
            // Maintain a reasonable distance based on the radius
            const radius = AppState.mesh.geometry.boundingSphere.radius;
            // Isometric direction vector 
            const isoDir = new THREE.Vector3(1, 1, 1).normalize();
            // Add distance + extra buffer for comfortable view
            endPos.copy(center).add(isoDir.multiplyScalar(radius * 2.5));
        }

        const targetUp = new THREE.Vector3(0, 1, 0);
        const endDist = endPos.distanceTo(endTarget);
        
        // Prepare exact Quaternions
        const dummyCam = AppState.camera.clone();
        dummyCam.position.copy(endPos);
        dummyCam.up.copy(targetUp);
        dummyCam.lookAt(endTarget);
        
        const qStart = AppState.camera.quaternion.clone();
        const qEnd = dummyCam.quaternion.clone();
        
        const duration = 500;
        const startTime = performance.now();
        
        const animateTween = (time) => {
            let progress = (time - startTime) / duration;
            if (progress > 1) progress = 1;
            
            const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
            
            // Slerp orientation, target, and distance
            const qCurrent = new THREE.Quaternion().copy(qStart).slerp(qEnd, ease);
            const currentDist = THREE.MathUtils.lerp(startDist, endDist, ease);
            
            AppState.controls.target.lerpVectors(startTarget, endTarget, ease);
            
            // Set current up
            const currentUp = new THREE.Vector3(0, 1, 0).applyQuaternion(qCurrent);
            AppState.camera.up.copy(currentUp).normalize();
            
            // Derive smooth spherical orbit position based on current look rotation
            const currentZ = new THREE.Vector3(0, 0, 1).applyQuaternion(qCurrent);
            AppState.camera.position.copy(AppState.controls.target).add(currentZ.multiplyScalar(currentDist));

            AppState.controls.update(); 
            AppState.markDirty();
            
            if (progress < 1) {
                this.activeTween = requestAnimationFrame(animateTween);
            } else {
                this.activeTween = null;
                AppState.camera.position.copy(endPos);
                AppState.controls.target.copy(endTarget);
                AppState.camera.up.copy(targetUp);
                AppState.camera.quaternion.copy(qEnd);
                AppState.controls.update();
                AppState.markDirty();
            }
        };
        
        if (this.activeTween) cancelAnimationFrame(this.activeTween);
        this.activeTween = requestAnimationFrame(animateTween);
    }

    // F-20: Rebuild ViewCube face materials when theme changes
    rebuildMaterials() {
        if (!this.cubeGroup) return;
        const labels = ['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'FRONT', 'BACK'];
        // The first child is the visual cube with 6 material faces
        const visualCube = this.cubeGroup.children[0];
        if (visualCube && visualCube.material && Array.isArray(visualCube.material)) {
            visualCube.material.forEach((mat, i) => {
                if (mat.map) mat.map.dispose();
                mat.dispose();
            });
            visualCube.material = labels.map(l => this.getTextMaterial(l));
        }
        this.needsRender = true;
    }

    update() {
        if (!AppState.camera || !AppState.controls) return;

        // F-20: Check if theme changed since last update
        const theme = document.documentElement.getAttribute('data-theme') || 'light';
        if (theme !== this._currentTheme) {
            this._currentTheme = theme;
            this.rebuildMaterials();
        }

        // F-08: Reuse scratch vector instead of allocating new Vector3 every frame
        const camDir = this._scratchDir.subVectors(AppState.camera.position, AppState.controls.target).normalize();
        
        // Check if camera moved
        if (!this.lastCamDir || this.lastCamDir.distanceToSquared(camDir) > 0.000001 || this.needsRender) {
            this.camera.position.copy(camDir).multiplyScalar(3);
            this.camera.up.copy(AppState.camera.up);
            this.camera.lookAt(0, 0, 0);
            
            this.renderer.render(this.scene, this.camera);
            
            if (!this.lastCamDir) this.lastCamDir = new THREE.Vector3();
            this.lastCamDir.copy(camDir);
            this.needsRender = false;
        }
    }
}
