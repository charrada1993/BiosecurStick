import os
import json
import re
import base64
try:
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request as GoogleAuthRequest
    GOOGLE_AUTH_AVAILABLE = True
except ImportError:
    GOOGLE_AUTH_AVAILABLE = False
try:
    from rapidfuzz import process as fuzz_process, fuzz
    RAPIDFUZZ_AVAILABLE = True
except ImportError:
    RAPIDFUZZ_AVAILABLE = False
import urllib.request
import urllib.parse
from flask import Flask, jsonify, request, render_template, send_from_directory, session, redirect, url_for

app = Flask(__name__, template_folder='templates', static_folder='static')
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "biosecurstick_secret_dev_key_2026")

# Load local database.json
DB_PATH = os.path.join(os.path.dirname(__file__), 'database.json')

def load_db():
    if os.path.exists(DB_PATH):
        with open(DB_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"products": [], "ingredients": {}}

db = load_db()

# Firebase RTDB Configurations
FIREBASE_URL = os.environ.get("FIREBASE_DB_URL", "https://biosecurstick-default-rtdb.europe-west1.firebasedatabase.app/").strip()
if not FIREBASE_URL.endswith('/'):
    FIREBASE_URL += '/'
FIREBASE_SECRET = os.environ.get("FIREBASE_DB_SECRET", "tZRJsTNDBaYRMYjIDCYyVoHum4NyUa2kLlw0wL6y").strip()

def firebase_request(path, method='GET', data=None):
    if not FIREBASE_URL or "firebase" not in FIREBASE_URL:
        return None
    if path.startswith('/'):
        path = path[1:]
    
    url = f"{FIREBASE_URL}{path}.json"
    if FIREBASE_SECRET:
        url += f"?auth={FIREBASE_SECRET}"
        
    req = urllib.request.Request(url, method=method)
    req.add_header('Content-Type', 'application/json')
    
    body = None
    if data is not None:
        body = json.dumps(data).encode('utf-8')
        
    try:
        with urllib.request.urlopen(req, data=body, timeout=10) as response:
            res_data = response.read().decode('utf-8')
            return json.loads(res_data) if res_data else None
    except Exception as e:
        print(f"Firebase request failed ({method} {path}): {e}")
        return None

def dict_to_firebase_list(d):
    return [{"key": k, **v} for k, v in d.items()]

def firebase_list_to_dict(lst):
    if not lst:
        return {}
    res = {}
    for item in lst:
        if item is not None and "key" in item:
            key = item["key"]
            res[key] = {k: v for k, v in item.items() if k != "key"}
    return res

def initialize_firebase_data():
    try:
        # Always push local data to Firebase to ensure corrections are reflected
        print("Synchronizing local database.json to Firebase Realtime Database...")
        firebase_request('products', method='PUT', data=db.get("products", []))
        ing_list = dict_to_firebase_list(db.get("ingredients", {}))
        firebase_request('ingredients_list', method='PUT', data=ing_list)
        print("Firebase sync complete.")
    except Exception as e:
        print(f"Error syncing Firebase data: {e}")

# Sync local data to Firebase at startup
initialize_firebase_data()

def parse_concentration_range(con_str):
    """
    Parses a concentration range string (e.g., '1-5%', '0.1-0.5%', 'Trace', '100%')
    and returns (C_median_percent, C_median_fraction).
    """
    if not con_str:
        return 0.0, 0.0
    
    con_str = str(con_str).strip().replace('%', '')
    
    # Check for simple numeric value
    try:
        val = float(con_str)
        return val, val / 100.0
    except ValueError:
        pass
        
    # Check for range like '1-5' or '0.5 - 2' or '0.1-0.5'
    range_match = re.match(r'^([\d\.]+)\s*-\s*([\d\.]+)$', con_str)
    if range_match:
        try:
            low = float(range_match.group(1))
            high = float(range_match.group(2))
            median = (low + high) / 2.0
            return median, median / 100.0
        except ValueError:
            pass
            
    # Check for words like Trace
    if 'trace' in con_str.lower():
        # Trace is usually very small, in the database it is represented as Trace,
        # but let's check what concentration or median is used.
        # In Caudalie / Pierre d'Alun, Trace is around 0.01%
        return 0.01, 0.0001
        
    return 1.0, 0.01 # Default to 1% if we can't parse it

