import sys
import json
from app import calculate_ingredient_scoring

sys.stdout.reconfigure(encoding='utf-8')

db = json.load(open('database.json', 'r', encoding='utf-8'))
caud = next(p for p in db['products'] if 'CAUDALIE' in p['name'])

print(f"Caudalie name: {caud['name']}")
print(f"Caudalie global_score in DB: {caud['global_score']}")
total_score = 0
count = len(caud['ingredients'])
for ing in caud['ingredients']:
    s = ing.get('score', 'N/D')
    if s != 'N/D' and s is not None:
        total_score += float(s)
    print(f"  - {ing['inci']}: conc={ing['concentration']}, score={s}")

print(f"Recalculated from DB scores: {total_score} / {count} = {total_score/count:.4f}")

# Recalculated from master list
print("\nRecalculating from master ingredients list:")
master_ingredients = db['ingredients']
total_scratch = 0
for ing in caud['ingredients']:
    calc = calculate_ingredient_scoring(ing['inci'], ing['concentration'], master_ingredients)
    s = calc['score']
    if s != 'N/D' and s is not None:
        total_scratch += float(s)
    print(f"  - {ing['inci']}: conc={ing['concentration']}, score={s}")
print(f"Recalculated from scratch: {total_scratch} / {count} = {total_scratch/count:.4f}")
