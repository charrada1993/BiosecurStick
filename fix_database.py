"""
Script de correction de la base de données - database.json
Corrections:
1. NARTA - Ajouter champ inci_manuel avec liste INCI complète
2. EVYAP - Diagnostic bug affichage (score DB=7.0, web=3.86)
3. DOVE - Recalcul score correct
4. MONOPRIX - Correction nom (MONOPIX → MONOPRIX) + recalcul score
5. GREEN YOUTH - Recalcul score
6. TRESORS NATURELS - Recalcul score
7. CAUDALIE - Vérification (DB=0.43 déjà correct)
"""

import json
import re

# ────────────────────────────────────────────────
# Charger la base
# ────────────────────────────────────────────────
with open('database.json', 'r', encoding='utf-8') as f:
    db = json.load(f)

products = db['products']


def recalculate_global_score(product):
    """Recalcule le global_score à partir des scores des ingrédients."""
    total = 0.0
    count = len(product['ingredients'])
    for ing in product['ingredients']:
        s = ing.get('score', 'N/D')
        if s != 'N/D' and s is not None:
            total += float(s)
    if count == 0:
        return 0.0
    return round(total / count, 2)


# ────────────────────────────────────────────────
# 1. NARTA (index 1) — Ajouter inci_manuel
# ────────────────────────────────────────────────
narta_idx = next(i for i, p in enumerate(products) if 'NARTA' in p['name'])
narta = products[narta_idx]

narta['inci_manuel'] = (
    "Aqua/Water, Aluminum Chlorohydrate, Cetearyl Alcohol, Ceteareth-33, "
    "Parfum/Fragrance, Dimethicone, Phenoxyethanol, Pentylene Glycol, "
    "Tetrasodium Glutamate Diacetate, Linalool, Limonene, Benzyl Alcohol, Geraniol"
)

# Recalcul score NARTA
narta_score = recalculate_global_score(narta)
old_score = narta['global_score']
narta['global_score'] = narta_score
print(f"[NARTA] global_score: {old_score} → {narta_score}")
print(f"[NARTA] inci_manuel ajouté: {narta['inci_manuel']}")


# ────────────────────────────────────────────────
# 2. EVYAP (index 8) — Vérification score
#    DB stocke 7.0, mais le web affiche 3.86
#    Recalculons depuis les ingrédients pour voir quel est le vrai score
# ────────────────────────────────────────────────
evyap_idx = next(i for i, p in enumerate(products) if 'EVYAP' in p['name'])
evyap = products[evyap_idx]
evyap_recalc = recalculate_global_score(evyap)
print(f"\n[EVYAP] global_score stocké: {evyap['global_score']}")
print(f"[EVYAP] global_score recalculé depuis ingrédients: {evyap_recalc}")
print(f"[EVYAP] Ingrédients:")
for ing in evyap['ingredients']:
    print(f"  - {ing['inci']}: score={ing['score']}")

# Le score réel est 7.00 selon l'utilisateur — forcer à 7.00
evyap['global_score'] = 7.0
print(f"[EVYAP] global_score forcé à: 7.0")


# ────────────────────────────────────────────────
# 3. DOVE (index 9) — Recalcul
# ────────────────────────────────────────────────
dove_idx = next(i for i, p in enumerate(products) if 'DOVE' in p['name'])
dove = products[dove_idx]
dove_recalc = recalculate_global_score(dove)
old = dove['global_score']
dove['global_score'] = dove_recalc
if dove_recalc <= 30.0:
    dove['interpretation'] = "Sûr (0–30%)"
elif dove_recalc <= 60.0:
    dove['interpretation'] = "Vigilance (31–60%)"
else:
    dove['interpretation'] = "Risque élevé (>60%)"
print(f"\n[DOVE] global_score: {old} → {dove_recalc}")
print(f"[DOVE] interp: {dove['interpretation']}")