def calculate_ingredient_scoring(ing_name, concentration_str, master_ingredients):
    """
    Performs the biosecurity calculations for a single ingredient.
    """
    key = str(ing_name).lower().strip()
    
    # Default parameters from master list
    master_info = master_ingredients.get(key, {
        "inci": ing_name,
        "symbole": ing_name,
        "cas": "",
        "role": "Ingrédient",
        "d": 1, # Default danger to 1 (moderate/unknown)
        "justification_danger": "Non répertorié dans la base standard.",
        "source_danger": "Évaluation par défaut",
        "noael": "N/D",
        "source_noael": "",
        "norme": "",
        "conformite": "Oui"
    })
    
    c_median_pct, c_median_frac = parse_concentration_range(concentration_str)
    
    # SED calculation: SED = (C * 1000 * RF * F) / BW = C * 16.666667
    # (where C is the fraction, RF=1, F=1, BW=60kg)
    sed = c_median_frac * (1000.0 * 1.0 * 1.0) / 60.0
    sed = round(sed, 6)
    
    # E class calculation
    if sed < 0.01:
        e = 0
        interp_e = "Exposition négligeable (SED < 0.01)"
    elif sed < 0.1:
        e = 1
        interp_e = "Exposition faible (0.01 ≤ SED < 0.1)"
    elif sed < 1.0:
        e = 2
        interp_e = "Exposition modérée (0.1 ≤ SED < 1)"
    else:
        e = 3
        interp_e = "Exposition élevée (SED ≥ 1)"
        
    # MS calculation
    noael = master_info.get("noael", "N/D")
    
    # Check if NOAEL can be treated as number
    is_noael_num = False
    noael_num = 0.0
    if noael != "N/D" and noael is not None:
        try:
            noael_num = float(noael)
            is_noael_num = True
        except ValueError:
            pass
            
    if is_noael_num:
        ms = noael_num / sed if sed > 0 else 999999.0
        ms = round(ms, 2)
        if ms >= 100:
            interp_ms = "Large ≥100 — Sûr"
        elif ms >= 30:
            interp_ms = "Acceptable 30–99 — Vigilance"
        else:
            interp_ms = "Faible <30 — Risque élevé"
            
        # Score calculation: Score = (D + E) / MS * 100
        d = master_info.get("d", 1)
        score = ((d + e) / ms) * 100.0
        score = round(score, 4)
    else:
        ms = "N/D"
        interp_ms = "N/D (NOAEL indisponible)"
        score = "N/D"
        
    # Build complete record
    record = {
        "inci": master_info.get("inci", ing_name),
        "symbole": master_info.get("symbole", ing_name),
        "role": master_info.get("role", ""),
        "cas": master_info.get("cas", ""),
        "concentration": concentration_str,
        "c_median": f"{round(c_median_pct, 3)}%",
        "norme": master_info.get("norme", ""),
        "conformite": master_info.get("conformite", "Oui"),
        "d": master_info.get("d", 1),
        "justification_danger": master_info.get("justification_danger", ""),
        "source_danger": master_info.get("source_danger", ""),
        "noael": noael,
        "source_noael": master_info.get("source_noael", ""),
        "sed": sed,
        "calcul_sed": f"({round(c_median_pct, 2)}%×1000×1×1)/60",
        "e": e,
        "interp_e": interp_e,
        "ms": ms,
        "interp_ms": interp_ms,
        "score": score
    }
    return record

