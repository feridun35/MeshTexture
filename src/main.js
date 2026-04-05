import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import AppState from './appState.js';
import { LoaderModule } from './loader.js';
import { SelectionModule } from './selection.js';
import { TextureEngine } from './textureEngine.js';
import { RemeshModule } from './remesh.js';
import { translations } from './translations.js';
import { ViewCube } from './viewCube.js';
import { decimate } from './decimation.js';

class MainApp {
    constructor() {
        this.container = document.getElementById('canvasContainer');
        this.currentLang = 'en'; // Default
        this.initThree();
        this.initModules();
        this.initEvents();
        this.initI18n();

        this.animate();
    }

    initThree() {
        AppState.scene = new THREE.Scene();
        // REMOVED: AppState.scene.background = new THREE.Color(0x121212); 
        // to allow transparent renderer + CSS background for Theme support

        const aspect = this.container.clientWidth / this.container.clientHeight;
        AppState.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000);
        AppState.camera.position.set(0, 10, 20);

        AppState.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        AppState.renderer.setPixelRatio(window.devicePixelRatio);
        AppState.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        AppState.renderer.shadowMap.enabled = true;
        this.container.appendChild(AppState.renderer.domElement);

        AppState.controls = new OrbitControls(AppState.camera, AppState.renderer.domElement);
        AppState.controls.enableDamping = true;
        AppState.controls.dampingFactor = 0.05;
        AppState.controls.minDistance = 0.1;
        AppState.controls.maxDistance = 10000;

