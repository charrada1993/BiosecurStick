import json

db = json.load(open('database.json', 'r', encoding='utf-8'))

# Show all products with index, name, score, category
print("=== ALL PRODUCTS ===")
for i, p in enumerate(db['products']):
    print(f"[{i}] {p['name']} | score={p['global_score']} | cat={p['category']}")

print("\n=== ISSUES TO FIX ===")
# NARTA - needs manual INCI list
print("\n1. NARTA EFFICACITÉ INTÉGRALE 48H (index 1):")
narta = db['products'][1]
print(f"   Name: {narta['name']}, Score: {narta['global_score']}, Ref: {narta['reference']}")
for ing in narta['ingredients']:
    print(f"   - {ing['inci']}: {ing['concentration']}")

# EVYAP - web=3.86, real=7.00
print("\n2. EVYAP EMOTION INVISIBLE FRESH (index 8):")
evyap = db['products'][8]
print(f"   Name: {evyap['name']}, Score: {evyap['global_score']}")
print(f"   Web shows 3.86, real should be 7.00")

# DOVE - wrong score
print("\n3. DOVE UNILEVER DÉODORANT (index 9):")
dove = db['products'][9]
print(f"   Name: {dove['name']}, Score: {dove['global_score']}")
for ing in dove['ingredients']:
    print(f"   - {ing['inci']}: {ing['concentration']} | score={ing['score']}")

# MONOPRIX - wrong score
print("\n4. MONOPRIX (index 6):")
monoprix = db['products'][6]
print(f"   Name: {monoprix['name']}, Score: {monoprix['global_score']}")
for ing in monoprix['ingredients']:
    print(f"   - {ing['inci']}: {ing['concentration']} | score={ing['score']}")

# CAUDALIE - result 0.40, real 0.43
print("\n5. CAUDALIE VINOFRESH (index 15):")
caudalie = db['products'][15]
print(f"   Name: {caudalie['name']}, Score: {caudalie['global_score']}")

# GREEN YOUTH - wrong score
print("\n6. GREEN YOUTH (index 14):")
gy = db['products'][14]
print(f"   Name: {gy['name']}, Score: {gy['global_score']}")
for ing in gy['ingredients']:
    print(f"   - {ing['inci']}: {ing['concentration']} | score={ing['score']}")

# TRESORS NATURELS - wrong score
print("\n7. TRESORS NATURELS (index 11):")
tn = db['products'][11]
print(f"   Name: {tn['name']}, Score: {tn['global_score']}")
for ing in tn['ingredients']:
    print(f"   - {ing['inci']}: {ing['concentration']} | score={ing['score']}")