@app.route('/')
def index():
    return render_template('index.html')

# ── GOOGLE CLOUD VISION OCR ENDPOINT ──────────────────────────────────
# Authenticates using a Google Cloud Service Account.
# Set ONE of the following environment variables:
#   GOOGLE_APPLICATION_CREDENTIALS_JSON → full JSON content (for Render / cloud)
#   GOOGLE_APPLICATION_CREDENTIALS       → path to the .json file  (for local)
GOOGLE_VISION_API_URL = "https://vision.googleapis.com/v1/images:annotate"
_VISION_SCOPES = ['https://www.googleapis.com/auth/cloud-vision']


def _get_vision_access_token():
    """
    Returns a short-lived OAuth2 Bearer token for the Vision API,
    or None if no credentials are configured.
    """
    if not GOOGLE_AUTH_AVAILABLE:
        print("google-auth not installed — OCR unavailable.")
        return None

    # 1️⃣  Try env var with full JSON content (best for Render cloud env)
    creds_json_str = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS_JSON', '').strip()
    if creds_json_str:
        try:
            creds_dict = json.loads(creds_json_str)
            creds = service_account.Credentials.from_service_account_info(
                creds_dict, scopes=_VISION_SCOPES)
            creds.refresh(GoogleAuthRequest())
            return creds.token
        except Exception as e:
            print(f"Vision auth error (JSON env var): {e}")
            return None

    # 2️⃣  Try standard file path env var (local development)
    creds_file = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS', '').strip()
    if creds_file and os.path.exists(creds_file):
        try:
            creds = service_account.Credentials.from_service_account_file(
                creds_file, scopes=_VISION_SCOPES)
            creds.refresh(GoogleAuthRequest())
            return creds.token
        except Exception as e:
            print(f"Vision auth error (file path): {e}")
            return None

    # 3️⃣  Try default JSON file in project root (dev convenience)
    local_json = os.path.join(os.path.dirname(__file__), 'biosecurstick-500113-d74e8d9bc2fe.json')
    if os.path.exists(local_json):
        try:
            creds = service_account.Credentials.from_service_account_file(
                local_json, scopes=_VISION_SCOPES)
            creds.refresh(GoogleAuthRequest())
            return creds.token
        except Exception as e:
            print(f"Vision auth error (local file): {e}")
            return None

    return None


@app.route('/api/ocr', methods=['POST'])
def ocr_image():
    """
    Receives a JPEG/PNG image upload, sends it to Google Cloud Vision
    TEXT_DETECTION using Service Account credentials, and returns the
    raw extracted text.
    Falls back with a clear 503 if no credentials are configured so the
    frontend can switch to Tesseract.js.
    """
    access_token = _get_vision_access_token()
    if not access_token:
        return jsonify({
            'error': 'Google Vision credentials non configurées.',
            'hint': 'Définissez GOOGLE_APPLICATION_CREDENTIALS_JSON dans les variables Render.',
            'text': ''
        }), 503

    if 'image' not in request.files:
        return jsonify({'error': 'Aucun fichier image reçu.'}), 400

    image_file = request.files['image']
    image_bytes = image_file.read()
    if not image_bytes:
        return jsonify({'error': 'Fichier image vide.'}), 400

    # Encode image as base64 for the Vision API
    image_b64 = base64.b64encode(image_bytes).decode('utf-8')

    payload = {
        'requests': [{
            'image': {'content': image_b64},
            'features': [{
                'type': 'TEXT_DETECTION',
                'maxResults': 1
            }],
            'imageContext': {
                # French + English covers most cosmetic labels.
                # 'la' (Latin) helps with INCI chemical names.
                'languageHints': ['fr', 'en', 'la']
            }
        }]
    }

    req = urllib.request.Request(
        GOOGLE_VISION_API_URL,
        data=json.dumps(payload).encode('utf-8'),
        method='POST'
    )
    req.add_header('Content-Type', 'application/json')
    req.add_header('Authorization', f'Bearer {access_token}')

    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            result = json.loads(response.read().decode('utf-8'))

        responses = result.get('responses', [])
        if not responses:
            return jsonify({'text': '', 'words': 0})

        text_annotations = responses[0].get('textAnnotations', [])
        error_obj = responses[0].get('error', None)
        if error_obj:
            return jsonify({'error': error_obj.get('message', 'Vision API error'), 'text': ''}), 502

        if not text_annotations:
            return jsonify({'text': '', 'words': 0})

        # textAnnotations[0].description contains the full extracted text block
        full_text = text_annotations[0].get('description', '')
        word_count = len(full_text.split())
        print(f'Vision OCR: extracted {word_count} words from image.')
        return jsonify({'text': full_text, 'words': word_count})

    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f'Vision API HTTP error {e.code}: {body}')
        return jsonify({'error': f'Vision API error {e.code}: {body[:200]}', 'text': ''}), 502
    except Exception as e:
        print(f'Vision OCR unexpected error: {e}')
        return jsonify({'error': str(e), 'text': ''}), 500

