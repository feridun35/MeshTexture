export const translations = {
    en: {
        // Sidebar Header / Logo
        appTitle: "3D Mesh Texture",
        appSubtitle: "by Feridun Oktar",

        // File Operations
        fileOpsTitle: "File Operations",
        workflowGuideTitle: "Workflow Guide",
        loadStl: "Load STL",
        uploadTexture: "Upload<br>Texture",
        selectTexture: "Select<br>Texture",
        presetTextures: "Preset Textures",
        presetCarbon: "Carbon Fiber",
        presetGrip1: "Grip 1",
        presetGrip2: "Grip 2",
        presetHexagon: "Hexagon",
        presetLeather: "Leather",
        presetWood: "Wood",
        presetWood2: "Wood 2",
        presetWood3: "Wood 3",
        presetCement: "Cement",
        presetGeo: "Geo",
        presetBrick: "Brick",
        presetLeaf: "Leaf",
        catGeometric: "Geometric",
        catOrganic: "Organic",

        // Workflow Guide Tooltip
        guideStep1: "Load .STL",
        guideStep2: "Select Faces",
        guideStep3: "Refine (>1 Million Faces)",
        guideStep4: "Load Map",
        guideStep4Sub: "(JPG, PNG... HTML)",
        guideStep5: "Adjust Settings",
        guideStep6: "Apply & Export",

        controlsTitle: "Viewport Controls",
        rotateCtrl: "Rotate",
        panCtrl: "Pan",
        zoomCtrl: "Zoom",
        rotateKey: "Left Click + Drag",
        panKey: "Right Click + Drag",
        zoomKey: "Scroll Wheel",

        // Selection
        selectionTitle: "Selection",
        smartFill: "Smart Fill",
        angleThreshold: "Angle Threshold",
        angleTooltip: "Determines surface continuity based on face normals.",
        lockSelection: "Lock Selection",
        selectEntireStl: "Select Entire STL File",
        refineSelection: "Refine Selection",
        clearSelection: "Clear",

        // Paint Selection
        paintArea: "Paint Area",
        paintSettings: "Paint Settings",
        paintInstructions: "Hold <b>E</b> + Left Click to <b>Paint</b><br>Hold <b>R</b> + Left Click to <b>Erase</b>",
        brushSize: "Brush Size",
        paintTolerance: "Angle Tolerance",
        ignoreBackfacing: "Ignore Backfacing",
        invertSelection: "Invert Selection",

        // Texture Mapping
        textureMappingTitle: "Texture Mapping",
        textureDetails: "Details",
        triplanarMode: "Triplanar",
        sphericalMode: "Spherical",
        modeTriplanar: "Triplanar (X, Y, Z Blend)",
        modeCubic: "Cubic (Single Axis)",
        modeSpherical: "Spherical (Polar Wrap)",
        modeCylindrical: "Cylindrical (Radial Wrap)",
        modePlanarXY: "Planar (Front/Back)",
        modePlanarXZ: "Planar (Top/Bottom)",
        modePlanarYZ: "Planar (Left/Right)",
        alignProjection: "Align to Selection",

        poleSmooth: "Pole Smooth",
        poleSmoothTooltip: "Fixes pinching at sphere poles.",

        scale: "Scale",
        scaleTooltip: "Global scale of the texture projection.",

        amplitude: "Amplitude",
        amplitudeTooltip: "Depth/Height of the displacement effect.",

        sharpness: "Sharpness",
        sharpnessTooltip: "Contrast blend between triplanar projections.",

        offset: "Offset",
        offsetTooltip: "UV offset for the texture.",

        rotation: "Rotation",
        rotationTooltip: "Rotate texture (0-180°).",

        polyLimit: "Max Triangles",
        polyLimitTooltip: "Maximum triangle budget (Target count before simplification). Higher values may slow down your browser.",
        highPolyWarning: "⚠️ High limits may cause lagging!",

        simplifyIntensity: "Simplify Intensity",
        simplifyIntensityTooltip: "Controls texture decimation (1-5). Unselected regions are fully protected. Flat areas always naturally simplify maximally.",


        applyBake: "Apply (Bake)",
        exportStl: "Export STL",

        // View Mode
        viewModeTitle: "View Mode",
        wireframe: "Wireframe",

        // Stats
        triangles: "Triangles:",
        selected: "Selected:",
        version: "Version:",
        disclaimer: "The site is currently in the trial phase. If you notice any issues, I would appreciate it if you could contact me.",

        // Introduction Overlay (Workflow Guide)
        overlayTitle: "Workflow Guide",
        step1Title: "Load Model:",
        step1Desc: "Import your .STL file.",
        step2Title: "Select Surfaces:",
        step2Desc: "Click faces to texture.",
        step3Title: "Refine:",
        step3Desc: "Higher fidelity with >1 million faces.",
        step4Title: "Load Texture:",
        step4Desc: "Upload Map (JPG, PNG, SVG, WEBP, HTML).",
        step5Title: "Settings:",
        step5Desc: "Adjust Scale & Amplitude.",
        step6Title: "Bake:",
        step6Desc: "Apply changes & Export STL.",

        importantNote: "Important Note",
        bakeWarning: "The baking process takes about 2-3 minutes depending on your PC hardware. Please do not switch tabs, leave this page, or close the window to prevent interrupting the calculations.",

        overlayControlsTitle: "Viewport Controls",
        overlayRotate: "Rotate",
        overlayPan: "Pan",
        overlayZoom: "Zoom",
        overlayRotateKey: "Left Click",
        overlayPanKey: "Right Click",
        overlayScrollKey: "Scroll",

        // Dynamic Status & Warnings
        processingGeometry: "Processing Geometry",
        dontCloseTab: "Do not leave this tab or close the window. The process takes 2-3 minutes depending on your PC.",
        bakedSuccess: "✓ Baked",
        bakeFailed: "Bake Failed",
        loadStlFirst: "Please load STL first!",
        polyLimitReached: "Poly Limit Reached!",
        wireframeLimitReached: "Wireframe Disabled: >8M Faces (Memory Limit)",
        ensureTextureLoaded: "Bake failed. Ensure texture is loaded.",
        confirmReset: "This will reset your current work. Continue?",
        refining: "Refining",
        selectFacesFirst: "Please select faces first!",

        // Bake Status
        statusNetworkOpt: "Network Optimization",
        statusDistanceField: "Computing Distance Field",
        statusWelding: "Welding Vertices",
        statusTexture: "Processing Texture",
        statusWallGen: "Generating Walls",
        statusSimplify: "Optimizing Mesh",
        statusFinishing: "Finishing",

        // Ticker
        tickerTip1: "🌍 WORLD FIRST: This is the first platform globally to select specific surfaces and apply displacement textures directly onto 3D STL meshes entirely in the browser!",
        tickerTip2: "🎨 FORMATS: Supports high-contrast JPG, PNG, WEBP. A pitch-black to pure-white gradient gives you the best control over the depth.",
        tickerTip3: "💡 COMING SOON: The ability to load and export fully colored 3MF files is arriving on April 13th!",
        tickerTip4: "⚠️ DISCLAIMER: The site provides an experimental tool. We are not responsible for any file corruptions, ruined 3D prints, or slicing errors from the output models.",
        tickerTip5: "🔒 Zero Storage: We don't save or see your models.",
        tickerTip6: "⚙️ Local Processing: 100% client-side execution.",
        tickerTip7: "🔌 Offline Capable: Once loaded, you can even unplug your internet and keep texturing!",
        privacyMatters: "Your Privacy Matters!",
        privacyDesc: "Unlike other tools, MeshTexture does not send your files to any server. Your proprietary designs are processed entirely using your own hardware (CPU/GPU) via your browser.",
    },
    tr: {
        // Sidebar Header / Logo
        appTitle: "3D Doku İşleme",
        appSubtitle: "Feridun Oktar",

        // File Operations
        fileOpsTitle: "Dosya İşlemleri",
        workflowGuideTitle: "İş Akışı Rehberi",
        loadStl: "STL Yükle",
        uploadTexture: "Doku<br>Yükle",
        selectTexture: "Doku<br>Seç",
        presetTextures: "Hazır Dokular",
        presetCarbon: "Karbon Fiber",
        presetGrip1: "Grip 1",
        presetGrip2: "Grip 2",
        presetHexagon: "Altıgen",
        presetLeather: "Deri",
        presetWood: "Ahşap",
        presetWood2: "Ahşap 2",
        presetWood3: "Ahşap 3",
        presetCement: "Çimento",
        presetGeo: "Geo",
        presetBrick: "Tuğla",
        presetLeaf: "Yaprak",
        catGeometric: "Geometrik",
        catOrganic: "Organik",

        // Workflow Guide Tooltip
        guideStep1: "STL Yükle",
        guideStep2: "Yüzey Seç",
        guideStep3: "Hassaslaştır (>1M Yüzey)",
        guideStep4: "Harita Yükle",
        guideStep4Sub: "(JPG, PNG... HTML)",
        guideStep5: "Ayarları Yap",
        guideStep6: "Uygula & Dışa Aktar",

        controlsTitle: "Görünüm Kontrolleri",
        rotateCtrl: "Döndür",
        panCtrl: "Kaydır",
        zoomCtrl: "Yakınlaştır",
        rotateKey: "Sol Tık + Sürükle",
        panKey: "Sağ Tık + Sürükle",
        zoomKey: "Tekerlek",

        // Selection
        selectionTitle: "Seçim",
        smartFill: "Akıllı Doldurma",
        angleThreshold: "Açı Eşiği",
        angleTooltip: "Yüzey sürekliliğini normallere göre belirler.",
        lockSelection: "Seçimi Kilitle",
        selectEntireStl: "Tüm STL'yi Seç",
        refineSelection: "Hassaslaştır",
        clearSelection: "Temizle",

        // Paint Selection
        paintArea: "Alanı Boya",
        paintSettings: "Boya Ayarları",
        paintInstructions: "<b>E</b> + Sol Tık ile <b>Boya</b><br><b>R</b> + Sol Tık ile <b>Sil</b>",
        brushSize: "Fırça Boyutu",
        paintTolerance: "Açı Toleransı",
        ignoreBackfacing: "Arka Yüzeyleri Yoksay",
        invertSelection: "Seçimi Tersine Çevir",

        // Texture Mapping
        textureMappingTitle: "Doku Kaplama",
        textureDetails: "Detaylar",
        triplanarMode: "Triplanar",
        sphericalMode: "Küresel",
        modeTriplanar: "Triplanar (X, Y, Z Kutu)",
        modeCubic: "Kübik (Tek Eksen)",
        modeSpherical: "Küresel",
        modeCylindrical: "Silindirik",
        modePlanarXY: "Düzlemsel (Ön/Arka)",
        modePlanarXZ: "Düzlemsel (Üst/Alt)",
        modePlanarYZ: "Düzlemsel (Sol/Sağ)",
        alignProjection: "Seçime Hizala",

        poleSmooth: "Kutup Yumuşatma",
        poleSmoothTooltip: "Küre kutuplarındaki sıkışmayı düzeltir.",

        scale: "Ölçek",
        scaleTooltip: "Doku projeksiyonunun genel ölçeği.",

        amplitude: "Derinlik",
        amplitudeTooltip: "Kabartma efektinin yüksekliği/derinliği.",

        sharpness: "Keskinlik",
        sharpnessTooltip: "Triplanar projeksiyonlar arası geçiş kontrastı.",

        offset: "Konum",
        offsetTooltip: "Dokunun UV konumu.",

        rotation: "Döndürme",
        rotationTooltip: "Dokuyu döndür (0-180°).",

        polyLimit: "Maksimum Üçgen Sayısı",
        polyLimitTooltip: "Maksimum üçgen sayısı limiti (Sadeleştirme işleminden önceki hedef sayı). Yüksek değerler tarayıcıyı yavaşlatabilir.",
        highPolyWarning: "⚠️ Yüksek limit tarayıcıyı yavaşlatabilir!",

        simplifyIntensity: "Sadeleştirme Şiddeti",
        simplifyIntensityTooltip: "Dokuların ne kadar silineceğini belirler (1-5). Seçilmeyen yazılar %100 korunur. Düz kısımlar matematiken sıfır hata olduğu için zaten daima silinir.",


        applyBake: "Uygula (Bake)",
        exportStl: "STL Dışa Aktar",

        // View Mode
        viewModeTitle: "Görünüm Modu",
        wireframe: "Tel Kafes",

        // Stats
        triangles: "Üçgenler:",
        selected: "Seçilen:",
        version: "Sürüm:",
        disclaimer: "Site şuan deneme aşamasında. Eğer bir sorun farkederseniz benimle iletişime geçerseniz sevinirim.",

        // Introduction Overlay (Workflow Guide)
        overlayTitle: "İş Akışı Rehberi",
        step1Title: "Model Yükle:",
        step1Desc: "STL dosyanızı içe aktarın.",
        step2Title: "Yüzey Seç:",
        step2Desc: "Kaplanacak yüzeylere tıklayın.",
        step3Title: "Hassaslaştır:",
        step3Desc: ">1 milyon yüzey ile yüksek detay.",
        step4Title: "Doku Yükle:",
        step4Desc: "Harita Yükle (JPG, PNG, SVG, WEBP).",
        step5Title: "Ayarlar:",
        step5Desc: "Ölçek ve Derinliği ayarlayın.",
        step6Title: "Bake:",
        step6Desc: "Değişiklikleri uygula & STL olarak kaydet.",

        importantNote: "Önemli Not",
        bakeWarning: "Bake işlemi, bilgisayarınızın donanımına (GPU) bağlı olarak ortalama 2-3 dakika sürebilir. Hesaplamaların kesintiye uğramaması için lütfen bulunduğunuz bu sekmeden ayrılmayın ve pencereyi kapatmayın.",

        overlayControlsTitle: "Görünüm Kontrolleri",
        overlayRotate: "Döndür",
        overlayPan: "Kaydır",
        overlayZoom: "Yakınlaştır",
        overlayRotateKey: "Sol Tık",
        overlayPanKey: "Sağ Tık",
        overlayScrollKey: "Tekerlek",

        // Dynamic Status & Warnings
        processingGeometry: "Geometri İşleniyor",
        dontCloseTab: "Lütfen bulunduğunuz sekmeden ayrılmayın / sekmeyi kapatmayın. İşlem bilgisayarınıza bağlı olarak 2-3 dakika sürebilir.",
        bakedSuccess: "✓ Tamamlandı",
        bakeFailed: "Bake Başarısız",
        loadStlFirst: "Lütfen önce STL yükleyin!",
        polyLimitReached: "Limit Aşıldı!",
        wireframeLimitReached: "Tel Kafes Devre Dışı: >8M Yüzey (Bellek Sınırı)",
        ensureTextureLoaded: "Bake başarısız. Doku yüklü olduğundan emin olun.",
        confirmReset: "Mevcut çalışmanız sıfırlanacak. Devam edilsin mi?",
        refining: "Hassaslaştırılıyor",
        selectFacesFirst: "Lütfen önce yüzey seçin!",

        // Bake Status
        statusNetworkOpt: "Ağ Optimizasyonu",
        statusDistanceField: "Mesafe Alanı Hesaplanıyor",
        statusWelding: "Köşeler Birleştiriliyor",
        statusTexture: "Doku İşleniyor",
        statusWallGen: "Duvarlar Oluşturuluyor",
        statusSimplify: "Ağ Optimize Ediliyor",
        statusFinishing: "Tamamlanıyor",

        // Ticker
        tickerTip1: "🌍 DÜNYADA İLK: Bu platform, tarayıcı üzerinden 3D STL modellerinde belirli yüzeyleri seçerek doğrudan ve pürüzsüz (manifold) olarak doku giydiren dünyadaki ilk sistemdir!",
        tickerTip2: "🎨 FORMATLAR: Yüksek kontrastlı JPG, PNG ve WEBP dokular desteklenir. Siyah ile beyaz tonları arasındaki keskinlik, derinliğin gücünü belirler.",
        tickerTip3: "💡 YAKINDA: Renkli 3MF dosyaları yükleme ve dokulanmış çok renkli çıktı alma özelliği 13.04 tarihinde sisteme eklenecek!",
        tickerTip4: "⚠️ YASAL UYARI: Bu site deneysel bir araç sunmaktadır. Çıktı alınan 3D modellerde oluşabilecek bozulmalar, dilimleme(slicer) sorunları veya hatalı baskılardan sitemiz sorumlu tutulamaz.",
        tickerTip5: "🔒 Sıfır Depolama: Modellerinizi asla kaydetmeyiz veya görmeyiz.",
        tickerTip6: "⚙️ Yerel İşleme: %100 istemci tarafında (lokal) çalışır.",
        tickerTip7: "🔌 Çevrimdışı Çalışma: Site yüklendikten sonra interneti kapatsanız bile kullanmaya devam edebilirsiniz!",
        privacyMatters: "Gizliliğiniz Önemli!",
        privacyDesc: "Diğer araçların aksine, MeshTexture dosyalarınızı hiçbir sunucuya göndermez. Özel tasarımlarınız tamamen kendi donanımınız (CPU/GPU) kullanılarak tarayıcınız üzerinden işlenir.",
    }
};
