import os
import json
import re
from flask import Flask, jsonify, request, render_template, send_from_directory

app = Flask(__name__, template_folder='templates', static_folder='static')

# Load database.json
DB_PATH = os.path.join(os.path.dirname(__file__), 'database.json')

def load_db():
    if os.path.exists(DB_PATH):
        with open(DB_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"products": [], "ingredients": {}}

db = load_db()

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

@app.route('/api/products', methods=['GET'])
def get_products():
    return jsonify(db.get("products", []))

@app.route('/api/ingredients', methods=['GET'])
def get_ingredients():
    return jsonify(db.get("ingredients", {}))

@app.route('/api/match_product', methods=['POST'])
def match_product():
    """
    Fuzzy matches text from OCR to products in the database.
    Also extracts any individual ingredients found in the text.
    """
    data = request.json or {}
    text = data.get('text', '')
    
    if not text:
        return jsonify({"matched": False, "message": "No text provided"}), 400
        
    # Clean OCR text
    text_clean = text.lower().strip()
    
    # 1. Try to match predefined products
    matched_product = None
    max_matches = 0
    
    products = db.get("products", [])
    for p in products:
        p_name = p["name"].lower()
        # Find matches based on terms (brand names like "sanex", "narta", "dove", "weleda", etc.)
        # We can split the product name into tokens and check if they occur in the text
        tokens = [t for t in re.split(r'\s+', p_name) if len(t) > 2 and t != "déodorant" and t != "deodorant"]
        matches = sum(1 for token in tokens if token in text_clean)
        
        # If we match a substantial portion of the name
        if matches > 0 and matches > max_matches:
            # Extra check for brand specificity
            brand = p_name.split()[0] # e.g., sanex, narta, caudalie, ca'fresh (c'fresh), l'artisan
            if brand in text_clean:
                matched_product = p
                max_matches = matches
                
    if matched_product:
        return jsonify({
            "matched": True,
            "match_type": "product",
            "product": matched_product
        })
        
    # 2. If no product matched, try to extract ingredients from the OCR text
    matched_ingredients = []
    master_ingredients = db.get("ingredients", {})
    
    # Sort ingredients by length descending to match longer names first (e.g. "Aluminum Chlorohydrate" before "Alum")
    sorted_ingredients = sorted(master_ingredients.items(), key=lambda x: len(x[0]), reverse=True)
    
    # We will search the text for ingredient names
    # Note: text clean can have commas, line breaks, etc.
    found_keys = set()
    for key, ing_info in sorted_ingredients:
        # Check if the ingredient name exists as a word/phrase in the text
        # Simple word boundary or pattern match
        pattern = r'\b' + re.escape(key) + r'\b'
        # Some chemical names have dashes or numbers, so a simple \b check might be strict,
        # but let's check sub-strings with word boundaries where appropriate.
        if re.search(pattern, text_clean) or key in text_clean:
            if key not in found_keys:
                found_keys.add(key)
                # Assign a default concentration based on typical values for that ingredient
                # We search if this ingredient exists in our database, and check its typical concentration.
                # Find all occurrences of this ingredient in the DB and get the average or typical concentration.
                con_str = "1-3%" # default fallback
                for p in products:
                    for ing in p["ingredients"]:
                        if ing["inci"].lower().strip() == key:
                            con_str = ing["concentration"]
                            break
                            
                matched_ingredients.append({
                    "inci": ing_info["inci"],
                    "concentration": con_str
                })
                
    if matched_ingredients:
        # Sort by typical concentration descending or keep order
        return jsonify({
            "matched": False,
            "match_type": "ingredients",
            "ingredients": matched_ingredients
        })
        
    return jsonify({
        "matched": False,
        "match_type": "none",
        "message": "Aucun produit ou ingrédient n'a été reconnu. Veuillez sélectionner ou saisir les ingrédients manuellement."
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
        
    master_ingredients = db.get("ingredients", {})
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

if __name__ == '__main__':
    # Start on standard port 5000
    app.run(debug=True, port=5000)