@app.route('/api/products', methods=['GET'])
def get_products():
    fb_products = firebase_request('products')
    if fb_products is not None:
        if isinstance(fb_products, dict):
            # If Firebase returns a dict (e.g. key-value pairs of products), extract values
            return jsonify(list(fb_products.values()))
        elif isinstance(fb_products, list):
            # If Firebase returns a list, filter out any None placeholders (Firebase handles sparse arrays with nulls)
            return jsonify([p for p in fb_products if p is not None])
    return jsonify(db.get("products", []))

@app.route('/api/ingredients', methods=['GET'])
def get_ingredients():
    fb_ingredients = firebase_request('ingredients_list')
    if fb_ingredients is not None:
        return jsonify(firebase_list_to_dict(fb_ingredients))
    return jsonify(db.get("ingredients", {}))

@app.route('/api/match_product', methods=['POST'])
def match_product():
    """
    Multi-strategy OCR text → ingredient list extraction.
    Strategy 1: Match predefined products by brand/name tokens.
    Strategy 2: Split OCR text into tokens; for each token try:
        a) Exact match
        b) Prefix match  (OCR truncated end of word)
        c) Substring match (short DB key inside longer OCR token)
        d) Fuzzy match via RapidFuzz (handles OCR character swaps, e.g. 1↔l, 0↔O)
    Strategy 3: Full-text substring scan as fallback.
    """
    import unicodedata

    # ── Common OCR / EU-vs-US spelling aliases ─────────────────────────
    SPELLING_ALIASES = [
        # EU 'aluminium' vs US 'aluminum' (very common on French labels)
        ('aluminium', 'aluminum'),
        # OCR often drops dots in abbreviations
        ('alcohol denat ',  'alcohol denat.'),
        ('tocopherol vit e', 'tocopherol (vit e)'),
        # Fragrance variant spellings
        ('fragrance',  'parfum'),
        # Some labels use 'water' standalone
        ('water',      'aqua'),
    ]

    def normalize(s):
        """Lowercase, strip accents, remove non-alphanumeric except spaces/hyphens."""
        s = s.lower().strip()
        s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode('utf-8')
        return s

    def normalize_with_aliases(s):
        """Normalize then apply EU/US spelling aliases so both spellings resolve."""
        n = normalize(s)
        for wrong, right in SPELLING_ALIASES:
            if n == wrong or n == normalize(wrong):
                return normalize(right)
        return n

    data = request.json or {}
    text = data.get('text', '')

    if not text:
        return jsonify({"matched": False, "message": "No text provided"}), 400

    text_norm = normalize_with_aliases(text)
    # Load products and ingredients from Firebase if available
    fb_products = firebase_request('products')
    if fb_products is not None:
        if isinstance(fb_products, dict):
            products = list(fb_products.values())
        elif isinstance(fb_products, list):
            products = [p for p in fb_products if p is not None]
    else:
        products = db.get("products", [])

    fb_ingredients = firebase_request('ingredients_list')
    master_ingredients = firebase_list_to_dict(fb_ingredients) if fb_ingredients is not None else db.get("ingredients", {})

    # ── STRATEGY 1: Product name matching ──────────────────────────────
    matched_product = None
    max_matches = 0

    for p in products:
        p_name_norm = normalize(p["name"])
        tokens = [t for t in re.split(r'\s+', p_name_norm)
                  if len(t) > 2 and t not in ("deodorant", "deo")]
        matches = sum(1 for token in tokens if token in text_norm)
        if matches > 0 and matches > max_matches:
            brand = p_name_norm.split()[0]
            if brand in text_norm:
                matched_product = p
                max_matches = matches

    if matched_product:
        # Even when a product is matched, also scan OCR text for any extra ingredients
        # not already present in the database record (label may list more than we stored).

        # Build a lookup of database product's ingredient INCI names
        db_ing_names = {normalize(ing["inci"]) for ing in matched_product.get("ingredients", [])}

        # Build master ingredient lookup (same as Strategy 2)
        ing_lookup = {}
        for key, info in master_ingredients.items():
            ing_lookup[normalize(key)] = (key, info)
            inci_norm = normalize(info.get("inci", key))
            if inci_norm not in ing_lookup:
                ing_lookup[inci_norm] = (key, info)
        sorted_lookup_keys = sorted(ing_lookup.keys(), key=len, reverse=True)

        # Helper: find typical concentration
        def get_conc_for_product(original_key, ing_info):
            for p in products:
                for ing in p["ingredients"]:
                    if normalize(ing["inci"]) == normalize(ing_info.get("inci", original_key)):
                        return ing["concentration"]
            return "1-3%"

        # Scan OCR tokens for extra ingredients
        raw_tokens = re.split(r'[,;\n\r\.]+', text)
        if len([t for t in raw_tokens if len(t.strip()) > 5]) <= 1:
            raw_tokens = re.split(r'[,;\n\r\.\s]+', text)
        cleaned_tokens = [normalize_with_aliases(t) for t in raw_tokens if len(t.strip()) > 2]
        extra_found_keys = set()
        extra_ingredients = []

        for token in cleaned_tokens:
            token = token.strip()
            if len(token) < 3:
                continue

            # Exact match (apply alias normalization)
            token = normalize_with_aliases(token)
            if token in ing_lookup:
                original_key, info = ing_lookup[token]
                inci_n = normalize(info["inci"])
                if original_key not in extra_found_keys and inci_n not in db_ing_names:
                    extra_found_keys.add(original_key)
                    extra_ingredients.append({
                        "inci": info["inci"],
                        "concentration": get_conc_for_product(original_key, info)
                    })
                continue

            # Prefix match
            for lk in sorted_lookup_keys:
                if lk.startswith(token) and len(token) >= max(4, len(lk) - 4):
                    original_key, info = ing_lookup[lk]
                    inci_n = normalize(info["inci"])
                    if original_key not in extra_found_keys and inci_n not in db_ing_names:
                        extra_found_keys.add(original_key)
                        extra_ingredients.append({
                            "inci": info["inci"],
                            "concentration": get_conc_for_product(original_key, info)
                        })
                    break

            # Substring match
            for lk in sorted_lookup_keys:
                if len(lk) >= 4 and lk in token:
                    original_key, info = ing_lookup[lk]
                    inci_n = normalize(info["inci"])
                    if original_key not in extra_found_keys and inci_n not in db_ing_names:
                        extra_found_keys.add(original_key)
                        extra_ingredients.append({
                            "inci": info["inci"],
                            "concentration": get_conc_for_product(original_key, info)
                        })
                    break

        return jsonify({
            "matched": True,
            "match_type": "product",
            "product": matched_product,
            "extra_ingredients": extra_ingredients,  # OCR-found extras not in the database
            "total_found": len(matched_product.get("ingredients", [])) + len(extra_ingredients)
        })


    # ── STRATEGY 2: Token-by-token ingredient extraction ───────────────
    # Split OCR text on commas, semicolons, newlines, and dots
    raw_tokens = re.split(r'[,;\n\r\.]+', text)
    # If the OCR gave us only 1 big chunk (no commas/newlines), also try space-splitting
    if len([t for t in raw_tokens if len(t.strip()) > 5]) <= 1:
        raw_tokens = re.split(r'[,;\n\r\.\s]+', text)
    # Clean each token
    cleaned_tokens = [normalize_with_aliases(t) for t in raw_tokens if len(t.strip()) > 2]

    # Build a lookup: normalized_key → (original_key, ing_info)
    ing_lookup = {}
    for key, info in master_ingredients.items():
        ing_lookup[normalize(key)] = (key, info)
        # Also index by normalized INCI name
        inci_norm = normalize(info.get("inci", key))
        if inci_norm not in ing_lookup:
            ing_lookup[inci_norm] = (key, info)

    # Sort lookup keys longest-first (greedy matching)
    sorted_lookup_keys = sorted(ing_lookup.keys(), key=len, reverse=True)

    found_keys = set()
    matched_ingredients = []

    def get_typical_concentration(original_key, ing_info):
        """Find the most common concentration for this ingredient across all products."""
        for p in products:
            for ing in p["ingredients"]:
                if normalize(ing["inci"]) == normalize(ing_info.get("inci", original_key)):
                    return ing["concentration"]
        return "1-3%"

    # ── Pre-build fuzzy candidate list (normalized keys, shortest-first) ───
    # Only keys long enough to be a real ingredient name (avoids false positives
    # on tiny 3-letter keys like 'peg' matching 'ppg' at high confidence).
    FUZZY_MIN_KEY_LEN = 5
    FUZZY_SCORE_CUTOFF = 85  # 0-100; 85 = very strict, avoids false positives
    fuzzy_candidates = [lk for lk in sorted_lookup_keys if len(lk) >= FUZZY_MIN_KEY_LEN]

    def try_match_token(token):
        """Try to match a single OCR token to an ingredient using multiple strategies."""
        token = token.strip()
        if len(token) < 3:
            return

        # Apply alias normalization
        token = normalize_with_aliases(token)

        # ── a) Exact match ────────────────────────────────────────────────
        if token in ing_lookup:
            original_key, info = ing_lookup[token]
            if original_key not in found_keys:
                found_keys.add(original_key)
                matched_ingredients.append({
                    "inci": info["inci"],
                    "concentration": get_typical_concentration(original_key, info),
                    "match_method": "exact"
                })
            return

        # ── b) Prefix match (OCR may cut off the end of a word) ───────────
        for lk in sorted_lookup_keys:
            if lk.startswith(token) and len(token) >= max(4, len(lk) - 4):
                original_key, info = ing_lookup[lk]
                if original_key not in found_keys:
                    found_keys.add(original_key)
                    matched_ingredients.append({
                        "inci": info["inci"],
                        "concentration": get_typical_concentration(original_key, info),
                        "match_method": "prefix"
                    })
                return

        # ── c) Substring match (short DB key inside longer OCR token) ─────
        for lk in sorted_lookup_keys:
            if len(lk) >= 4 and lk in token:
                original_key, info = ing_lookup[lk]
                if original_key not in found_keys:
                    found_keys.add(original_key)
                    matched_ingredients.append({
                        "inci": info["inci"],
                        "concentration": get_typical_concentration(original_key, info),
                        "match_method": "substring"
                    })
                return

        # ── d) Fuzzy match via RapidFuzz (handles OCR char errors: 1↔l, 0↔O) ─
        # Only run when the token is long enough to avoid accidental matches.
        if RAPIDFUZZ_AVAILABLE and len(token) >= FUZZY_MIN_KEY_LEN:
            result = fuzz_process.extractOne(
                token,
                fuzzy_candidates,
                scorer=fuzz.token_sort_ratio,  # robust to word-order / OCR shifts
                score_cutoff=FUZZY_SCORE_CUTOFF
            )
            if result:
                matched_key, score, _ = result
                original_key, info = ing_lookup[matched_key]
                if original_key not in found_keys:
                    found_keys.add(original_key)
                    matched_ingredients.append({
                        "inci": info["inci"],
                        "concentration": get_typical_concentration(original_key, info),
                        "match_method": f"fuzzy({score})"
                    })
            return

    # Try each individual OCR token
    for token in cleaned_tokens:
        try_match_token(token)

    # ── STRATEGY 3: Full-text scan fallback ────────────────────────────
    # If token-matching gave few results, also do a full-text substring scan
    if len(matched_ingredients) < 3:
        for lk in sorted_lookup_keys:
            if len(lk) < 4:
                continue
            original_key, info = ing_lookup[lk]
            if original_key in found_keys:
                continue
            if lk in text_norm:
                found_keys.add(original_key)
                matched_ingredients.append({
                    "inci": info["inci"],
                    "concentration": get_typical_concentration(original_key, info)
                })

    if matched_ingredients:
        return jsonify({
            "matched": False,
            "match_type": "ingredients",
            "ingredients": matched_ingredients,
            "total_found": len(matched_ingredients)
        })

    return jsonify({
        "matched": False,
        "match_type": "none",
        "message": "Aucun ingrédient reconnu dans l'image. Essayez une photo plus nette ou sélectionnez un produit manuellement."
    })

