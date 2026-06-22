# BiosecurStick — Improvement Roadmap

## 🔴 HIGH PRIORITY (Fixes that directly impact accuracy & usability)

---

### 1. Fill Missing NOAEL Values (18/101 ingredients)
**Current state:** 18 ingredients return `N/D` for NOAEL → their score is also `N/D`, pulling the global average down and making reports less useful.

**Solution:** Look up missing NOAEL values from:
- **SCCS (Scientific Committee on Consumer Safety)** opinions: https://ec.europa.eu/health/scientific_committees/consumer_safety_en
- **CIR (Cosmetic Ingredient Review)** database: https://cir-safety.org/ingredients
- **ECHA** (European Chemicals Agency): https://echa.europa.eu/

**Impact:** Every ingredient with a real NOAEL gets a real score → much more meaningful risk profile.

---

### 2. Fuzzy String Matching for OCR Errors
**Current state:** The matching uses exact/prefix/substring. If OCR reads `Phenoxyethano1` (digit 1 instead of letter l), it fails completely.

**Solution:** Add [RapidFuzz](https://github.com/maxbachmann/RapidFuzz) (lightweight, pure Python):
```bash
pip install rapidfuzz
```
```python
from rapidfuzz import process, fuzz
# If no exact/prefix/substring match, try fuzzy:
result = process.extractOne(token, ing_lookup.keys(), scorer=fuzz.ratio, score_cutoff=85)
if result:
    matched_key = result[0]
```
**Impact:** Handles OCR character-level errors, typos, and cut-off words.

---

### 3. Expand the Ingredient Database (101 → 500+)
**Current state:** Only 101 ingredients. Common ingredients like `Sodium Stearate`, `CI 77891`, `Cyclopentasiloxane`, `Isopropyl Myristate` are missing → shown as "Non répertorié".

**Solution:** Import ingredients from:
- Your existing Excel files (`Analyse_Ingredients_Deodorants_Chimiques.xlsx`, etc.)
- INCI decoder public datasets
- COSING EU database (https://ec.europa.eu/growth/tools-databases/cosing/)

**Impact:** Fewer "unknown ingredient" fallbacks, more complete reports.

---

### 4. Better OCR — Use a Cloud Vision API Instead of Tesseract
**Current state:** Tesseract.js runs in the browser, is slow (~10–30 sec), and struggles with small text, curved labels, or low-contrast images.

**Solution:** Replace with **Google Cloud Vision API** or **Azure Computer Vision** (both have free tiers):
```python
# Server-side route /api/ocr
from google.cloud import vision
client = vision.ImageAnnotatorClient()
response = client.text_detection(image=vision.Image(content=image_bytes))
text = response.text_annotations[0].description
```
**Impact:** 5–10x better text extraction accuracy, especially on real product photos.

---

### 5. Confidence Score on Ingredient Matches
**Current state:** When an ingredient is matched via prefix/substring, there's no indication of how confident the match is. The user sees a result without knowing if it was exact or approximated.

**Solution:** Return a `match_confidence` field (`exact` / `prefix` / `fuzzy` / `substring`) in the API response and display it in the UI with a badge:
- 🟢 `Exact` — found in DB
- 🟡 `Approx` — prefix/fuzzy matched
- 🔴 `Inferred` — substring guessed

---

## 🟡 MEDIUM PRIORITY (UX & reliability improvements)

---

### 6. Export Report as PDF
**Current state:** No way to save results. Users must screenshot.

**Solution:** Add a "Download PDF" button using [jsPDF](https://github.com/parallax/jsPDF) + [html2canvas](https://html2canvas.hertzen.com/):
```js
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
html2canvas(resultLayout).then(canvas => {
    const pdf = new jsPDF();
    pdf.addImage(canvas.toDataURL(), 'PNG', 10, 10, 190, 0);
    pdf.save('biosecurstick-rapport.pdf');
});
```

---

### 7. Manual Ingredient Concentration Estimation
**Current state:** Concentrations are guessed from other products in the DB (`get_typical_concentration`), which is inaccurate for unknown or new formulations.

**Solution:** Let users set a **concentration mode** when editing:
- `Auto` (current behavior — guess from DB average)
- `By regulation max` (use the legal max allowed concentration)
- `Manual` (user types exact value)

---

### 8. Firebase Sync Reliability
**Current state:** If Firebase is down, the app silently falls back to `database.json` with no user notification. Also, `ingredients` vs `ingredients_list` naming is inconsistent (the `/api/calculate` route reads from `ingredients`, the others from `ingredients_list`).

**Fix in app.py line 502:**
```python
# Bug: /api/calculate reads 'ingredients' but data is stored in 'ingredients_list'
fb_ingredients = firebase_request('ingredients_list')  # <-- was 'ingredients'
master_ingredients = firebase_list_to_dict(fb_ingredients) if fb_ingredients else db.get("ingredients", {})
```
This means `/api/calculate` always falls back to local DB and misses any admin-added ingredients.

---

### 9. Add Product Image to Database
**Current state:** Products are listed by name only. No visual identification.

**Solution:** Add an optional `image_url` field to each product. Allow admin to paste a URL (e.g., from Open Food Facts or brand site). Display a small thumbnail in the product search dropdown and results card.

---

### 10. User-Uploaded Product Reporting
**Current state:** Admin-added products are visible to everyone (shared DB).

**Solution:** Add a simple "session mode" where users can analyse products without saving them to the shared database — their scan results live in `sessionStorage` and disappear when they close the tab.

---

## 🟢 LOW PRIORITY (Nice to have)

---

### 11. Multi-language Support (EN / FR / AR)
Use `i18next` or a simple `lang.js` dictionary to support Arabic (right-to-left), English, and French UI.

### 12. Dark/Light Mode Persistence per Device
Currently uses `localStorage` — already implemented. Consider syncing theme preference server-side for logged-in admins.

### 13. Rate Limiting on `/api/match_product`
Add `Flask-Limiter` to prevent abuse:
```python
from flask_limiter import Limiter
limiter = Limiter(app, default_limits=["30 per minute"])
```

### 14. Ingredient Trend Visualization
Show which ingredients appear most frequently across all 21 products, and which are highest risk. A heatmap-style view in the Admin dashboard.

### 15. Mobile Camera Capture
Add a `capture="environment"` attribute to the file input so mobile users can open their camera directly instead of uploading from gallery:
```html
<input type="file" id="fileInput" accept="image/*" capture="environment">
```

---

## 🔧 QUICK WINS (Can be done in < 1 hour each)

| # | Fix | File |
|---|-----|------|
| A | Fix `/api/calculate` to read `ingredients_list` not `ingredients` from Firebase | `app.py` line 502 |
| B | Add `capture="environment"` to file input for mobile camera | `index.html` line 101 |
| C | Add `aluminium` spelling variants for more ingredients (e.g., `aluminium zirconium`) | `database.json` + `app.py` |
| D | Show "matched via: exact/approximate" badge in ingredient editor | `main.js` |
| E | Add `sodium chloride`, `stearic acid`, `CI 77891` to ingredient database | `database.json` |
