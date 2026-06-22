import json
db = json.load(open('database.json', 'r', encoding='utf-8'))
for i, p in enumerate(db['products']):
    print(f"{i}: {p['name']} | score={p['global_score']} | cat={p['category']}")
