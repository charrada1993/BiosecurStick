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
    function runOCR(file) {
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressPercent.innerText = '0%';
        progressStatus.innerText = 'Initialisation de l\'OCR...';

        Tesseract.recognize(
            file,
            'fra+eng',
            {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        const pct = Math.round(m.progress * 100);
                        progressBar.style.width = pct + '%';
                        progressPercent.innerText = pct + '%';
                        progressStatus.innerText = `Lecture de l'étiquette : ${pct}%`;
                    } else if (m.status === 'loading tesseract core') {
                        progressStatus.innerText = 'Chargement du noyau OCR...';
                    } else if (m.status === 'initializing api') {
                        progressStatus.innerText = 'Préparation de la langue...';
                    }
                }
            }
        ).then(({ data: { text } }) => {
            progressStatus.innerText = 'Analyse terminée avec succès !';
            setTimeout(() => {
                progressContainer.style.display = 'none';
            }, 1000);
            
            console.log('OCR text extracted:', text);
            matchOCRTextOnBackend(text);
        }).catch(err => {
            console.error('OCR Error:', err);
            progressStatus.innerText = `Erreur de scan : ${err.message || err}`;
            alert('Une erreur est survenue lors de l\'analyse de l\'image.');
        });
    }

    async function matchOCRTextOnBackend(text) {
        try {
            const response = await fetch('/api/match_product', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text })
            });
            const data = await response.json();

            if (data.matched && data.product) {
                // Exact product matched!
                const p = data.product;
                alert(`Produit identifié : ${p.name}`);
                loadProductData(p);
            } else if (!data.matched && data.ingredients && data.ingredients.length > 0) {
                // Predefined product not found, but extracted ingredients
                alert(`${data.ingredients.length} ingrédients ont été reconnus sur l'image.`);
                activeProductName = "Formulation scannée (OCR)";
                activeProductCat = "Personnalisé";
                activeProductRef = "Scan image";
                activeIngredients = data.ingredients.map(ing => ({
                    inci: ing.inci,
                    concentration: ing.concentration
                }));
                renderEditorList();
                calculateAndDisplay();
            } else {
                // None matched
                alert(data.message || "Aucun produit ou ingrédient n'a pu être extrait. Veuillez sélectionner un produit ou éditer manuellement.");
            }
        } catch (error) {
            console.error('Error matching OCR text:', error);
            alert('Erreur lors du traitement des résultats de l\'OCR par le serveur.');
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

    function loadProductData(product) {
        activeProductName = product.name;
        activeProductCat = product.category;
        activeProductRef = product.reference;
        activeIngredients = product.ingredients.map(ing => ({
            inci: ing.inci,
            concentration: ing.concentration
        }));
        
        renderEditorList();
        calculateAndDisplay();
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
            nameSpan.innerText = ing.inci;

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
                    borderRadius: 4
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
                    borderRadius: 4
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