# ────────────────────────────────────────────────
# 4. MONOPRIX (index 6) — Correction nom + recalcul
# ────────────────────────────────────────────────
monoprix_idx = next(i for i, p in enumerate(products) if 'MONOP' in p['name'])
monoprix = products[monoprix_idx]
old_name = monoprix['name']
monoprix['name'] = 'MONOPRIX ANTI-TRANSPIRANT 48H'
monoprix_recalc = recalculate_global_score(monoprix)
old = monoprix['global_score']
monoprix['global_score'] = monoprix_recalc
if monoprix_recalc <= 30.0:
    monoprix['interpretation'] = "Sûr (0–30%)"
elif monoprix_recalc <= 60.0:
    monoprix['interpretation'] = "Vigilance (31–60%)"
else:
    monoprix['interpretation'] = "Risque élevé (>60%)"
print(f"\n[MONOPRIX] nom: '{old_name}' → '{monoprix['name']}'")
print(f"[MONOPRIX] global_score: {old} → {monoprix_recalc}")


# ────────────────────────────────────────────────
# 5. GREEN YOUTH (index 14) — Recalcul + vérif
# ────────────────────────────────────────────────
gy_idx = next(i for i, p in enumerate(products) if 'GREEN YOUTH' in p['name'])
gy = products[gy_idx]
gy_recalc = recalculate_global_score(gy)
old = gy['global_score']
gy['global_score'] = gy_recalc
if gy_recalc <= 30.0:
    gy['interpretation'] = "Sûr (0–30%)"
elif gy_recalc <= 60.0:
    gy['interpretation'] = "Vigilance (31–60%)"
else:
    gy['interpretation'] = "Risque élevé (>60%)"
print(f"\n[GREEN YOUTH] global_score: {old} → {gy_recalc}")
print(f"[GREEN YOUTH] Scores des ingrédients:")
for ing in gy['ingredients']:
    print(f"  - {ing['inci']}: score={ing['score']}")


# ────────────────────────────────────────────────
# 6. TRESORS NATURELS (index 11) — Recalcul + vérif
# ────────────────────────────────────────────────
tn_idx = next(i for i, p in enumerate(products) if 'SORS' in p['name'] or 'ESORS' in p['name'])
tn = products[tn_idx]
tn_recalc = recalculate_global_score(tn)
old = tn['global_score']
tn['global_score'] = tn_recalc
if tn_recalc <= 30.0:
    tn['interpretation'] = "Sûr (0–30%)"
elif tn_recalc <= 60.0:
    tn['interpretation'] = "Vigilance (31–60%)"
else:
    tn['interpretation'] = "Risque élevé (>60%)"
print(f"\n[TRESORS NATURELS] global_score: {old} → {tn_recalc}")
print(f"[TRESORS NATURELS] Scores des ingrédients:")
for ing in tn['ingredients']:
    print(f"  - {ing['inci']}: score={ing['score']}")


# ────────────────────────────────────────────────
# 7. CAUDALIE (index 15) — Vérification
# ────────────────────────────────────────────────
caud_idx = next(i for i, p in enumerate(products) if 'CAUDALIE' in p['name'])
caud = products[caud_idx]
caud_recalc = recalculate_global_score(caud)
print(f"\n[CAUDALIE] global_score stocké: {caud['global_score']}, recalculé: {caud_recalc}")
# Si l'écran affiche 0.40 mais le réel est 0.43, forcer à 0.43
if caud['global_score'] != 0.43:
    caud['global_score'] = 0.43
    print(f"[CAUDALIE] global_score corrigé → 0.43")
else:
    print(f"[CAUDALIE] global_score déjà correct: 0.43")


# ────────────────────────────────────────────────
# Sauvegarder
# ────────────────────────────────────────────────
db['products'] = products
with open('database.json', 'w', encoding='utf-8') as f:
    json.dump(db, f, indent=4, ensure_ascii=False)

print("\n\n=== RÉSUMÉ FINAL ===")
for p in db['products']:
    print(f"  {p['name']}: {p['global_score']}")

print("\n✅ database.json mis à jour avec succès!")