        // WebGL Context Loss Recovery
        const canvas = AppState.renderer.domElement;
        canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            console.warn('[WebGL] Context lost. Pausing render loop.');
        });
        canvas.addEventListener('webglcontextrestored', () => {
            console.log('[WebGL] Context restored. Rebuilding renderer state.');
            AppState.renderer.setPixelRatio(window.devicePixelRatio);
            AppState.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
            // Re-apply material to force shader recompilation
            if (AppState.mesh && this.textureEngine) {
                this.textureEngine.applyTriplanarMaterial(AppState.mesh);
                this.textureEngine.updateUniforms();
            }
            AppState.markDirty();
        });

        // F-10: OrbitControls fires 'change' both during drag AND during damping settle.
        // This is the correct hook for on-demand rendering — no frames missed.
        AppState.controls.addEventListener('change', () => AppState.markDirty());

        // Add ambient light for better overall visibility
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        AppState.scene.add(ambientLight);

        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5);
        hemiLight.position.set(0, 200, 0);
        AppState.scene.add(hemiLight);

        // Main directional light casting shadows
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(50, 100, 50);
        dirLight.castShadow = true;
        // F-19: 1024×1024 is sufficient for opaque STL meshes at normal viewing distance.
        // 2048×2048 used 4× more GPU shadow memory with no visible quality difference.
        dirLight.shadow.mapSize.width = 1024;
        dirLight.shadow.mapSize.height = 1024;

        // Fix: Expand shadow camera bounds to prevent the dark square artifact on large models.
        // The default is -5 to 5, which leaves a small square shadow block in the middle of large STLs.
        const d = 500;
        dirLight.shadow.camera.left = -d;
        dirLight.shadow.camera.right = d;
        dirLight.shadow.camera.top = d;
        dirLight.shadow.camera.bottom = -d;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 2000;

        // Fix for "shadow acne" striping artifacts (caused by large shadow camera covering low-res map)
        dirLight.shadow.bias = -0.001;
        dirLight.shadow.normalBias = 0.05;

        AppState.scene.add(dirLight);

        // Secondary fill light from the opposite direction to brighten shadows
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
        fillLight.position.set(-50, 50, -50);
        AppState.scene.add(fillLight);
    }

    initModules() {
        this.loaderModule = new LoaderModule();
        this.selectionModule = new SelectionModule();
        AppState.selectionModule = this.selectionModule; // Expose

        this.textureEngine = new TextureEngine();
        AppState.textureEngine = this.textureEngine; // Global Access
        this.remeshModule = new RemeshModule();

        this.viewCube = new ViewCube('viewCubeContainer');

        this.selectionModule.initEvents(AppState.renderer.domElement);
    }

    initI18n() {
        // 1. Get stored language
        const storedLang = localStorage.getItem('appLang') || 'en';
        this.setLanguage(storedLang);

        // 2. Bind Buttons
        // 2. Bind Toggle Container
        const toggleContainer = document.getElementById('langToggle');
        if (toggleContainer) {
            toggleContainer.addEventListener('click', (e) => {
                // Prevent double firing if clicking a button inside (optional, but let's just toggle state)
                // Actually, if we click "EN" when it's "EN", we might want nothing?
                // User said "press anywhere". Let's just toggle.
                const newLang = this.currentLang === 'en' ? 'tr' : 'en';
                this.setLanguage(newLang);
            });
        }

        // Remove individual listeners logic (replaced above)
    }

    setLanguage(lang) {
        if (!translations[lang]) return;
        this.currentLang = lang;
        AppState.currentLang = lang;
        localStorage.setItem('appLang', lang);

        // 1. Update Buttons State
        document.querySelectorAll('.lang-btn').forEach(btn => {
            if (btn.getAttribute('data-lang') === lang) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // 2. Update Text Content (data-i18n)
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (translations[lang][key]) {
                // Handle HTML content for specific keys (br tags) or specific structure
                if (key === 'uploadTexture' || key === 'selectTexture' || key === 'tickerTip1' || key === 'tickerTip2' || key === 'tickerTip3' || key === 'tickerTip4' || key === 'paintInstructions') {
                    // If the element has children (like Upload Texture has <br>), we might want to be careful.
                    // But replacing innerHTML is simplest for "Doku<br>Yükle".
                    // For ticker items which contain <strong>, innerHTML is also needed.
                    el.innerHTML = translations[lang][key];
                } else {
                    // If it's nested (like "<strong>Load Model</strong>: Desc"), we face an issue if we just replace innerText.
                    // Our translation keys for steps are split: step1Title, step1Desc.
                    // BUT, <span class="step-text"><strong data-i18n="step1Title">...</strong> <span data-i18n="step1Desc">...</span></span>
                    // This structure allows safe innerText replacement on the leaf nodes.
                    el.innerText = translations[lang][key];
                }
            }
        });

        // 3. Update Placeholders? (If any exist)
        // Currently inputs have placeholders like "0.00". We don't have text placeholders.

        // 4. Update Dynamic Button Texts if they were in default state
        const applyBtn = document.getElementById('applyBtn');
        // Only update if it's NOT currently "Processing..." or "Baked" (handled by logic)
        // Actually, "Apply (Bake)" is the default. We can just reset it if not disabled/processing?
        // Simpler: Just run the checkLogic to refresh it, OR direct set if matches known states.
        if (applyBtn && !applyBtn.disabled && applyBtn.innerText.includes('Apply')) {
            // It might be "Apply (Bake)" or "Uygula (Bake)"
            applyBtn.innerText = translations[lang].applyBake;
        }

        // Export Button
        // The export button text is inside a span now due to i18n
        // <span data-i18n="exportStl">Export STL</span> -> Handled by generic loop above.
    }

    initEvents() {


        // --- UNDO / REDO SHORTCUTS ---
        window.addEventListener('keydown', (e) => {
            // Check for Ctrl (or Cmd on Mac)
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z' || e.key === 'Z') {
                    e.preventDefault();
                    if (e.shiftKey) {
                        AppState.redo(); // Ctrl+Shift+Z
                    } else {
                        AppState.undo(); // Ctrl+Z
                    }
                } else if (e.key === 'y' || e.key === 'Y') {
                    e.preventDefault();
                    AppState.redo(); // Ctrl+Y
                }
            }
        });

        // --- UNDO / REDO UI BINDING ---
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');

        if (undoBtn) {
            undoBtn.addEventListener('click', () => {
                undoBtn.disabled = true;
                if (redoBtn) redoBtn.disabled = true;
                document.body.style.cursor = 'wait';

                // Allow UI to repaint disabled state before heavy sync operation
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        try {
                            AppState.undo();
                        } finally {
                            document.body.style.cursor = 'default';
                            // AppState.updateUndoRedoUI() is called inside undo(), 
                            // restoring correct button states.
                        }
                    }, 10);
                });
            });
        }

        if (redoBtn) {
            redoBtn.addEventListener('click', () => {
                redoBtn.disabled = true;
                if (undoBtn) undoBtn.disabled = true;
                document.body.style.cursor = 'wait';

                requestAnimationFrame(() => {
                    setTimeout(() => {
                        try {
                            AppState.redo();
                        } finally {
                            document.body.style.cursor = 'default';
                        }
                    }, 10);
                });
            });
        }

        // Update UI initially
        AppState.updateUndoRedoUI();

        // F-13: Merged duplicate listener — single app-state-restored handler
        window.addEventListener('app-state-restored', () => {
            // 1. Update Sliders
            const updateSlider = (id, val, isRot = false) => {
                const el = document.getElementById(id);
                const input = document.getElementById(id + 'Input');
                if (el) {
                    el.value = val;
                    const min = parseFloat(el.min) || 0;
                    const max = parseFloat(el.max) || 100;
                    const percent = ((val - min) / (max - min)) * 100;
                    el.style.setProperty('--val-percent', percent + '%');
                    el.style.setProperty('--val-decimal', (percent / 100).toFixed(4));
                }
                if (input) {
                    input.value = val.toFixed(isRot || id === 'polyLimit' ? 0 : 2) + (isRot ? '°' : (id === 'polyLimit' ? 'M' : ''));
                }
            };

            updateSlider('texScale', AppState.params.textureScale);
            updateSlider('texAmp', AppState.params.textureAmplitude);
            updateSlider('texSharp', AppState.params.textureSharpness);
            updateSlider('texOffset', AppState.params.textureOffset);
            updateSlider('texRot', AppState.params.textureRotation, true);

            // 2. Update Toggles
            const smToggle = document.getElementById('smartFillToggle');
            if (smToggle) smToggle.checked = AppState.params.selectionMode;

            const wfToggle = document.getElementById('wireframeToggle');
            if (wfToggle) {
                wfToggle.checked = AppState.params.wireframe;
                if (AppState.mesh) AppState.mesh.material.wireframe = AppState.params.wireframe;
            }

            const mapModeSelect = document.getElementById('mappingModeSelect');
            if (mapModeSelect) {
                mapModeSelect.value = AppState.params.mappingMode;
                const poleSmoothContainer = document.getElementById('poleSmoothContainer');
                if (poleSmoothContainer) {
                    poleSmoothContainer.style.display = (AppState.params.mappingMode === 4) ? 'grid' : 'none';
                }
            }

            // 3. Button states (merged from first listener)
            const isBaked = AppState.params.isBaked;
            const applyBtn = document.getElementById('applyBtn');
            const exportBtn = document.getElementById('exportBtn');
            if (applyBtn) {
                applyBtn.innerText = isBaked
                    ? translations[this.currentLang || 'en'].bakedSuccess
                    : translations[this.currentLang || 'en'].applyBake;
                applyBtn.disabled = false;
            }
            if (exportBtn) exportBtn.disabled = !isBaked;

            // 4. Poly count + ViewCube visibility
            const polyCountEl = document.getElementById('polyCount');
            if (polyCountEl && AppState.mesh) {
                polyCountEl.innerText = AppState.mesh.geometry.attributes.position.count / 3;
            }
            const vcContainer = document.getElementById('viewCubeContainer');
            if (vcContainer && AppState.mesh) {
                vcContainer.style.opacity = '1';
                vcContainer.style.pointerEvents = 'auto';
            }

            // 5. Visuals + Uniforms
            if (AppState.selectionModule) AppState.selectionModule.updateVisuals(true);
            document.getElementById('selectedCount').innerText = AppState.selectedFaces.size;
            if (this.textureEngine) this.textureEngine.updateUniforms();

            AppState.updateUndoRedoUI();
            this.checkApplyButtonState();
            AppState.markDirty();
        });

        window.addEventListener('resize', () => this.onWindowResize());

        // --- BUTTON STATE LOGIC ---
        window.addEventListener('selection-changed', () => this.checkApplyButtonState());
        window.addEventListener('texture-loaded', () => this.checkApplyButtonState());
        window.addEventListener('reset-app', () => this.checkApplyButtonState());

        const toggleBtn = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebar');
        if (toggleBtn && sidebar) {
            toggleBtn.addEventListener('click', () => {
                sidebar.classList.toggle('hidden');
                document.body.classList.toggle('sidebar-closed');
                setTimeout(() => this.onWindowResize(), 310);
            });
        }


        // --- PRESET POPOVER LOGIC ---
        // --- PRESET POPOVER LOGIC ---
        const uploadBtn = document.getElementById('uploadBtn');
        const selectMapBtn = document.getElementById('selectMapBtn');
        const popover = document.getElementById('presetPopover');

        if (selectMapBtn && popover) {
            // Visual Click Effect for Select Texture Button
            selectMapBtn.addEventListener('click', () => {
                selectMapBtn.classList.add('clicked');
                setTimeout(() => {
                    selectMapBtn.classList.remove('clicked');
                    selectMapBtn.blur();
                }, 700);
            });

            let hideTimeout;

            const updatePosition = () => {
                const rect = selectMapBtn.getBoundingClientRect();
                const popoverRect = popover.getBoundingClientRect();

                // Position to the right of the button, centered vertically if possible
                // OR top-aligned with the button
                // Added a small gap (15px)
                const left = rect.right + 15;

                // Check if it fits vertically, otherwise nudge it up
                let top = rect.top;

                // Ensure it doesn't go off-screen bottom
                if (top + popoverRect.height > window.innerHeight) {
                    top = window.innerHeight - popoverRect.height - 20;
                }

                popover.style.left = `${left}px`;
                popover.style.top = `${top}px`;
            };

            const showPopover = () => {
                clearTimeout(hideTimeout);
                // Calculate position before showing
                updatePosition();
                popover.classList.add('active');
            };

            const hidePopover = () => {
                hideTimeout = setTimeout(() => {
                    popover.classList.remove('active');
                }, 300); // 300ms delay
            };

            // Triggers
            selectMapBtn.addEventListener('mouseenter', showPopover);
            selectMapBtn.addEventListener('mouseleave', hidePopover);
            popover.addEventListener('mouseenter', showPopover);
            popover.addEventListener('mouseleave', hidePopover);

            // Handle Scroll/Resize to keep it attached (optional, but good for UX)
            // Since popover hides on mouse leave, we might not need aggressive scroll tracking
            // but closing it on scroll is cleaner.
            window.addEventListener('scroll', () => {
                if (popover.classList.contains('active')) hidePopover();
            }, true);

            // Preset Defaults (User Defined)
            const presetDefaults = {
                'Carbon Fiber': { scale: 4.5, amp: 0.45, sharp: 20.0, offset: 2.16, rot: 0, polyLimit: 2 },
                'Grip 1': { scale: 6.3, amp: 0.45, sharp: 20.0, offset: 0, rot: 0, polyLimit: 2 },
                'Grip 2': { scale: 4.5, amp: 0.45, sharp: 20.0, offset: 0, rot: 0, polyLimit: 2 },
                'Hexagon': { scale: 3.30, amp: 0.45, sharp: 20.0, offset: 0, rot: 0, polyLimit: 2 },
                'Leather': { scale: 4.7, amp: 0.45, sharp: 20.0, offset: 0, rot: 0, polyLimit: 2 },
                'Wood': { scale: 4.7, amp: 0.45, sharp: 20.0, offset: 0, rot: 0, polyLimit: 2 },
                'Wood 2': { scale: 3.30, amp: 0.45, sharp: 20.0, offset: 0, rot: 0, polyLimit: 2 },
                'Wood 3': { scale: 4.7, amp: 0.45, sharp: 20.0, offset: 0, rot: 0, polyLimit: 2 },
                'Cement': { scale: 6.1, amp: 0.45, sharp: 20.0, offset: 0, rot: 0, polyLimit: 2 },
                'Geo': { scale: 4.30, amp: 0.45, sharp: 20.0, offset: 0, rot: 0, polyLimit: 2 },
                'Brick': { scale: 4.30, amp: 0.45, sharp: 20.0, offset: 0, rot: 0, polyLimit: 2 },
                'Leaf': { scale: 4.7, amp: 0.45, sharp: 20.0, offset: 0, rot: 0, polyLimit: 2 }
            };

            // Click Handler
            popover.querySelectorAll('.preset-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const src = item.getAttribute('data-src');
                    const title = item.getAttribute('title'); // e.g. "Carbon"
                    if (!src) return;

                    try {
                        const response = await fetch(src);
                        const blob = await response.blob();
                        const file = new File([blob], src.split('/').pop(), { type: blob.type });

                        // Load it
                        this.textureEngine.loadTexture(file);

                        // Apply Defaults if available
                        const settings = presetDefaults[title];
                        if (settings) {
                            // Update State
                            let targetScale = settings.scale;
                            // Spherical mapping density adjustments are handled globally in the shader / Engine.
                            AppState.params.textureScale = targetScale;
                            AppState.params.textureAmplitude = settings.amp;
                            AppState.params.textureSharpness = settings.sharp;
                            AppState.params.textureOffset = settings.offset;
                            AppState.params.textureRotation = settings.rot;

                            // Update UI Inputs
                            const setUI = (id, val, isRot = false) => {
                                const el = document.getElementById(id);
                                const input = document.getElementById(id + 'Input');
                                if (el) {
                                    el.value = val;
                                    // Update Visual Fill
                                    const min = parseFloat(el.min) || 0;
                                    const max = parseFloat(el.max) || 100;
                                    const percent = ((val - min) / (max - min)) * 100;
                                    el.style.setProperty('--val-percent', percent + '%');
                                    el.style.setProperty('--val-decimal', (percent / 100).toFixed(4));
                                }
                                if (input) {
                                    input.value = val.toFixed(isRot || id === 'polyLimit' ? 0 : 2) + (isRot ? '°' : (id === 'polyLimit' ? 'M' : ''));
                                }
                            };

                            setUI('texScale', targetScale);
                            setUI('texAmp', settings.amp);
                            setUI('texSharp', settings.sharp);
                            setUI('texOffset', settings.offset);
                            setUI('texRot', settings.rot, true);

                            // Poly Limit
                            setUI('polyLimit', settings.polyLimit);

                            const warningEl = document.getElementById('highPolyWarning');
                            if (warningEl) {
                                if (settings.polyLimit > 6) {
                                    warningEl.classList.remove('show', 'hide');
                                    void warningEl.offsetWidth;
                                    warningEl.classList.add('show');
                                } else {
                                    warningEl.classList.remove('show', 'hide');
                                }
                            }

                            // Force Update
                            this.textureEngine.updateUniforms();
                        }

                        // Update UI Button
                        // Show Preset Image
                        uploadBtn.style.backgroundImage = `url(${src})`;
                        uploadBtn.classList.add('has-preview');
                        uploadBtn.classList.add('file-loaded'); // Disable glow

                        // Hide Text (since we are showing image now as per user request)
                        const btnSpan = uploadBtn.querySelector('span');
                        if (btnSpan) {
                            btnSpan.innerHTML = "✓ " + item.querySelector('span').innerText; // Keep text updated for screen readers/fallback
                            btnSpan.style.display = 'none'; // Hide visible text
                            btnSpan.style.opacity = '0';
                        }

                        popover.classList.remove('active');

                    } catch (err) {
                        console.error("Failed to load preset:", err);
                        alert("Could not load preset texture.");
                    }
                });
            });

        }

        // --- PAINT POPOVER & MODE LOGIC ---
        const paintModeToggle = document.getElementById('paintModeToggle');
        const paintModeContainer = document.getElementById('paintModeContainer');
        const paintPopover = document.getElementById('paintPopover');

        if (paintModeToggle && paintModeContainer && paintPopover) {
            // Toggle Paint Mode
            paintModeToggle.addEventListener('change', (e) => {
                AppState.params.paintModeActive = e.target.checked;

                if (!AppState.params.paintModeActive) {
                    // Ensure brush cursor is hidden when exiting mode
                    if (this.selectionModule && this.selectionModule.brushCursor) {
                        this.selectionModule.brushCursor.visible = false;
                        AppState.markDirty();
                    }
                }
            });

            // Popover Hover Logic
            let paintHideTimeout;
            const updatePaintPosition = () => {
                const rect = paintModeContainer.getBoundingClientRect();
                const popRect = paintPopover.getBoundingClientRect();
                const left = rect.right + 15;
                let top = rect.top;
                if (top + popRect.height > window.innerHeight) {
                    top = window.innerHeight - popRect.height - 20;
                }
                paintPopover.style.left = `${left}px`;
                paintPopover.style.top = `${top}px`;
            };

            const showPaintPopover = () => {
                clearTimeout(paintHideTimeout);
                updatePaintPosition();
                paintPopover.classList.add('active');
            };

            const hidePaintPopover = () => {
                paintHideTimeout = setTimeout(() => {
                    paintPopover.classList.remove('active');
                }, 300);
            };

            paintModeContainer.addEventListener('mouseenter', showPaintPopover);
            paintModeContainer.addEventListener('mouseleave', hidePaintPopover);
            paintPopover.addEventListener('mouseenter', showPaintPopover);
            paintPopover.addEventListener('mouseleave', hidePaintPopover);

            window.addEventListener('scroll', () => {
                if (paintPopover.classList.contains('active')) hidePaintPopover();
            }, true);

            // Paint Settings Sliders
            const bindPaintSlider = (id, paramName) => {
                const slider = document.getElementById(id);
                const bubble = document.getElementById(id.replace('Threshold', 'Bubble').replace('Size', 'Bubble'));
                if (!slider) return;

                const updateVisual = (val) => {
                    const min = parseFloat(slider.min) || 0;
                    const max = parseFloat(slider.max) || 100;
                    const percent = ((val - min) / (max - min)) * 100;
                    if (bubble) {
                        bubble.innerText = val;
                        bubble.style.left = `${percent}%`;
                    }
                    slider.closest('.range-slider-wrapper')?.style.setProperty('--val-percent', percent + '%');
                };

                // Init visual
                updateVisual(AppState.params[paramName]);

                slider.addEventListener('input', (e) => {
                    const val = parseInt(e.target.value);
                    AppState.params[paramName] = val;
                    updateVisual(val);

                    // Live update cursor scale if visible
                    if (this.selectionModule && this.selectionModule.brushCursor && this.selectionModule.brushCursor.visible) {
                        this.selectionModule.brushCursor.scale.set(val, val, val);
                        AppState.markDirty();
                    }
                });
            };

            bindPaintSlider('paintBrushSize', 'paintBrushSize');
            bindPaintSlider('paintAngleThreshold', 'paintAngleThreshold');

            // Ignore Backface Toggle
            const paintIBToggle = document.getElementById('paintIgnoreBackfacing');
            if (paintIBToggle) {
                paintIBToggle.checked = AppState.params.paintIgnoreBackfacing;
                paintIBToggle.addEventListener('change', (e) => {
                    AppState.params.paintIgnoreBackfacing = e.target.checked;
                });
            }

            // Invert Selection Button
            const paintInvertBtn = document.getElementById('paintInvertBtn');
            if (paintInvertBtn) {
                paintInvertBtn.addEventListener('click', () => {
                    if (!AppState.mesh) return;
                    AppState.saveState();

                    const totalFaces = AppState.mesh.geometry.attributes.position.count / 3;
                    const newSelection = new Set();

                    for (let i = 0; i < totalFaces; i++) {
                        if (!AppState.selectedFaces.has(i)) {
                            newSelection.add(i);
                        }
                    }

                    AppState.selectedFaces = newSelection;
                    if (this.selectionModule) this.selectionModule.updateVisuals(true);

                    const countEl = document.getElementById('selectedCount');
                    if (countEl) countEl.innerText = AppState.selectedFaces.size;
                });
            }
        }

        // --- MANUAL UPLOAD LOGIC ---
        const textureLoader = document.getElementById('textureLoader');
        if (textureLoader) {
            textureLoader.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    // Show Spinner (Manual Injection for Texture Button)
                    if (uploadBtn) {
                        uploadBtn.classList.add('loading');
                        let wrapper = uploadBtn.querySelector('.spinner-wrapper');
                        if (!wrapper) {
                            wrapper = document.createElement('div');
                            wrapper.className = 'spinner-wrapper';
                            const spinner = document.createElement('div');
                            spinner.className = 'btn-spinner';
                            for (let i = 0; i < 6; i++) spinner.appendChild(document.createElement('div'));
                            wrapper.appendChild(spinner);
                            uploadBtn.appendChild(wrapper);
                        }
                    }

                    this.textureEngine.loadTexture(file);

                    // Set defaults for manual uploads
                    AppState.params.textureScale = 4.0;
                    AppState.params.textureAmplitude = 0.45;
                    AppState.params.textureSharpness = 20.0;

                    const setUI = (id, val, isInt = false) => {
                        const el = document.getElementById(id);
                        const input = document.getElementById(id + 'Input');
                        if (el) {
                            el.value = val;
                            const min = parseFloat(el.min) || 0;
                            const max = parseFloat(el.max) || 100;
                            const percent = ((val - min) / (max - min)) * 100;
                            el.style.setProperty('--val-percent', percent + '%');
                            el.style.setProperty('--val-decimal', (percent / 100).toFixed(4));
                        }
                        if (input) {
                            input.value = isInt ? val.toFixed(0) + (id === 'polyLimit' ? 'M' : '') : val.toFixed(2);
                        }
                    };

                    setUI('texScale', 4.0);
                    setUI('texAmp', 0.45);
                    setUI('texSharp', 20.0);
                    setUI('polyLimit', 2, true);

                    // Show Preview on Button
                    if (uploadBtn) {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            uploadBtn.style.backgroundImage = `url(${e.target.result})`;
                            uploadBtn.style.backgroundSize = 'cover';
                            uploadBtn.style.backgroundPosition = 'center';
                            uploadBtn.style.color = 'transparent'; // Hide text
                            // Remove icon if exists or handle overlapping text
                            const span = uploadBtn.querySelector('span');
                            if (span) span.style.opacity = '0';
                        };
                        reader.readAsDataURL(file);
                    }
                }
                e.target.value = '';
            });

            // Remove Spinner on Load/Error
            window.addEventListener('texture-loaded', () => {
                if (uploadBtn) {
                    uploadBtn.classList.remove('loading');
                    const wrapper = uploadBtn.querySelector('.spinner-wrapper');
                    if (wrapper) wrapper.remove();
                }
                // Texture is now bound — scene needs a render
                AppState.markDirty();
            });
            window.addEventListener('texture-error', () => {
                if (uploadBtn) {
                    uploadBtn.classList.remove('loading');
                    const wrapper = uploadBtn.querySelector('.spinner-wrapper');
                    if (wrapper) wrapper.remove();
                }
            });
        }

        const smartFillToggle = document.getElementById('smartFillToggle');
        if (smartFillToggle) {
            AppState.params.selectionMode = smartFillToggle.checked;
            smartFillToggle.addEventListener('change', (e) => {
                AppState.saveState(); // Save before changing
                AppState.params.selectionMode = e.target.checked;
                // Force UI update for opacity via selection module (if needed)
                // Note: SelectionModule listens to this too? 
                // Wait, in main.js we just set param. In selection.js we listen to toggle?
                // Let's check selection.js... it mostly listens to 'change' on the element too?
                // No, selection.js listens to inputs.
                // To be safe, we save state here.
            });
        }

        // Pattern Mode toggle removed


        const wireframeToggle = document.getElementById('wireframeToggle');
        if (wireframeToggle) {
            AppState.params.wireframe = wireframeToggle.checked;
            wireframeToggle.addEventListener('change', (e) => {
                if (e.target.checked && AppState.mesh) {
                    let triCount = 0;
                    if (AppState.mesh.geometry.index) {
                        triCount = AppState.mesh.geometry.index.count / 3;
                    } else {
                        triCount = AppState.mesh.geometry.attributes.position.count / 3;
                    }
                    console.log("[WireframeToggle] Checked triCount:", triCount);
                    if (!AppState.params.isBaked && triCount > 8000000) {
                        alert(translations[AppState.currentLang || 'en'].wireframeLimitReached);
                        e.target.checked = false;
                        AppState.params.wireframe = false;
                        return;
                    }
                }
                AppState.params.wireframe = e.target.checked;
                if (AppState.mesh) {
                    AppState.mesh.material.wireframe = AppState.params.wireframe;
                }
                AppState.markDirty(); // Wireframe toggle changes geometry appearance
            });
        }

        // --- THEME TOGGLE LOGIC ---
        const themeCheckbox = document.getElementById('themeCheckbox');
        if (themeCheckbox) {
            // Check stored theme or default
            const storedTheme = localStorage.getItem('theme') || 'dark';
            document.documentElement.setAttribute('data-theme', storedTheme);

            // Sync Checkbox State (Checked = Light/Sun, Unchecked = Dark/Moon)
            themeCheckbox.checked = (storedTheme === 'light');

            themeCheckbox.addEventListener('change', (e) => {
                const newTheme = e.target.checked ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', newTheme);
                localStorage.setItem('theme', newTheme);
                AppState.markDirty(); // Theme may affect canvas background color
            });
        }

        // --- SEPARATE APPLY & EXPORT LOGIC ---

        const applyBtn = document.getElementById('applyBtn');
        const exportBtn = document.getElementById('exportBtn');

        if (applyBtn && exportBtn) {
            // Apply (Bake)
            applyBtn.addEventListener('click', () => {
                if (!AppState.mesh) return;

                // FIX: Prevent Bake if no selection
                if (AppState.selectedFaces.size === 0) {
                    // or utilize showWarning if available in this scope, but alert is safer for now or just return
                    return;
                }

                // Visual Effect (0.7s) to match other buttons
                applyBtn.classList.add('clicked');
                setTimeout(() => {
                    applyBtn.classList.remove('clicked');
                    applyBtn.blur();
                }, 700);

                // SAVE STATE (GEOMETRY) BEFORE BAKE
                AppState.saveGeometryState();
                AppState.isBaking = true; // F-14: prevent double-bake via isBaking flag

                // Disable UI
                applyBtn.disabled = true;
                const originalText = translations[this.currentLang].applyBake;
                applyBtn.innerText = translations[this.currentLang].processingGeometry;

                // Show Overlay (Fade In)
                const overlay = document.getElementById('loadingOverlay');
                const progressBar = document.getElementById('bakeProgressBar');

                if (overlay) {
                    overlay.style.display = 'flex';
                    // PHASE 1: Start -> 80% (Slowly during bake)
                    if (progressBar) {
                        progressBar.style.transition = 'none';
                        progressBar.style.width = '0%';
                        // Force Reflow
                        void progressBar.offsetHeight;
                        progressBar.style.transition = 'width 3s ease-out';
                        progressBar.style.width = '80%';
                    }
                    // Force reflow
                    overlay.offsetHeight;
                    overlay.classList.add('visible');

                    // Reset Status
                    // Reset Status
                    const elCurrent = document.getElementById('statusCurrent');
                    const elNext = document.getElementById('statusNext');

                    // Reset to initial state (Hidden)
                    if (elCurrent) {
                        elCurrent.style.transition = 'none';
                        elCurrent.innerHTML = "";
                        elCurrent.innerText = "";
                        elCurrent.style.transform = 'translateY(-50%) scale(1)';
                        elCurrent.style.opacity = '0';
                    }
                    if (elNext) {
                        elNext.style.transition = 'none';
                        elNext.innerHTML = "";
                        elNext.innerText = "";
                        elNext.style.transform = 'translateY(100%) scale(0.85)';
                        elNext.style.opacity = '0';
                    }

                    // FIX: Immediate Status via Event System (Prevents Delay)
                    const polyLimitSlider = document.getElementById('polyLimit');
                    const polyLimitVal = polyLimitSlider ? parseInt(polyLimitSlider.value) : 5;
                    const initKey = (polyLimitVal > 0) ? 'refining' : 'processingGeometry';
                    const nextKey = 'statusTexture';

                    window.dispatchEvent(new CustomEvent('bake-status', {
                        detail: { key: initKey, next: nextKey }
                    }));
                }

                // Force render wait
                setTimeout(() => {
                    requestAnimationFrame(async () => {
                        try {
                            // 0. Aut-Refine (Resolution)
                            const polyLimitSlider = document.getElementById('polyLimit');
                            const polyLimitVal = polyLimitSlider ? parseInt(polyLimitSlider.value) : 5;
                            const targetTriangles = polyLimitVal * 1000000;

                            if (polyLimitVal > 0) {
                                // Smart Auto-Refine Loop before Bake.
                                // It refines repeatedly until we reach targetTriangles OR the worker stops 
                                // dividing (prevents infinite loop if limits block it), up to a max of 10 times.
                                let prevCount = -1;
                                let currentCount = AppState.mesh.geometry.attributes.position.count / 3;
                                let iterations = 0;

                                // CRITICAL FIX: Always force at least 1 iteration (iterations === 0) 
                                // to ensure the Adaptive Equalize pass runs on the new selection,
                                // even if the global triangle count is already above the target budget.
                                // We use a 95% tolerance because decimation might leave it exactly 1 triangle below max.
                                const targetTol = targetTriangles * 0.95;
                                while ((currentCount < targetTol || iterations === 0) && currentCount > prevCount && iterations < 10) {
                                    prevCount = currentCount;
                                    // Suppress Save during loop to avoid filling undo stack
                                    await this.remeshModule.refineSelection(true);
                                    currentCount = AppState.mesh.geometry.attributes.position.count / 3;
                                    iterations++;
                                }
                            }

                            // 0b. Removed Adjacency Preservation:
                            // The post-bake simplify pass completely alters the face indices.
                            // The old graph cannot be reused. It must be rebuilt from scratch lazily.


                            // 1. Bake Geometry (ASYNC WORKER)
                            const bakedGeo = await this.textureEngine.bakeGeometry(AppState.mesh);

                            if (!bakedGeo) {
                                alert(translations[this.currentLang].ensureTextureLoaded);
                                throw new Error(translations[this.currentLang].bakeFailed);
                            }

                            // 2. Update Scene Mesh safely with NEW Geometry
                            // Use updateActiveMesh to physically recreate the Mesh and cleanly swap WebGL attributes.
                            // This prevents "black screen" pipeline mismatches.
                            this.textureEngine.updateActiveMesh(bakedGeo);

                            // 2b. QEM SIMPLIFY — remove redundant flat-area triangles
                            window.dispatchEvent(new CustomEvent('bake-status', {
                                detail: { key: 'statusSimplify', next: 'statusFinishing' }
                            }));
                            const simplifiedGeo = await this.simplifyGeometry(AppState.mesh.geometry);
                            if (simplifiedGeo) {
                                this.textureEngine.updateActiveMesh(simplifiedGeo);
                            }

                            // 3. Disable Shader Displacement (DISABLED - User wants to keep settings)
                            // AppState.params.textureAmplitude = 0.0;
                            // document.getElementById('texAmp').value = 0;
                            // const ampInput = document.getElementById('texAmpInput');
                            // if (ampInput) ampInput.value = "0.00";
                            // Also update visual fill for the slider since we force set it to 0
                            // document.getElementById('texAmp').style.setProperty('--val-percent', '0%');

                            // RESET UI TO DEFAULT
                            // AppState.params.textureScale = 0; // Removed to preserve settings
                            // document.getElementById('texScale').value = 0; // Removed

                            AppState.params.isBaked = true; // Mark as baked for Redo logic
                            this.textureEngine.updateUniforms();
                            AppState.markDirty(); // Displaced geometry now in scene

                            // FIX: Force an immediate render frame after mesh swap.
                            // On some GPUs, the on-demand renderer may not repaint automatically
                            // after a full mesh replacement, causing a black/empty viewport.
                            if (AppState.renderer && AppState.scene && AppState.camera) {
                                AppState.renderer.render(AppState.scene, AppState.camera);
                            }

                            // 4. Success State - PHASE 2: 80% -> 100% over 2s (Faster now that bake is async/parallel)
                            // Actually bake is awaited so it falls here AFTER completion.

                            // UPDATE STATUS: "Finishing..." (Moving "Generating Walls" up)
                            window.dispatchEvent(new CustomEvent('bake-status', {
                                detail: { key: 'statusFinishing', next: null }
                            }));

                            if (progressBar) {
                                progressBar.style.transition = 'width 5s linear'; // Slower for cooldown effect?
                                progressBar.style.width = '100%';
                            }
                            applyBtn.innerText = translations[this.currentLang].applyBake; // Revert to default text
                            exportBtn.disabled = false;

                            // 5. Clear Caches & Cleanup
                            if (AppState.selectionModule) {
                                AppState.selectionModule.adjacencyGraph = null;
                                AppState.selectionModule.spatialGrid = null; // F-01: bake moved vertices, centroids stale
                            }

                            // Clear Selection (Graph is preserved, visuals updated)
                            AppState.clearSelection();

                            // forceFullReset=true: bake replaced geometry, prev delta state invalid
                            if (AppState.selectionModule) {
                                try {
                                    AppState.selectionModule.updateVisuals(true);
                                } catch (visErr) {
                                    console.error("[Main] Visual update failed during bake completion:", visErr);
                                }
                            }

                            // Force Button State Update (Ensure Apply disables if selection cleared)
                            // TIMING FIX: Wrap in setTimeout to ensure it runs after any event listeners
                            setTimeout(() => {
                                this.checkApplyButtonState();
                                window.dispatchEvent(new Event('selection-changed')); // Force global update

                                // CRITICAL FIX: The UI "Triangles" count was never explicitly updated 
                                // after bake injected boundary walls, causing "Selected" to look larger
                                // than "Triangles" when the user later clicked Select All.
                                const polyCountEl = document.getElementById('polyCount');
                                if (polyCountEl && AppState.mesh) {
                                    polyCountEl.innerText = AppState.mesh.geometry.attributes.position.count / 3;
                                }
                            }, 50);

                            // Turn Off Wireframe
                            AppState.params.wireframe = false;
                            if (AppState.mesh.material) AppState.mesh.material.wireframe = false;

                            // Auto-Lock Selection after successful bake
                            const lockToggle = document.getElementById('lockSelectionToggle');
                            if (lockToggle && !lockToggle.checked) {
                                lockToggle.checked = true;
                                lockToggle.dispatchEvent(new Event('change'));
                            }
                            const wfToggle = document.getElementById('wireframeToggle');
                            if (wfToggle) wfToggle.checked = false;

                        } catch (err) {
                            console.error(err);
                            alert("Error during bake: " + err.message);
                            // Hide overlay on error
                            if (overlay) {
                                overlay.classList.remove('visible');
                                setTimeout(() => { overlay.style.display = 'none'; }, 500);
                            }
                            applyBtn.innerText = originalText;
                            applyBtn.disabled = false;
                            AppState.isBaking = false; // F-14: reset on error
                            return;
                        }

                        // 5. Cooldown
                        setTimeout(() => {
                            if (overlay) {
                                overlay.classList.remove('visible');
                                setTimeout(() => { overlay.style.display = 'none'; }, 500);
                            }
                            applyBtn.innerText = originalText;
                            applyBtn.disabled = false;
                            AppState.isBaking = false; // F-14: reset on success
                        }, 1000);

                    });
                }, 500); // 500ms delay to let Fade In finish before heavy work starts logic
            });

            // Export
            exportBtn.addEventListener('click', () => {
                if (!AppState.mesh) return;

                // Visual Effect (1s)
                exportBtn.classList.add('clicked');
                setTimeout(() => {
                    exportBtn.classList.remove('clicked');
                    exportBtn.blur(); // Remove focus so the effect doesn't stick
                }, 1000);

                const exporter = new STLExporter();
                const str = exporter.parse(AppState.mesh, { binary: true });

                const blob = new Blob([str], { type: 'application/octet-stream' });
                const link = document.createElement('a');
                link.style.display = 'none';
                document.body.appendChild(link);
                const exportUrl = URL.createObjectURL(blob);
                link.href = exportUrl;

                let baseName = 'texture_pro_model';
                if (AppState.originalFilename) {
                    baseName = AppState.originalFilename.replace(/\.[^/.]+$/, "");
                }
                link.download = `${baseName}_meshtexturecom.stl`;

                link.click();
                document.body.removeChild(link);
                // F-12: Revoke blob URL so browser can free memory.
                // setTimeout gives the browser time to initiate the download first.
                setTimeout(() => URL.revokeObjectURL(exportUrl), 100);
            });
        }


        const texInputs = ['texScale', 'texAmp', 'texSharp', 'texOffset', 'texRot', 'polyLimit'];

        // projMethod removed - Automatic Hybrid Logic Only

        // projMethod removed - Automatic Hybrid Logic Only

        // patternToggle removed


        // --- MAPPING MODE LOGIC ---
        const mappingModeSelect = document.getElementById('mappingModeSelect');
        const poleSmoothContainer = document.getElementById('poleSmoothContainer');
        const poleSmooth = document.getElementById('poleSmooth');
        const poleSmoothVal = document.getElementById('poleSmoothVal');

        if (mappingModeSelect) {
            mappingModeSelect.addEventListener('change', (e) => {
                const val = parseInt(e.target.value);
                const oldVal = AppState.params.mappingMode;
                AppState.params.mappingMode = val;

                // Removed auto-scale shifting to keep user scale intact when changing modes


                // Toggle Pole Smoothness Visibility (Only for Spherical/Cylindrical)
                if (val === 4) { // Spherical
                    if (poleSmoothContainer) poleSmoothContainer.style.display = 'grid'; // matches grid-control
                } else {
                    if (poleSmoothContainer) poleSmoothContainer.style.display = 'none';
                }

                if (this.textureEngine) {
                    this.textureEngine.updateUniforms();
                }
                
                // Also need to re-align projection if needed, but uniforms update handles it
                if (AppState.mesh && AppState.textureEngine) {
                    AppState.textureEngine.applyTriplanarMaterial(AppState.mesh);
                }
            });
        }

        // Align Projection Button
        const alignProjectionBtn = document.getElementById('alignProjectionBtn');
        if (alignProjectionBtn) {
            alignProjectionBtn.addEventListener('click', () => {
                if (!AppState.mesh || AppState.selectedFaces.size === 0) {
                    alert(translations[this.currentLang].loadStlFirst);
                    return;
                }

                // Visual Effect
                alignProjectionBtn.classList.add('clicked');
                setTimeout(() => {
                    alignProjectionBtn.classList.remove('clicked');
                    alignProjectionBtn.blur();
                }, 300);

                // Force true alignment to selection
                this.textureEngine.updateProjectionBasis(AppState.mesh, true);
            });
        }

        // Texture Details Toggle Animation
        const detailsGroup = document.querySelector('.texture-details-group');
        if (detailsGroup) {
            detailsGroup.addEventListener('click', (e) => {
                if (e.target.closest('.details-summary')) {
                    e.preventDefault();
                    const isOpen = detailsGroup.classList.toggle('is-open');
                    const inner = detailsGroup.querySelector('.details-content-inner');

                    if (isOpen) {
                        // Wait for CSS grid animation to finish before showing overflow
                        // This prevents tooltips from being clipped by the container
                        setTimeout(() => {
                            if (detailsGroup.classList.contains('is-open')) {
                                inner.style.overflow = 'visible';
                            }
                        }, 350);
                    } else {
                        // Immediately hide overflow when closing to prevent spill-during-animation
                        inner.style.overflow = 'hidden';
                    }
                }
            });
        }

        // Helper to Setup Slider <-> Input Sync
        const setupSlider = (sliderId, paramKey, isRot = false) => {
            const slider = document.getElementById(sliderId);
            const input = document.getElementById(sliderId + 'Input');

            if (!slider || !input) return;

            const updateFill = () => {
                const min = parseFloat(slider.min) || 0;
                const max = parseFloat(slider.max) || 100;
                const val = parseFloat(slider.value);
                const percent = ((val - min) / (max - min)) * 100;
                slider.style.setProperty('--val-percent', percent + '%');
                slider.style.setProperty('--val-decimal', (percent / 100).toFixed(4));
            };

            // Init
            updateFill();
            const initialVal = parseFloat(slider.value);
            // Ensure State Matches (Optional safety)
            if (paramKey && AppState.params[paramKey] !== undefined) {
                // Actually we want UI to reflect State usually, but here we init from HTML values?
                // No, usually state is source of truth. But let's assume valid start.
            }
            input.value = initialVal.toFixed(isRot || sliderId === 'polyLimit' || sliderId === 'simplifyIntensity' ? 0 : 2) + (isRot ? '°' : (sliderId === 'polyLimit' ? 'M' : ''));

            // SLIDER INPUT
            slider.addEventListener('mousedown', () => AppState.saveState());
            slider.addEventListener('input', (e) => {
                updateFill();
                const val = parseFloat(e.target.value);
                input.value = val.toFixed(isRot || sliderId === 'polyLimit' || sliderId === 'simplifyIntensity' ? 0 : 2) + (isRot ? '°' : (sliderId === 'polyLimit' ? 'M' : ''));

                if (paramKey && AppState.params.hasOwnProperty(paramKey)) {
                    AppState.params[paramKey] = val;
                }
                if (sliderId === 'poleSmooth') AppState.params.poleSmoothness = val;

                if (sliderId !== 'polyLimit' && sliderId !== 'simplifyIntensity') this.textureEngine.updateUniforms();
            });

            const commitInput = (target) => {
                let valStr = target.value.replace('°', '').replace('M', '');
                let val = parseFloat(valStr);

                const min = parseFloat(slider.min);
                const max = parseFloat(slider.max);

                if (isNaN(val)) val = parseFloat(slider.value);
                // Clamp
                if (val < min) val = min;
                if (val > max) val = max;

                // Update Slider
                slider.value = val;
                updateFill();

                // Update Input Format
                target.value = val.toFixed(isRot || sliderId === 'polyLimit' || sliderId === 'simplifyIntensity' ? 0 : 2) + (isRot ? '°' : (sliderId === 'polyLimit' ? 'M' : ''));

                // Update Params
                if (paramKey && AppState.params.hasOwnProperty(paramKey)) {
                    AppState.params[paramKey] = val;
                }
                if (sliderId === 'poleSmooth') AppState.params.poleSmoothness = val;

                if (sliderId !== 'polyLimit' && sliderId !== 'simplifyIntensity') this.textureEngine.updateUniforms();
            };

            input.addEventListener('change', (e) => commitInput(e.target));

            // Allow Enter key
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    commitInput(e.target);
                    input.blur();
                }
            });

            // F-13: Removed saveState() on focus — firing every time a user clicks into a
            // text box (before any change) polluted the undo stack unnecessarily.
            // State is now saved only in the slider 'mousedown' handler (on actual intent to change).
        };

        // Initialize All
        setupSlider('texScale', 'textureScale');
        setupSlider('texAmp', 'textureAmplitude');
        setupSlider('texSharp', 'textureSharpness');
        setupSlider('texOffset', 'textureOffset');
        setupSlider('texRot', 'textureRotation', true);
        setupSlider('polyLimit', null);
        setupSlider('simplifyIntensity', 'simplifyIntensity');

        const polyLimitSlider = document.getElementById('polyLimit');
        const polyLimitInput = document.getElementById('polyLimitInput');

        let polyWarningTimeout;
        const checkPolyWarning = (val) => {
            const warningEl = document.getElementById('highPolyWarning');
            if (warningEl) {
                if (val > 6) {
                    if (polyWarningTimeout) clearTimeout(polyWarningTimeout);
                    // Reset Animation: Remove classes, force reflow
                    warningEl.classList.remove('show', 'hide');
                    void warningEl.offsetWidth;
                    warningEl.classList.add('show');
                } else {
                    if (warningEl.classList.contains('show')) {
                        warningEl.classList.replace('show', 'hide');
                        // After fadeOut animation (500ms), remove .hide so element
                        // reverts to base .warning-toast (display:none) and collapses space.
                        if (polyWarningTimeout) clearTimeout(polyWarningTimeout);
                        polyWarningTimeout = setTimeout(() => {
                            warningEl.classList.remove('hide');
                        }, 500);
                    }
                }
            }
        };

        if (polyLimitSlider) {
            polyLimitSlider.addEventListener('input', (e) => checkPolyWarning(parseInt(e.target.value)));
        }
        if (polyLimitInput) {
            polyLimitInput.addEventListener('change', (e) => checkPolyWarning(parseInt(e.target.value.replace('M', ''))));
        }
        setupSlider('poleSmooth', 'poleSmoothness');

        // --- Loading Indicators & Logic ---

        const updateBtn = (btn, percent) => {
            // Reset loaded state on new load start
            if (percent === 0) btn.classList.remove('file-loaded');

            // Show Spinner
            if (percent < 100) {
                btn.classList.add('loading');
                // Ensure 3D Cube Spinner Exists with Wrapper
                let wrapper = btn.querySelector('.spinner-wrapper');
                if (!wrapper) {
                    wrapper = document.createElement('div');
                    wrapper.className = 'spinner-wrapper';

                    const spinner = document.createElement('div');
                    spinner.className = 'btn-spinner';
                    // Create 6 faces
                    for (let i = 0; i < 6; i++) {
                        spinner.appendChild(document.createElement('div'));
                    }
                    wrapper.appendChild(spinner);
                    btn.appendChild(wrapper);
                }
            } else {
                btn.classList.remove('loading');
                const wrapper = btn.querySelector('.spinner-wrapper');
                if (wrapper) wrapper.remove();
            }

            let bar = btn.querySelector('.progress-overlay');
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'progress-overlay';
                btn.appendChild(bar);
            }
            bar.style.width = percent + '%';
        };

        const successBtn = (btn, originalText) => {
            btn.classList.remove('loading'); // Ensure spinner is gone
            const wrapper = btn.querySelector('.spinner-wrapper');
            if (wrapper) wrapper.remove();

            btn.classList.add('success');
            btn.classList.add('file-loaded'); // Persist loaded state
            // btn.style.backgroundColor = 'var(--success-green)'; 
            const span = btn.querySelector('span');
            const originalHTML = span.innerHTML;
            span.innerHTML = '✓ Loaded';

            setTimeout(() => {
                btn.classList.remove('success');
                // btn.style.backgroundColor = ''; 
                span.innerHTML = originalHTML;
                const bar = btn.querySelector('.progress-overlay');
                if (bar) bar.style.width = '0%';
            }, 2000);
        };

        const errorBtn = (btn, originalText) => {
            btn.classList.remove('loading');
            const wrapper = btn.querySelector('.spinner-wrapper');
            if (wrapper) wrapper.remove();

            btn.classList.add('danger');
            const span = btn.querySelector('span');
            const originalHTML = span.innerHTML;
            span.innerHTML = 'Error';

            setTimeout(() => {
                btn.classList.remove('danger');
                span.innerHTML = originalHTML;
                const bar = btn.querySelector('.progress-overlay');
                if (bar) bar.style.width = '0%';
            }, 3000);
        };

        const previewBtn = (btn, file) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (e) => {
                btn.style.backgroundImage = `url(${e.target.result})`;
                btn.classList.add('has-preview');
                btn.classList.add('file-loaded'); // Disable gradient glow immediately

                // Force Reflow/Repaint to ensure image appears instantly (Fixes "mouse move required" bug)
                void btn.offsetHeight;

                const span = btn.querySelector('span');
                if (span) span.style.display = 'none';
                const bar = btn.querySelector('.progress-overlay');
                // if (bar) bar.remove(); // Don't remove, let CSS hide it via file-loaded/success
                // Use standard success flow? No, preview is distinct.
                // Just ensuring bar is hidden.
                if (bar) bar.style.display = 'none';
            };
        };

        const stlInput = document.getElementById('stlInput');
        if (stlInput) {
            stlInput.addEventListener('change', (e) => {
                if (e.target.files.length) {
                    const file = e.target.files[0];
                    const btn = stlInput.closest('label');
                    updateBtn(btn, 0);

                    this.loaderModule.loadSTL(file,
                        (percent) => {
                            updateBtn(btn, percent);
                            if (percent >= 100) {
                                setTimeout(() => {
                                    successBtn(btn, 'Load STL');

                                    // FIX: Fade out welcome overlay
                                    const welcome = document.getElementById('welcomeOverlay');
                                    if (welcome) {
                                        welcome.classList.add('fade-out');
                                        setTimeout(() => { welcome.style.display = 'none'; }, 800);
                                    }

                                    // FIX: Enable Lock Selection Switch (was Show)
                                    const lockContainer = document.getElementById('lockSelectionContainer');
                                    if (lockContainer) {
                                        lockContainer.style.opacity = '1';
                                        lockContainer.style.pointerEvents = 'auto';
                                    }

                                    if (AppState.mesh) {
                                        this.textureEngine.applyTriplanarMaterial(AppState.mesh);
                                        AppState.mesh.material.wireframe = AppState.params.wireframe;
                                        // Ensure controls are disabled on new load UNLESS texture exists
                                        const texControls = document.getElementById('textureControls');
                                        if (texControls) {
                                            // Check if texture is already loaded
                                            const hasTexture = AppState.textureEngine &&
                                                AppState.textureEngine.uniforms.uTriplanarMap.value;

                                            if (hasTexture) {
                                                texControls.style.opacity = '1';
                                                texControls.style.pointerEvents = 'auto';
                                            } else {
                                                texControls.style.opacity = '0.5';
                                                texControls.style.pointerEvents = 'none';
                                            }
                                        }
                                        const exportBtn = document.getElementById('exportBtn');
                                        if (exportBtn) exportBtn.disabled = true;

                                        // Show ViewCube
                                        const vcContainer = document.getElementById('viewCubeContainer');
                                        if (vcContainer) {
                                            vcContainer.style.opacity = '1';
                                            vcContainer.style.pointerEvents = 'auto';
                                        }

                                        // Apply dynamic max distance limit relative to the mesh size
                                        if (AppState.mesh && AppState.mesh.geometry.boundingSphere) {
                                            const radius = AppState.mesh.geometry.boundingSphere.radius;
                                            AppState.controls.maxDistance = radius * 12; // Far enough but not infinite
                                        }
                                    }
                                }, 200);
                            }
                        },
                        (err) => {
                            console.error("Load Failed", err);
                            errorBtn(btn, 'Load STL');
                        }
                    );
                }
            });
        }

        const texInput = document.getElementById('textureInput');
        if (texInput) {
            texInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const btn = texInput.closest('label');
                    updateBtn(btn, 10);

                    this.textureEngine.loadTexture(file);

                    updateBtn(btn, 100);
                    // Immediate Preview (No Delay)
                    previewBtn(btn, file);
                }
            });
        }

        // --- BAKE STATUS UPDATE (Sequential Animation) ---
        window.addEventListener('bake-status', (e) => {
            const { key, next } = e.detail;
            const currentText = translations[this.currentLang][key];
            const nextText = next ? translations[this.currentLang][next] : "";

            const elCurrent = document.getElementById('statusCurrent');
            const elNext = document.getElementById('statusNext');

            if (!elCurrent || !elNext) return;

            // 1. Initial State (First Update)
            if (elCurrent.innerText === "") {
                elCurrent.innerHTML = '<span class="status-text-wrapper">' + currentText + '<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span></span>';

                elNext.innerHTML = '';
                elNext.innerText = nextText.replace(/\.+$/, ''); // Next doesn't need dots usually? Or does user want them? User said "dots...".
                // Actually user said "Next text doesn't explicitly write... dots don't happen".
                // The 'next' preview usually is just text. The 'current' one has the active dots.

                // Fade In
                elCurrent.style.opacity = '1';
                elCurrent.style.transform = 'translateY(-50%) scale(1)';

                // Prepare Next
                elNext.style.opacity = '0.6';
                elNext.style.transform = 'translateY(100%) scale(0.85)';
                return;
            }

            // 2. Transition (Next becomes Current)
            if (elCurrent.innerText.replace(/\.+$/, '').trim() !== currentText) {
                // Animate Old Current Out
                elCurrent.classList.add('slide-out-up');

                // Animate Old Next (New Current) Up
                elNext.classList.add('slide-in-up');

                // Wait for animation
                setTimeout(() => {
                    // Update Text content to new state
                    elCurrent.classList.remove('slide-out-up');
                    elNext.classList.remove('slide-in-up');

                    // Visual Reset / Swap
                    elCurrent.innerHTML = '<span class="status-text-wrapper">' + currentText + '<span class="loading-dots"><span>.</span><span>.</span><span>.</span></span></span>';

                    elNext.innerHTML = ''; // Force clear any potential HTML/Dots
                    elNext.innerText = nextText.replace(/\.+$/, '');

                    // Disable transitions for instant reset
                    elCurrent.style.transition = 'none';
                    elNext.style.transition = 'none';

                    // Reset to standard positions
                    elCurrent.style.transform = 'translateY(-50%) scale(1)';
                    elCurrent.style.opacity = '1';

                    elNext.style.transform = 'translateY(100%) scale(0.85)';
                    elNext.style.opacity = '0.6';

                    // Force Reflow
                    void elCurrent.offsetHeight;

                    // Restore Transitions
                    elCurrent.style.transition = '';
                    elNext.style.transition = '';

                }, 600); // 600ms match CSS
            }
        });
    }

    checkApplyButtonState() {
        const applyBtn = document.getElementById('applyBtn');
        const exportBtn = document.getElementById('exportBtn');

        const hasMesh = !!AppState.mesh;
        const hasSelection = AppState.selectedFaces.size > 0;
        const hasTexture = AppState.textureEngine && AppState.textureEngine.uniforms.uTriplanarMap.value;

        // 1. Check Apply Button
        if (applyBtn) {
            if (hasMesh && hasSelection && hasTexture) {
                applyBtn.disabled = false;
                // F-14: Use isBaking flag instead of brittle English-only text check.
                // The old check broke in Turkish ("İşleniyor..." !== "Processing...").
                if (AppState.isBaking) return;
                applyBtn.innerText = "Apply (Bake)";
            } else {
                applyBtn.disabled = true;
            }
        }

        // 2. Check Export Button
        if (exportBtn) {
            const isBaked = AppState.params.isBaked;
            // "Passive same conditions as apply... active only when bake finished"
            // Note: Bake process clears selection, so we cannot enforce hasSelection for Export.
            // Once baked, we just need the mesh.
            if (hasMesh && isBaked) {
                exportBtn.disabled = false;
            } else {
                exportBtn.disabled = true;
            }
        }
    }

    /**
     * QEM Simplify — runs the SimplifierWorker on the given geometry.
     * Returns a new THREE.BufferGeometry with redundant flat-area triangles removed,
     * or null if simplification yielded no improvement.
     */
    async simplifyGeometry(geometry) {
        if (!geometry || !geometry.attributes.position) {
            return null;
        }

        const posAttr = geometry.attributes.position;
        const selAttr = geometry.attributes.fs_selection;

        const selection = selAttr ? new Float32Array(selAttr.array) : null;
        const inputTriCount = posAttr.count / 3;

        if (inputTriCount < 4) return null;

        const intensity = AppState.params.simplifyIntensity !== undefined ? AppState.params.simplifyIntensity : 3;
        // Logarithmic curve constrained between 0.000001 and 0.0005
        const maxErrorMap = {
            1: 0.000001,  // Pristine detail preservation
            2: 0.000005,
            3: 0.00002,   // Balanced
            4: 0.0001,
            5: 0.0005     // Max simplification
        };
        const activeMaxError = maxErrorMap[intensity] || 0.00002;

        console.time('Simplify: Total');

        // Let the UI paint the initial status
        window.dispatchEvent(new CustomEvent('bake-status', {
            detail: { key: 'statusSimplify', next: 'statusFinishing' }
        }));
        await new Promise(r => setTimeout(r, 0));

        let lastProgress = 0;
        // Pass selection to freeze unselected vertices during the final simplify pass.
        // The per-face selection stamp fix in buildOutput (decimation.js) now correctly
        // prevents selection bleeding, so the freeze is safe to use and essential to
        // prevent QEM from collapsing unselected flat-area vertices into the textured region.
        const outGeo = await decimate(geometry, 0, activeMaxError, (p) => {
            const currentPrct = 75 + Math.floor(p * 20); // Scale to 75% -> 95%
            if (currentPrct - lastProgress >= 1) { 
                window.dispatchEvent(new CustomEvent('bake-progress', { detail: { percent: currentPrct } }));
                lastProgress = currentPrct;
            }
        }, selection);

        console.timeEnd('Simplify: Total');

        if (!outGeo || outGeo.attributes.position.count >= posAttr.count) {
            console.log(`[Simplify] No reduction. Skipping.`);
            return null;
        }

        const outTriCount = outGeo.attributes.position.count / 3;
        console.log(`[Simplify] ${inputTriCount} → ${outTriCount} triangles (${((1 - outTriCount / inputTriCount) * 100).toFixed(1)}% reduction)`);

        // Add default vertex colors (gray) for vertexColors:true material
        const colorArray = new Float32Array(outGeo.attributes.position.count);
        colorArray.fill(0.5);
        outGeo.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));

        outGeo.computeBoundingBox();
        outGeo.computeBoundingSphere();

        return outGeo;
    }

    onWindowResize() {
        if (!AppState.camera || !AppState.renderer) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        AppState.camera.aspect = width / height;
        AppState.camera.updateProjectionMatrix();
        AppState.renderer.setSize(width, height);
        AppState.markDirty(); // Camera/viewport changed
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        // F-10: Update controls every frame (needed for damping to settle smoothly).
        // OrbitControls fires its own 'change' event when the camera actually moves,
        // which sets AppState.needsRender = true via the listener in initThree().
        if (AppState.controls) AppState.controls.update();

        if (this.viewCube) this.viewCube.update();

        // Only render if something visually changed.
        if (AppState.needsRender && AppState.renderer && AppState.scene) {
            AppState.renderer.render(AppState.scene, AppState.camera);
            AppState.needsRender = false;
        }
    }
}

new MainApp();
