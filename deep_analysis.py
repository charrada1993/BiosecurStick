import json, sys
sys.stdout.reconfigure(encoding='utf-8')

db = json.load(open('database.json', 'r', encoding='utf-8'))
products = db['products']

# DOVE detailed analysis
dove = next(p for p in products if 'DOVE' in p['name'])
print("=== DOVE UNILEVER - Analyse Complète ===")
print(f"Global score: {dove['global_score']}")
total = 0
count = len(dove['ingredients'])
valid_scores = []
for ing in dove['ingredients']:
    s = ing.get('score', 'N/D')
    if s != 'N/D' and s is not None:
        total += float(s)
        valid_scores.append((ing['inci'], float(s)))
    print(f"  {ing['inci']}: conc={ing['concentration']}, D={ing.get('d')}, E={ing.get('e')}, NOAEL={ing.get('noael')}, MS={ing.get('ms')}, score={s}")
print(f"\nTotal scores: {total:.4f} / {count} = {total/count:.4f}")
print(f"Score max (Aluminum Sesquichlorohydrate): ", end="")
for inci, s in valid_scores:
    if s > 1:
        print(f"{inci} = {s}")

print("\n\n=== GREEN YOUTH - Analyse Complète ===")
gy = next(p for p in products if 'GREEN YOUTH' in p['name'])
print(f"Global score: {gy['global_score']}")
total = 0
count = len(gy['ingredients'])
for ing in gy['ingredients']:
    s = ing.get('score', 'N/D')
    if s != 'N/D' and s is not None:
        total += float(s)
    print(f"  {ing['inci']}: conc={ing['concentration']}, D={ing.get('d')}, NOAEL={ing.get('noael')}, MS={ing.get('ms')}, score={s}")
print(f"Recalcul: {total:.4f} / {count} = {total/count:.4f}")

print("\n\n=== TRESORS NATURELS - Analyse Complète ===")
tn = next(p for p in products if 'SORS' in p['name'] or 'ESORS' in p['name'])
print(f"Global score: {tn['global_score']}")
total = 0
count = len(tn['ingredients'])
for ing in tn['ingredients']:
    s = ing.get('score', 'N/D')
    if s != 'N/D' and s is not None:
        total += float(s)
    print(f"  {ing['inci']}: conc={ing['concentration']}, D={ing.get('d')}, NOAEL={ing.get('noael')}, MS={ing.get('ms')}, score={s}")
print(f"Recalcul: {total:.4f} / {count} = {total/count:.4f}")
