import sys
import pandas as pd

sys.stdout.reconfigure(encoding='utf-8')

file = 'Calcul_Final_SCORING.xlsx'
df = pd.read_excel(file, sheet_name='Déodorants Chimiques')
df = df.fillna('')

print("=== DOVE UNILEVER rows in Déodorants Chimiques ===")
for i, row in df.iterrows():
    vals = [str(x).strip() for x in row.values]
    # Row contains DOVE
    if any('dove' in x.lower() for x in vals):
        print(f"Row {i:2d}: {vals}")