@app.route('/api/calculate', methods=['POST'])
def calculate_score():
    """
    Computes scores for a list of ingredients and their concentrations.
    """
    data = request.json or {}
    ingredients_input = data.get('ingredients', [])
    
    if not ingredients_input:
        return jsonify({
            "global_score": 0.0,
            "interpretation": "Sûr (0–30%)",
            "ingredients": [],
            "error": "Aucun ingrédient fourni"
        })
        
    fb_ingredients = firebase_request('ingredients_list')
    master_ingredients = firebase_list_to_dict(fb_ingredients) if fb_ingredients is not None else db.get("ingredients", {})
    results = []
    
    total_score_sum = 0.0
    for ing in ingredients_input:
        name = ing.get('inci', '')
        con_str = ing.get('concentration', '')
        
        calc_record = calculate_ingredient_scoring(name, con_str, master_ingredients)
        results.append(calc_record)
        
        score_val = calc_record["score"]
        if score_val != "N/D" and score_val is not None:
            total_score_sum += float(score_val)
            
    # Global score is average: sum of scores / total number of ingredients (including N/D ingredients counted as 0)
    nb_ingredients = len(results)
    global_score = total_score_sum / nb_ingredients if nb_ingredients > 0 else 0.0
    global_score = round(global_score, 2)
    
    # Interpretation
    if global_score <= 30.0:
        interpretation = "Sûr (0–30%)"
    elif global_score <= 60.0:
        interpretation = "Vigilance (31–60%)"
    else:
        interpretation = "Risque élevé (>60%)"
        
    return jsonify({
        "global_score": global_score,
        "interpretation": interpretation,
        "ingredients": results
    })

