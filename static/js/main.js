// ============================================================
//  BiosecurStick - main.js
//  Handles: OCR (Tesseract.js), Product Search Autocomplete,
//           Ingredient Editor, Calculations, and Charts.js rendering.
// ============================================================

'use strict';

document.addEventListener('DOMContentLoaded', () => {
    // ─── STATE MANAGEMENT ──────────────────────────────────────────
    let dbProducts = [];
    let dbIngredients = {};
    let activeIngredients = [];
    let activeProductName = "";
    let activeProductCat = "";
    let activeProductRef = "";
    
    // Saved metrics for dynamic chart updates on theme switch
    let lastCalculatedIngredients = [];
    let lastCalculatedGlobalScore = 0.0;
    
    // Chart.js Instances
    let dangerChartInst = null;
    let scoreChartInst = null;
    let benchmarkChartInst = null;

    // ─── DOM ELEMENTS ──────────────────────────────────────────────
    // Theme Switcher
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const sunIcon = themeToggleBtn.querySelector('.sun-icon');
    const moonIcon = themeToggleBtn.querySelector('.moon-icon');

    // Drag & Drop OCR
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const uploadPrompt = document.getElementById('uploadPrompt');
    const previewArea = document.getElementById('previewArea');
    const imagePreview = document.getElementById('imagePreview');
    const removePreviewBtn = document.getElementById('removePreviewBtn');
    
    // OCR Progress
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressStatus = document.getElementById('progressStatus');
    const progressPercent = document.getElementById('progressPercent');

    // Product Lookup
    const productSearchInput = document.getElementById('productSearch');
    const suggestionsBox = document.getElementById('suggestionsBox');
    const btnLoadSample = document.getElementById('btnLoadSample');

    // Ingredients Editor
    const newIngredientInput = document.getElementById('newIngredientInput');
    const ingSuggestionsBox = document.getElementById('ingSuggestionsBox');
    const newIngredientConc = document.getElementById('newIngredientConc');
    const btnAddIngredient = document.getElementById('btnAddIngredient');
    const editorList = document.getElementById('editorList');
    const btnCalculate = document.getElementById('btnCalculate');

    // Manual INCI paste
    const btnTogglePaste = document.getElementById('btnTogglePaste');
    const pasteArea = document.getElementById('pasteArea');
    const inciTextInput = document.getElementById('inciTextInput');
    const btnParseInci = document.getElementById('btnParseInci');

    // Result Containers
    const welcomeResultCard = document.getElementById('welcomeResultCard');
    const resultLayout = document.getElementById('resultLayout');
    
    // Result Details
    const scoreValue = document.getElementById('scoreValue');
    const scoreRingFill = document.getElementById('scoreRingFill');
    const safetyBadge = document.getElementById('safetyBadge');
    const resProdName = document.getElementById('resProdName');
    const resProdCat = document.getElementById('resProdCat');
    const resProdRef = document.getElementById('resProdRef');
    const resNbIngr = document.getElementById('resNbIngr');
    const resInterpText = document.getElementById('resInterpText');
    const recContent = document.getElementById('recContent');
    const tableBody = document.getElementById('tableBody');

    // Tabs
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    // ─── INITIALIZATION & THEME MANAGER ────────────────────────────
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        if (theme === 'light') {
            sunIcon.style.display = 'block';
            moonIcon.style.display = 'none';
        } else {
            sunIcon.style.display = 'none';
            moonIcon.style.display = 'block';
        }
        // Force rebuild charts with theme colors if calculations exist
        if (lastCalculatedIngredients.length > 0) {
            buildCharts(lastCalculatedIngredients, lastCalculatedGlobalScore);
        }
    }

    // Load initial theme settings
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);

    // Bind theme switch trigger
    themeToggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        applyTheme(newTheme);
    });

    async function init() {
        try {
            // Load products and ingredients lists from API
            const productsRes = await fetch('/api/products');
            dbProducts = await productsRes.json();

            const ingredientsRes = await fetch('/api/ingredients');
            dbIngredients = await ingredientsRes.json();
            
            console.log('Database loaded:', dbProducts.length, 'products,', Object.keys(dbIngredients).length, 'ingredients.');
        } catch (error) {
            console.error('Failed to load database from server:', error);
        }
    }
    
    init();

    // ─── MANUAL INCI PASTE SECTION ───────────────────────────────
    btnTogglePaste.addEventListener('click', () => {
        const isOpen = pasteArea.style.display !== 'none';
        pasteArea.style.display = isOpen ? 'none' : 'flex';
        btnTogglePaste.style.borderColor = isOpen ? 'var(--color-input-border)' : 'var(--color-accent-cyan)';
        btnTogglePaste.style.color = isOpen ? 'var(--color-text-secondary)' : 'var(--color-accent-cyan)';
    });

    btnParseInci.addEventListener('click', () => {
        const rawText = inciTextInput.value.trim();
        if (!rawText) {
            showToast('Veuillez coller une liste INCI avant d\'analyser.', 'warning');
            return;
        }
        showToast('🔍 Analyse de la liste INCI en cours...', 'info', 3000);
        matchOCRTextOnBackend(rawText);
    });

    // ─── OCR RAW TEXT MODAL ──────────────────────────────────────
    function showOCRModal(rawText) {
        // Remove existing modal if any
        const existing = document.getElementById('ocrModalOverlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'ocr-modal-overlay';
        overlay.id = 'ocrModalOverlay';

        overlay.innerHTML = `
            <div class="ocr-modal">
                <h3>📷 Texte extrait par l'OCR</h3>
                <p class="ocr-modal-desc">
                    L'OCR n'a pas pu identifier d'ingrédients INCI connus.
                    Voici le texte brut extrait — copiez-le et collez-le dans
                    la zone "Ou collez la liste INCI manuellement" après correction.
                </p>
                <textarea readonly>${rawText}</textarea>
                <div class="ocr-modal-actions">
                    <button class="btn btn-secondary" id="ocrModalCopyBtn" type="button">📋 Copier le texte</button>
                    <button class="btn btn-primary" id="ocrModalPasteBtn" type="button">✏️ Éditer & Analyser</button>
                    <button class="btn btn-danger btn-sm" id="ocrModalCloseBtn" type="button">Fermer</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        document.getElementById('ocrModalCloseBtn').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        document.getElementById('ocrModalCopyBtn').addEventListener('click', () => {
            navigator.clipboard.writeText(rawText).then(() => {
                showToast('✅ Texte copié dans le presse-papiers', 'success', 2000);
            });
        });

        document.getElementById('ocrModalPasteBtn').addEventListener('click', () => {
            overlay.remove();
            // Open the paste area and fill it with the OCR text
            pasteArea.style.display = 'flex';
            inciTextInput.value = rawText;
            inciTextInput.focus();
            btnTogglePaste.style.borderColor = 'var(--color-accent-cyan)';
            btnTogglePaste.style.color = 'var(--color-accent-cyan)';
            // Scroll into view
            btnTogglePaste.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    // ─── TAB NAVIGATION ──────────────────────────────────────────

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons
            tabButtons.forEach(btn => btn.classList.remove('active'));
            // Add active class to clicked button
            button.classList.add('active');

            // Hide all tab panes
            tabPanes.forEach(pane => pane.classList.remove('active'));
            // Show target pane
            const targetId = button.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');

            // Force charts update/resize when their tab is displayed
            if (targetId === 'tab-charts') {
                if (dangerChartInst) dangerChartInst.resize();
                if (scoreChartInst) scoreChartInst.resize();
            } else if (targetId === 'tab-compare') {
                if (benchmarkChartInst) benchmarkChartInst.resize();
            }
        });
    });

    // ─── DRAG & DROP / FILE UPLOAD (OCR) ───────────────────────────
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('highlight');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('highlight');
        }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleImageFile(files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (fileInput.files.length > 0) {
            handleImageFile(fileInput.files[0]);
        }
    });

    removePreviewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resetOCRScanner();
    });

    function resetOCRScanner() {
        fileInput.value = '';
        imagePreview.src = '';
        previewArea.style.display = 'none';
        uploadPrompt.style.display = 'flex';
        progressContainer.style.display = 'none';
        progressBar.style.width = '0%';
        progressPercent.innerText = '0%';
        progressStatus.innerText = '';
    }

    function handleImageFile(file) {
        if (!file.type.startsWith('image/')) {
            alert('Veuillez sélectionner un fichier image valide.');
            return;
        }

        // Show image preview
        const reader = new FileReader();
        reader.onload = function(e) {
            imagePreview.src = e.target.result;
            uploadPrompt.style.display = 'none';
            previewArea.style.display = 'flex';
            runOCR(file);
        };
        reader.readAsDataURL(file);
    }

    // ─── CLIENT-SIDE TESSERACT OCR ─────────────────────────────────
    function showToast(message, type = 'info', duration = 4000) {
        // Remove any existing toast
        const existing = document.getElementById('ocrToast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'ocrToast';
        const colors = {
            success: 'linear-gradient(135deg, #10b981, #059669)',
            warning: 'linear-gradient(135deg, #f59e0b, #d97706)',
            error:   'linear-gradient(135deg, #ef4444, #dc2626)',
            info:    'linear-gradient(135deg, #06b6d4, #3b82f6)'
        };
        toast.style.cssText = `
            position:fixed; top:80px; right:20px; z-index:99999;
            background:${colors[type] || colors.info};
            color:#fff; padding:14px 20px; border-radius:12px;
            font-family:Inter,sans-serif; font-size:14px; font-weight:500;
            box-shadow:0 8px 32px rgba(0,0,0,0.3);
            max-width:320px; line-height:1.5;
            animation: slideInToast 0.3s ease;
        `;

        // Add keyframes if not already present
        if (!document.getElementById('toastStyle')) {
            const style = document.createElement('style');
            style.id = 'toastStyle';
            style.textContent = `
                @keyframes slideInToast {
                    from { opacity:0; transform:translateX(40px); }
                    to   { opacity:1; transform:translateX(0); }
                }
            `;
            document.head.appendChild(style);
        }

        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, duration);
    }

    // ─── IMAGE PREPROCESSING ────────────────────────────────────────
    function preprocessImageForOCR(file) {
        return new Promise((resolve) => {
            const img = new Image();
            const url = URL.createObjectURL(file);

            img.onload = () => {
                URL.revokeObjectURL(url);

                const canvas = document.createElement('canvas');

                // Scale up: Tesseract needs ~300 DPI. Target min 2000px on longest side.
                const maxSide = Math.max(img.width, img.height);
                const scale = maxSide < 2000 ? Math.min(3, 2000 / maxSide) : 1;
                canvas.width  = Math.round(img.width  * scale);
                canvas.height = Math.round(img.height * scale);

                const ctx = canvas.getContext('2d');

                // Enable image smoothing for upscale quality
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                // ── Pixel-level processing ──────────────────────────
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const d = imageData.data;

                // 1. Grayscale + contrast stretch
                let minL = 255, maxL = 0;
                for (let i = 0; i < d.length; i += 4) {
                    const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
                    if (gray < minL) minL = gray;
                    if (gray > maxL) maxL = gray;
                }
                const range = maxL - minL || 1;

                for (let i = 0; i < d.length; i += 4) {
                    // Grayscale
                    const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];

                    // Stretch contrast to full 0–255 range
                    let stretched = ((gray - minL) / range) * 255;

                    // Boost contrast around midpoint
                    stretched = (stretched - 128) * 1.6 + 128;
                    stretched = Math.max(0, Math.min(255, stretched));

                    d[i] = d[i+1] = d[i+2] = Math.round(stretched);
                }

                ctx.putImageData(imageData, 0, 0);

                // 2. Unsharp mask (simple version: blend with blurred copy)
                const sharpCanvas = document.createElement('canvas');
                sharpCanvas.width  = canvas.width;
                sharpCanvas.height = canvas.height;
                const sCtx = sharpCanvas.getContext('2d');

                // Draw blurred version
                sCtx.filter = 'blur(1px)';
                sCtx.drawImage(canvas, 0, 0);
                sCtx.filter = 'none';

                const blurData = sCtx.getImageData(0, 0, sharpCanvas.width, sharpCanvas.height);
                const sharpData = ctx.getImageData(0, 0, canvas.width, canvas.height);

                for (let i = 0; i < sharpData.data.length; i += 4) {
                    // sharpen = original + amount * (original - blur)
                    const amount = 1.2;
                    for (let c = 0; c < 3; c++) {
                        let val = sharpData.data[i+c] + amount * (sharpData.data[i+c] - blurData.data[i+c]);
                        sharpData.data[i+c] = Math.max(0, Math.min(255, Math.round(val)));
                    }
                }
                ctx.putImageData(sharpData, 0, 0);

                // Return canvas as Blob
                canvas.toBlob((blob) => resolve(blob), 'image/png');
            };

            img.onerror = () => {
                URL.revokeObjectURL(url);
                resolve(file); // fallback: use original
            };

            img.src = url;
        });
    }

    function runOCR(file) {
        progressContainer.style.display = 'block';
        progressBar.style.width = '5%';
        progressPercent.innerText = '5%';
        progressStatus.innerText = '🖼️ Prétraitement de l\'image...';

        preprocessImageForOCR(file).then((processedBlob) => {
            progressBar.style.width = '20%';
            progressPercent.innerText = '20%';
            progressStatus.innerText = '☁️ Envoi vers Google Cloud Vision...';

            // ── Build multipart form upload ─────────────────────────────
            const formData = new FormData();
            formData.append('image', processedBlob, 'label.png');

            fetch('/api/ocr', {
                method: 'POST',
                body: formData
            })
            .then(async (response) => {
                const data = await response.json();

                // ── 503: API key not configured → fall back to Tesseract ─
                if (response.status === 503) {
                    console.warn('Google Vision API key not set — falling back to Tesseract.js');
                    progressStatus.innerText = '⚙️ Clé Vision absente — Tesseract activé...';
                    runOCRTesseractFallback(processedBlob);
                    return;
                }

                // ── Other server errors ───────────────────────────────────
                if (!response.ok || data.error) {
                    const errMsg = data.error || `HTTP ${response.status}`;
                    progressStatus.innerText = `Erreur Vision API : ${errMsg}`;
                    showToast(`Erreur OCR : ${errMsg}`, 'error');
                    progressContainer.style.display = 'none';
                    return;
                }

                // ── Success ───────────────────────────────────────────────
                progressBar.style.width = '90%';
                progressPercent.innerText = '90%';
                progressStatus.innerText = `✓ ${data.words || 0} mots extraits — Identification des ingrédients...`;

                console.log('Google Vision OCR text:', data.text);

                progressBar.style.width = '100%';
                progressPercent.innerText = '100%';
                matchOCRTextOnBackend(data.text || '');
                setTimeout(() => { progressContainer.style.display = 'none'; }, 1500);
            })
            .catch(err => {
                console.error('OCR fetch error:', err);
                progressStatus.innerText = `Erreur réseau : ${err.message}`;
                showToast(`Erreur OCR : ${err.message || 'Erreur réseau'}`, 'error');
                progressContainer.style.display = 'none';
            });
        });
    }

    // ─── TESSERACT.JS FALLBACK (used when Google Vision key not set) ───────────
    function runOCRTesseractFallback(processedBlob) {
        if (typeof Tesseract === 'undefined') {
            progressStatus.innerText = 'OCR indisponible. Configurez GOOGLE_VISION_API_KEY sur le serveur.';
            showToast('Configurez la clé Google Vision API pour activer le scan photo.', 'warning', 8000);
            progressContainer.style.display = 'none';
            return;
        }

        progressBar.style.width = '25%';
        progressPercent.innerText = '25%';
        progressStatus.innerText = '⚙️ Initialisation Tesseract (mode fallback)...';

        Tesseract.recognize(
            processedBlob,
            'fra+eng',
            {
                tessedit_pageseg_mode: '6',
                tessedit_ocr_engine_mode: '1',
                logger: m => {
                    if (m.status === 'recognizing text') {
                        const pct = Math.round(25 + m.progress * 75);
                        progressBar.style.width = pct + '%';
                        progressPercent.innerText = pct + '%';
                        progressStatus.innerText = `🔍 Tesseract : ${pct}%`;
                    } else if (m.status === 'loading tesseract core') {
                        progressStatus.innerText = '⚙️ Chargement du moteur OCR...';
                    } else if (m.status === 'loading language traineddata') {
                        progressStatus.innerText = '📚 Chargement des données linguistiques...';
                    }
                }
            }
        ).then(({ data: { text } }) => {
            progressStatus.innerText = '✓ Scan Tesseract terminé — Identification...';
            progressBar.style.width = '100%';
            progressPercent.innerText = '100%';
            console.log('Tesseract fallback text:', text);
            matchOCRTextOnBackend(text);
            setTimeout(() => { progressContainer.style.display = 'none'; }, 1500);
        }).catch(err => {
            progressStatus.innerText = `Erreur Tesseract : ${err.message || err}`;
            showToast(`Erreur OCR : ${err.message || 'Erreur inconnue'}`, 'error');
        });
    }



    async function matchOCRTextOnBackend(text) {
        try {
            if (progressStatus) progressStatus.innerText = '🔍 Comparaison avec la base INCI...';

            const response = await fetch('/api/match_product', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text })
            });
            const data = await response.json();

            if (data.matched && data.product) {
                // Product matched in database — use stored pre-validated scores
                const p = data.product;
                const extra = data.extra_ingredients || [];
                const dbCount = p.ingredients ? p.ingredients.length : 0;
                const extraCount = extra.length;

                if (extraCount > 0) {
                    showToast(
                        `✅ Produit identifié : ${p.name} · ${dbCount} ingrédients DB + ${extraCount} supplémentaire${extraCount > 1 ? 's' : ''} détecté${extraCount > 1 ? 's' : ''} sur l'étiquette`,
                        'success', 6000
                    );
                } else {
                    showToast(`✅ Produit identifié : ${p.name} · Score : ${p.global_score}%`, 'success', 5000);
                }

                // Use stored scores (no recalculation) + optional extras
                displayProductWithStoredScores(p, extra);

            } else if (!data.matched && data.ingredients && data.ingredients.length > 0) {
                // Ingredients extracted from OCR/text
                const count = data.ingredients.length;
                const fuzzyCount = data.ingredients.filter(i => i.match_method && i.match_method.startsWith('fuzzy')).length;
                let toastMsg = `✅ ${count} ingrédient${count > 1 ? 's' : ''} INCI identifié${count > 1 ? 's' : ''}`;
                if (fuzzyCount > 0) toastMsg += ` (dont ${fuzzyCount} via correspondance floue)`;
                toastMsg += ` — Calcul du score en cours...`;
                showToast(toastMsg, 'success', 5000);

                activeProductName = "Formulation scannée (OCR)";
                activeProductCat = "Analyse INCI";
                activeProductRef = "Scan photo étiquette";
                activeIngredients = data.ingredients.map(ing => ({
                    inci: ing.inci,
                    concentration: ing.concentration,
                    match_method: ing.match_method || 'exact'
                }));

                renderEditorList();
                calculateAndDisplay();

            } else {
                // Nothing found — show modal with raw text so user can inspect & correct
                showToast('⚠️ Aucun ingrédient reconnu — affichage du texte brut extrait.', 'warning', 5000);
                if (text && text.trim().length > 20) {
                    showOCRModal(text);
                } else {
                    // Auto-open the paste section so user can type manually
                    pasteArea.style.display = 'flex';
                    btnTogglePaste.style.borderColor = 'var(--color-accent-cyan)';
                    btnTogglePaste.style.color = 'var(--color-accent-cyan)';
                    if (text) inciTextInput.value = text;
                }
            }
        } catch (error) {
            console.error('Error matching OCR text:', error);
            showToast('Erreur de communication avec le serveur. Vérifiez que Flask est démarré.', 'error');
        }
    }


    // ─── PRODUCT SEARCH AUTOCOMPLETE ──────────────────────────────
    productSearchInput.addEventListener('input', () => {
        const query = productSearchInput.value.toLowerCase().trim();
        suggestionsBox.innerHTML = '';
        
        if (!query) {
            suggestionsBox.style.display = 'none';
            return;
        }

        const matches = dbProducts.filter(p => p.name.toLowerCase().includes(query));
        
        if (matches.length === 0) {
            suggestionsBox.style.display = 'none';
            return;
        }

        matches.forEach(p => {
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.innerText = p.name;
            div.addEventListener('click', () => {
                productSearchInput.value = p.name;
                suggestionsBox.style.display = 'none';
                loadProductData(p);
            });
            suggestionsBox.appendChild(div);
        });

        suggestionsBox.style.display = 'block';
    });

    btnLoadSample.addEventListener('click', () => {
        const val = productSearchInput.value.toLowerCase().trim();
        const found = dbProducts.find(p => p.name.toLowerCase() === val);
        if (found) {
            loadProductData(found);
        } else {
            // Find fuzzy matches
            const fuzzy = dbProducts.find(p => p.name.toLowerCase().includes(val));
            if (fuzzy) {
                productSearchInput.value = fuzzy.name;
                loadProductData(fuzzy);
            } else {
                alert("Produit inconnu. Veuillez sélectionner un produit dans la liste d'autocomplétion.");
            }
        }
    });

    // Close suggestion box on outer click
    document.addEventListener('click', (e) => {
        if (e.target !== productSearchInput && e.target !== suggestionsBox) {
            suggestionsBox.style.display = 'none';
        }
        if (e.target !== newIngredientInput && e.target !== ingSuggestionsBox) {
            ingSuggestionsBox.style.display = 'none';
        }
    });

    // ─── DISPLAY PRODUCT USING PRE-VALIDATED DATABASE SCORES ─────────
    // This replaces the old loadProductData+calculateAndDisplay() flow for
    // matched database products. Using stored scores avoids the averaging bug
    // (N/D ingredients pulling the global score to near zero).
    async function displayProductWithStoredScores(product, extraIngredients = []) {
        // ── Set editor state ──────────────────────────────────────────
        activeProductName = product.name;
        activeProductCat = product.category || 'N/D';
        activeProductRef = product.reference || 'N/D';
        activeIngredients = (product.ingredients || []).map(ing => ({
            inci: ing.inci,
            concentration: ing.concentration
        }));
        renderEditorList();

        // ── Build result objects from stored database fields ───────────
        const storedResults = (product.ingredients || []).map(ing => ({
            inci:                  ing.inci,
            role:                  ing.role || '-',
            cas:                   ing.cas  || '',
            concentration:         ing.concentration,
            c_median:              ing.c_median || '',
            d:                     ing.d !== undefined ? ing.d : 1,
            justification_danger:  ing.justification_danger || '',
            source_danger:         ing.source_danger || '',
            noael:                 ing.noael || 'N/D',
            source_noael:          ing.source_noael || '',
            sed:                   ing.sed !== undefined ? ing.sed : 0,
            calcul_sed:            ing.calcul_sed || '',
            e:                     ing.e !== undefined ? ing.e : 0,
            interp_e:              ing.interp_e || '',
            ms:                    ing.ms !== undefined ? ing.ms : 'N/D',
            interp_ms:             ing.interp_ms || '',
            score:                 ing.score !== undefined ? ing.score : 'N/D'
        }));

        // ── Dynamically calculate any extra OCR-found ingredients ──────
        let extraResults = [];
        if (extraIngredients.length > 0) {
            try {
                const resp = await fetch('/api/calculate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ingredients: extraIngredients })
                });
                const extraData = await resp.json();
                extraResults = extraData.ingredients || [];
            } catch (e) {
                console.error('Error calculating extra ingredients:', e);
            }
        }

        // ── Determine global score ─────────────────────────────────────
        let globalScore;
        if (extraIngredients.length === 0) {
            // Use the validated study score from the database
            globalScore = parseFloat(product.global_score || 0);
        } else {
            // Recompute average over all ingredients (stored + extras)
            let scoreSum = 0;
            const allForAvg = [...storedResults, ...extraResults];
            allForAvg.forEach(ing => {
                if (ing.score !== 'N/D' && ing.score !== null && ing.score !== undefined) {
                    scoreSum += parseFloat(ing.score);
                }
            });
            globalScore = allForAvg.length > 0 ? scoreSum / allForAvg.length : 0;
            globalScore = Math.round(globalScore * 100) / 100;
        }

        const allResults = [...storedResults, ...extraResults];

        // ── Save for chart theme-switch redraws ────────────────────────
        lastCalculatedIngredients = allResults;
        lastCalculatedGlobalScore = globalScore;

        // ── Show results layout ────────────────────────────────────────
        welcomeResultCard.style.display = 'none';
        resultLayout.style.display = 'block';

        // ── Score ring ─────────────────────────────────────────────────
        const circumference = 440;
        scoreValue.innerText = `${globalScore.toFixed(2)}%`;
        const offset = circumference * (1 - Math.min(globalScore, 100) / 100);
        scoreRingFill.style.strokeDashoffset = offset;

        // ── Safety badge & interpretation ──────────────────────────────
        if (globalScore <= 30.0) {
            safetyBadge.innerText = 'SÛR';
            safetyBadge.style.color = 'var(--color-safe)';
            safetyBadge.style.backgroundColor = 'var(--color-safe-bg)';
            safetyBadge.style.borderColor = 'rgba(16, 185, 129, 0.2)';
            scoreRingFill.style.stroke = 'var(--color-safe)';
            resInterpText.innerText = 'Profil toxicologique sûr. Aucun ingrédient hautement préoccupant ou marge de sécurité insuffisante.';
        } else if (globalScore <= 60.0) {
            safetyBadge.innerText = 'VIGILANCE';
            safetyBadge.style.color = 'var(--color-warning)';
            safetyBadge.style.backgroundColor = 'var(--color-warning-bg)';
            safetyBadge.style.borderColor = 'rgba(245, 158, 11, 0.2)';
            scoreRingFill.style.stroke = 'var(--color-warning)';
            resInterpText.innerText = 'Profil intermédiaire. Présence d\'ingrédients à surveiller (antiperspirants, allergènes ou conservateurs réglementés).';
        } else {
            safetyBadge.innerText = 'RISQUE ÉLEVÉ';
            safetyBadge.style.color = 'var(--color-danger)';
            safetyBadge.style.backgroundColor = 'var(--color-danger-bg)';
            safetyBadge.style.borderColor = 'rgba(239, 68, 68, 0.2)';
            scoreRingFill.style.stroke = 'var(--color-danger)';
            resInterpText.innerText = 'Risque biologique élevé. Plusieurs marges de sécurité insuffisantes (MS < 30) ou ingrédients à fort danger (D = 3).';
        }

        // ── Product details ────────────────────────────────────────────
        resProdName.innerText = activeProductName;
        resProdCat.innerText  = activeProductCat;
        resProdRef.innerText  = activeProductRef;
        resNbIngr.innerText   = allResults.length;

        // ── Recommendations ────────────────────────────────────────────
        recContent.innerHTML = '';
        const riskIngs = allResults.filter(ing => ing.d >= 2 || (ing.ms !== 'N/D' && parseFloat(ing.ms) < 100));
        if (riskIngs.length > 0) {
            riskIngs.forEach(ing => {
                const isDanger = ing.d === 3 || (ing.ms !== 'N/D' && parseFloat(ing.ms) < 30);
                const item = document.createElement('div');
                item.className = `rec-item ${isDanger ? 'danger' : 'warning'}`;
                const explanation = ing.justification_danger || 'Marge de sécurité critique détectée.';
                const msDisplay = typeof ing.ms === 'number' ? ing.ms.toFixed(2) : ing.ms;
                item.innerHTML = `
                    <div>
                        <div class="rec-item-title">${ing.inci} <span class="rec-badge ${isDanger ? 'bg-red' : 'bg-orange'}">${isDanger ? 'DANGER HAUT' : 'VIGILANCE'}</span></div>
                        <div class="rec-item-desc">
                            <strong>Rôle :</strong> ${ing.role} | <strong>CAS :</strong> ${ing.cas || 'N/A'}<br>
                            <strong>Analyse :</strong> ${explanation}<br>
                            <strong>Marge de Sécurité (MS) :</strong> ${msDisplay} (Seuil recommandé : ≥ 100).
                        </div>
                    </div>`;
                recContent.appendChild(item);
            });
        } else {
            recContent.innerHTML = `
                <div class="rec-item" style="border-left-color:var(--color-safe);background:rgba(16,185,129,0.02);">
                    <div>
                        <div class="rec-item-title text-green">Aucun point de vigilance identifié</div>
                        <div class="rec-item-desc">
                            Tous les ingrédients de cette formulation présentent une marge de sécurité supérieure à 100 et un profil de danger modéré à nul.
                        </div>
                    </div>
                </div>`;
        }

        // ── Detailed table ─────────────────────────────────────────────
        tableBody.innerHTML = '';
        allResults.forEach(ing => {
            const tr = document.createElement('tr');
            tr.className = (ing.d === 3 || (ing.ms !== 'N/D' && parseFloat(ing.ms) < 30))
                ? 'row-danger'
                : (ing.d === 2 || (ing.ms !== 'N/D' && parseFloat(ing.ms) < 100))
                    ? 'row-warning'
                    : 'row-safe';
            const fSed   = typeof ing.sed   === 'number' ? ing.sed.toFixed(6)   : (ing.sed || '-');
            const fMs    = typeof ing.ms    === 'number' ? ing.ms.toFixed(2)    : (ing.ms || 'N/D');
            const fScore = typeof ing.score === 'number' ? `${ing.score.toFixed(2)}%` : (ing.score || 'N/D');
            tr.innerHTML = `
                <td class="td-ingr-name">${ing.inci}</td>
                <td>${ing.role || '-'}</td>
                <td>${ing.cas  || '-'}</td>
                <td>${ing.concentration}</td>
                <td class="bold text-center">${ing.d}</td>
                <td>${fSed}</td>
                <td class="text-center">${ing.e}</td>
                <td>${ing.noael}</td>
                <td class="bold">${fMs}</td>
                <td class="bold text-orange">${fScore}</td>`;
            tableBody.appendChild(tr);
        });

        // ── Charts ─────────────────────────────────────────────────────
        buildCharts(allResults, globalScore);
    }

    // Legacy wrapper kept for compatibility with the ingredient editor's "Calculate" button
    function loadProductData(product) {
        displayProductWithStoredScores(product, []);
    }



    // ─── INGREDIENT EDITOR AUTOCOMPLETE ───────────────────────────
    newIngredientInput.addEventListener('input', () => {
        const query = newIngredientInput.value.toLowerCase().trim();
        ingSuggestionsBox.innerHTML = '';

        if (!query) {
            ingSuggestionsBox.style.display = 'none';
            return;
        }

        // Get matching ingredients from master list keys
        const keys = Object.keys(dbIngredients);
        const matches = keys.filter(key => key.includes(query) || dbIngredients[key].inci.toLowerCase().includes(query));

        if (matches.length === 0) {
            ingSuggestionsBox.style.display = 'none';
            return;
        }

        matches.slice(0, 10).forEach(key => {
            const ingInfo = dbIngredients[key];
            const div = document.createElement('div');
            div.className = 'suggestion-item';
            div.innerText = `${ingInfo.inci} (${ingInfo.role || 'Rôle inconnu'})`;
            div.addEventListener('click', () => {
                newIngredientInput.value = ingInfo.inci;
                ingSuggestionsBox.style.display = 'none';
                newIngredientConc.focus();
            });
            ingSuggestionsBox.appendChild(div);
        });

        ingSuggestionsBox.style.display = 'block';
    });

    btnAddIngredient.addEventListener('click', () => {
        const name = newIngredientInput.value.trim();
        const conc = newIngredientConc.value.trim() || '1-3%';

        if (!name) {
            alert('Veuillez saisir le nom INCI de l\'ingrédient.');
            return;
        }

        // Add to active ingredients
        activeIngredients.push({
            inci: name,
            concentration: conc
        });

        // Set to custom formulation description since ingredients are modified
        if (!activeProductName.includes('(personnalisé)')) {
            activeProductName = activeProductName ? `${activeProductName} (modifié)` : "Formulation personnalisée";
            activeProductCat = activeProductCat || "Personnalisé";
            activeProductRef = activeProductRef || "Formulation manuelle";
        }

        // Clear input and reload list
        newIngredientInput.value = '';
        newIngredientConc.value = '1-3%';
        renderEditorList();
        calculateAndDisplay();
    });

    function getMatchBadge(method) {
        if (!method || method === 'exact') {
            return '<span class="match-badge match-exact" title="Correspondance exacte">Exact</span>';
        } else if (method === 'prefix') {
            return '<span class="match-badge match-prefix" title="Correspondance par préfixe (OCR a tronqué le mot)">Préfixe</span>';
        } else if (method === 'substring') {
            return '<span class="match-badge match-substring" title="Correspondance par sous-chaîne">Partiel</span>';
        } else if (method.startsWith('fuzzy')) {
            const score = method.match(/\d+/);
            return `<span class="match-badge match-fuzzy" title="Correspondance floue RapidFuzz — score ${score ? score[0] : '?'}/100">Flou ${score ? score[0] : ''}%</span>`;
        }
        return '';
    }

    function renderEditorList() {
        editorList.innerHTML = '';
        
        if (activeIngredients.length === 0) {
            editorList.innerHTML = '<div class="no-data-placeholder">Aucun ingrédient en cours d\'évaluation. Sélectionnez un produit ou importez une étiquette.</div>';
            return;
        }

        activeIngredients.forEach((ing, index) => {
            const item = document.createElement('div');
            item.className = 'editor-item';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'editor-name';
            nameSpan.title = ing.inci;
            nameSpan.innerHTML = ing.inci + (ing.match_method ? ' ' + getMatchBadge(ing.match_method) : '');

            const concInput = document.createElement('input');
            concInput.type = 'text';
            concInput.className = 'form-input';
            concInput.value = ing.concentration;
            concInput.addEventListener('change', (e) => {
                activeIngredients[index].concentration = e.target.value;
                if (!activeProductName.includes('(modifié)')) {
                    activeProductName = `${activeProductName} (modifié)`;
                }
            });

            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn-remove-ing';
            removeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
            removeBtn.addEventListener('click', () => {
                activeIngredients.splice(index, 1);
                if (!activeProductName.includes('(modifié)')) {
                    activeProductName = activeProductName ? `${activeProductName} (modifié)` : "Formulation personnalisée";
                }
                renderEditorList();
                calculateAndDisplay();
            });

            item.appendChild(nameSpan);
            item.appendChild(concInput);
            item.appendChild(removeBtn);
            editorList.appendChild(item);
        });
    }

    btnCalculate.addEventListener('click', () => {
        calculateAndDisplay();
    });

    // ─── CALCULATE & RENDER REPORT ─────────────────────────────────
    async function calculateAndDisplay() {
        if (activeIngredients.length === 0) {
            alert('Veuillez ajouter au moins un ingrédient pour effectuer le calcul.');
            return;
        }

        try {
            const response = await fetch('/api/calculate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ingredients: activeIngredients })
            });

            const results = await response.json();
            
            // Save state for dynamic theme switching redraws
            lastCalculatedIngredients = results.ingredients;
            lastCalculatedGlobalScore = results.global_score;
            
            // Hide welcome screen, show results layout
            welcomeResultCard.style.display = 'none';
            resultLayout.style.display = 'block';

            // 1. Update Core Scores & Badge
            const scoreValNum = parseFloat(results.global_score);
            scoreValue.innerText = `${results.global_score.toFixed(2)}%`;
            
            // Update circular score ring
            const circumference = 440; // 2 * pi * r = 2 * 3.14 * 70 = 439.6
            const offset = circumference * (1 - Math.min(scoreValNum, 100) / 100);
            scoreRingFill.style.strokeDashoffset = offset;

            // Dynamic badge coloring and description based on score thresholds
            if (scoreValNum <= 30.0) {
                // Sûr
                safetyBadge.innerText = 'SÛR';
                safetyBadge.style.color = 'var(--color-safe)';
                safetyBadge.style.backgroundColor = 'var(--color-safe-bg)';
                safetyBadge.style.borderColor = 'rgba(16, 185, 129, 0.2)';
                scoreRingFill.style.stroke = 'var(--color-safe)';
                resInterpText.innerText = 'Profil toxicologique sûr. Aucun ingrédient hautement préoccupant ou marge de sécurité insuffisante.';
            } else if (scoreValNum <= 60.0) {
                // Vigilance
                safetyBadge.innerText = 'VIGILANCE';
                safetyBadge.style.color = 'var(--color-warning)';
                safetyBadge.style.backgroundColor = 'var(--color-warning-bg)';
                safetyBadge.style.borderColor = 'rgba(245, 158, 11, 0.2)';
                scoreRingFill.style.stroke = 'var(--color-warning)';
                resInterpText.innerText = 'Profil intermédiaire. Présence d\'ingrédients à surveiller (antiperspirants, allergènes ou conservateurs réglementés).';
            } else {
                // Risque élevé
                safetyBadge.innerText = 'RISQUE ÉLEVÉ';
                safetyBadge.style.color = 'var(--color-danger)';
                safetyBadge.style.backgroundColor = 'var(--color-danger-bg)';
                safetyBadge.style.borderColor = 'rgba(239, 68, 68, 0.2)';
                scoreRingFill.style.stroke = 'var(--color-danger)';
                resInterpText.innerText = 'Risque biologique élevé. Plusieurs marges de sécurité insuffisantes (MS < 30) ou ingrédients à fort danger (D = 3).';
            }

            // 2. Populate evaluated product meta-details
            resProdName.innerText = activeProductName;
            resProdCat.innerText = activeProductCat;
            resProdRef.innerText = activeProductRef;
            resNbIngr.innerText = results.ingredients.length;

            // 3. Populate Points of Vigilance (Recommendations)
            recContent.innerHTML = '';
            const riskIngredients = results.ingredients.filter(ing => ing.d >= 2 || (ing.ms !== 'N/D' && ing.ms < 100));
            
            if (riskIngredients.length > 0) {
                riskIngredients.forEach(ing => {
                    const isDanger = ing.d === 3 || (ing.ms !== 'N/D' && ing.ms < 30);
                    const item = document.createElement('div');
                    item.className = `rec-item ${isDanger ? 'danger' : 'warning'}`;
                    
                    const badgeText = isDanger ? 'DANGER HAUT' : 'VIGILANCE';
                    const badgeClass = isDanger ? 'bg-red' : 'bg-orange';
                    const explanationText = ing.justification_danger || `Marge de sécurité critique détectée.`;
                    
                    item.innerHTML = `
                        <div>
                            <div class="rec-item-title">${ing.inci} <span class="rec-badge ${badgeClass}">${badgeText}</span></div>
                            <div class="rec-item-desc">
                                <strong>Rôle :</strong> ${ing.role} | <strong>CAS :</strong> ${ing.cas || 'N/A'}<br>
                                <strong>Analyse :</strong> ${explanationText}<br>
                                <strong>Marge de Sécurité (MS) :</strong> ${ing.ms} (Seuil recommandé : ≥ 100).
                            </div>
                        </div>
                    `;
                    recContent.appendChild(item);
                });
            } else {
                recContent.innerHTML = `
                    <div class="rec-item" style="border-left-color: var(--color-safe); background: rgba(16, 185, 129, 0.02);">
                        <div>
                            <div class="rec-item-title text-green">Aucun point de vigilance identifié</div>
                            <div class="rec-item-desc">
                                Tous les ingrédients de cette formulation présentent une marge de sécurité supérieure à 100 et un profil de danger modéré à nul.
                            </div>
                        </div>
                    </div>
                `;
            }

            // 4. Fill detailed data table
            tableBody.innerHTML = '';
            results.ingredients.forEach(ing => {
                const tr = document.createElement('tr');
                
                // Color row border based on risk
                if (ing.d === 3 || (ing.ms !== 'N/D' && ing.ms < 30)) {
                    tr.className = 'row-danger';
                } else if (ing.d === 2 || (ing.ms !== 'N/D' && ing.ms < 100)) {
                    tr.className = 'row-warning';
                } else {
                    tr.className = 'row-safe';
                }

                // Format numbers nicely
                const formattedSed = typeof ing.sed === 'number' ? ing.sed.toFixed(6) : ing.sed;
                const formattedMs = typeof ing.ms === 'number' ? ing.ms.toFixed(2) : ing.ms;
                const formattedScore = typeof ing.score === 'number' ? `${ing.score.toFixed(2)}%` : ing.score;

                tr.innerHTML = `
                    <td class="td-ingr-name">${ing.inci}</td>
                    <td>${ing.role}</td>
                    <td>${ing.cas || '-'}</td>
                    <td>${ing.concentration}</td>
                    <td class="bold text-center">${ing.d}</td>
                    <td>${formattedSed}</td>
                    <td class="text-center">${ing.e}</td>
                    <td>${ing.noael}</td>
                    <td class="bold">${formattedMs}</td>
                    <td class="bold text-orange">${formattedScore}</td>
                `;
                tableBody.appendChild(tr);
            });

            // 5. Build Charts (Tab 2 & 3)
            buildCharts(results.ingredients, results.global_score);

        } catch (error) {
            console.error('Calculation error:', error);
            alert('Erreur lors du calcul toxicologique du score de biosécurité.');
        }
    }

    // ─── CHART.JS SYSTEM ──────────────────────────────────────────
    function buildCharts(ingredients, globalScore) {
        // Destroy existing chart instances before rebuilding
        if (dangerChartInst) dangerChartInst.destroy();
        if (scoreChartInst) scoreChartInst.destroy();
        if (benchmarkChartInst) benchmarkChartInst.destroy();

        // Detect current theme to apply appropriate label & grid colors
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const isLight = currentTheme === 'light';

        const textColor = isLight ? '#475569' : '#94a3b8';
        const primaryTextColor = isLight ? '#0f172a' : '#f8fafc';
        const gridColor = isLight ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.05)';
        const chartBorderColor = isLight ? '#ffffff' : '#111827';
        
        // Count danger distributions (D0, D1, D2, D3)
        const dangerCounts = [0, 0, 0, 0];
        ingredients.forEach(ing => {
            const dVal = parseInt(ing.d);
            if (dVal >= 0 && dVal <= 3) {
                dangerCounts[dVal]++;
            }
        });

        // 1. Danger Distribution Doughnut Chart
        const ctxDanger = document.getElementById('dangerChart').getContext('2d');
        dangerChartInst = new Chart(ctxDanger, {
            type: 'doughnut',
            data: {
                labels: ['Danger 0 (Nul)', 'Danger 1 (Faible)', 'Danger 2 (Modéré)', 'Danger 3 (Élevé)'],
                datasets: [{
                    data: dangerCounts,
                    backgroundColor: [
                        '#10b981', // green
                        '#3b82f6', // blue
                        '#f59e0b', // orange
                        '#ef4444'  // red
                    ],
                    borderColor: chartBorderColor,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: textColor,
                            font: { family: 'Inter', size: 11 }
                        }
                    }
                }
            }
        });

        // 2. Ingredient-specific Score Chart (Ranked Top 8)
        const scoredIngredients = ingredients
            .filter(ing => typeof ing.score === 'number')
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);

        const scoreLabels = scoredIngredients.map(ing => ing.inci);
        const scoreData = scoredIngredients.map(ing => ing.score);

        const ctxScore = document.getElementById('ingredientsScoreChart').getContext('2d');
        scoreChartInst = new Chart(ctxScore, {
            type: 'bar',
            data: {
                labels: scoreLabels.length > 0 ? scoreLabels : ['Aucune donnée'],
                datasets: [{
                    label: 'Score Individuel (%)',
                    data: scoreData.length > 0 ? scoreData : [0],
                    backgroundColor: 'rgba(6, 182, 212, 0.6)',
                    borderColor: '#06b6d4',
                    borderWidth: 1.5,
                    borderRadius: 4,
                    maxBarThickness: 24
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y', // Horizontal bars
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: textColor, font: { family: 'Inter', size: 10 } }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: primaryTextColor, font: { family: 'Inter', size: 10 } }
                    }
                }
            }
        });

        // 3. Benchmark comparison chart (Pre-loaded DB + Current product)
        let benchmarkList = dbProducts.map(p => ({
            name: p.name,
            score: p.global_score,
            isCurrent: p.name.toLowerCase() === activeProductName.toLowerCase()
        }));

        const matchesExisting = dbProducts.some(p => p.name.toLowerCase() === activeProductName.toLowerCase());
        if (!matchesExisting) {
            benchmarkList.push({
                name: activeProductName || "Votre formulation",
                score: globalScore,
                isCurrent: true
            });
        }

        benchmarkList.sort((a, b) => b.score - a.score);

        const benchmarkLabels = benchmarkList.map(item => item.name);
        const benchmarkScores = benchmarkList.map(item => item.score);
        
        const benchmarkColors = benchmarkList.map(item => {
            if (item.isCurrent) {
                return globalScore > 60.0 ? '#ef4444' : '#06b6d4';
            }
            return isLight ? 'rgba(71, 85, 105, 0.15)' : 'rgba(148, 163, 184, 0.25)';
        });
        
        const benchmarkBorders = benchmarkList.map(item => {
            if (item.isCurrent) {
                return item.score > 60.0 ? '#ef4444' : '#06b6d4';
            }
            return isLight ? 'rgba(71, 85, 105, 0.3)' : 'rgba(148, 163, 184, 0.4)';
        });

        const ctxBenchmark = document.getElementById('compareBenchmarkChart').getContext('2d');
        benchmarkChartInst = new Chart(ctxBenchmark, {
            type: 'bar',
            data: {
                labels: benchmarkLabels,
                datasets: [{
                    label: 'Score Global de Risque (%)',
                    data: benchmarkScores,
                    backgroundColor: benchmarkColors,
                    borderColor: benchmarkBorders,
                    borderWidth: 1.5,
                    borderRadius: 4,
                    maxBarThickness: 16
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y', // Horizontal bars
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: textColor, font: { family: 'Inter', size: 10 } }
                    },
                    y: {
                        grid: { display: false },
                        ticks: {
                            color: (context) => {
                                const index = context.index;
                                if (benchmarkList[index] && benchmarkList[index].isCurrent) {
                                    return '#06b6d4';
                                }
                                return textColor;
                            },
                            font: { family: 'Inter', size: 9 }
                        }
                    }
                }
            }
        });
    }
});