# ── AUTHENTICATION AND ADMIN DASHBOARD ROUTES ─────────────────────
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "admin123")

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        if username == ADMIN_USER and password == ADMIN_PASS:
            session['role'] = 'admin'
            session['username'] = username
            return redirect(url_for('admin_dashboard'))
        else:
            return render_template('login.html', error="Identifiants invalides. Veuillez réessayer.")
            
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/admin')
def admin_dashboard():
    if session.get('role') != 'admin':
        return redirect(url_for('login'))
    return render_template('admin.html')

@app.route('/api/admin/add_product', methods=['POST'])
def add_product():
    if session.get('role') != 'admin':
        return jsonify({"error": "Accès refusé. Administrateur uniquement."}), 403
        
    data = request.json or {}
    name = data.get('name', '').strip()
    category = data.get('category', 'Chimique').strip()
    reference = data.get('reference', 'Standard').strip()
    ingredients_input = data.get('ingredients', [])
    
    if not name or not ingredients_input:
        return jsonify({"error": "Le nom du produit et la liste des ingrédients sont requis."}), 400
        
    # Get master list of ingredients from Firebase or local DB
    fb_ingredients = firebase_request('ingredients_list')
    master_ingredients = firebase_list_to_dict(fb_ingredients) if fb_ingredients is not None else db.get("ingredients", {})
    
    # Calculate scores for each ingredient automatically
    calculated_ingredients = []
    total_score_sum = 0.0
    for ing in ingredients_input:
        ing_name = ing.get('inci', '').strip()
        concentration = ing.get('concentration', '1-3%').strip()
        
        calc_record = calculate_ingredient_scoring(ing_name, concentration, master_ingredients)
        calculated_ingredients.append(calc_record)
        
        score_val = calc_record.get('score')
        if score_val != "N/D" and score_val is not None:
            total_score_sum += float(score_val)
            
    # Calculate overall global score
    nb_ingredients = len(calculated_ingredients)
    global_score = total_score_sum / nb_ingredients if nb_ingredients > 0 else 0.0
    global_score = round(global_score, 2)
    
    # Interpretation
    if global_score <= 30.0:
        interpretation = "Sûr (0–30%)"
    elif global_score <= 60.0:
        interpretation = "Vigilance (31–60%)"
    else:
        interpretation = "Risque élevé (>60%)"
        
    new_product = {
        "name": name,
        "category": category,
        "reference": reference,
        "global_score": global_score,
        "ingredients": calculated_ingredients,
        "interpretation": interpretation
    }
    
    # Load all existing products
    fb_products = firebase_request('products')
    if fb_products is not None:
        if isinstance(fb_products, dict):
            products_list = list(fb_products.values())
        elif isinstance(fb_products, list):
            products_list = [p for p in fb_products if p is not None]
    else:
        products_list = db.get("products", [])
        
    # Append the new calculated product
    products_list.append(new_product)
    
    # Push back to Firebase RTDB
    firebase_sync_success = True
    if FIREBASE_URL and "firebase" in FIREBASE_URL:
        res = firebase_request('products', method='PUT', data=products_list)
        if res is None:
            firebase_sync_success = False
            
    # Push back to local database.json
    db["products"] = products_list
    try:
        with open(DB_PATH, 'w', encoding='utf-8') as f:
            json.dump(db, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving new product locally to database.json: {e}")
        
    return jsonify({
        "success": True,
        "firebase_sync": firebase_sync_success,
        "product": new_product
    })


@app.route('/api/admin/force_sync', methods=['POST'])
def force_sync():
    """Force-push all local database.json data to Firebase (admin only)."""
    if session.get('role') != 'admin':
        return jsonify({"error": "Accès refusé. Administrateur uniquement."}), 403
    try:
        fresh_db = load_db()
        ok_products = firebase_request('products', method='PUT', data=fresh_db.get("products", []))
        ing_list = dict_to_firebase_list(fresh_db.get("ingredients", {}))
        ok_ings = firebase_request('ingredients_list', method='PUT', data=ing_list)
        if ok_products is None or ok_ings is None:
            return jsonify({"success": False, "message": "Firebase non disponible — données locales utilisées."})
        return jsonify({
            "success": True,
            "products_count": len(fresh_db.get("products", [])),
            "message": "Synchronisation Firebase complète."
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
