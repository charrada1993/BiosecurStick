import sys
import pandas as pd

sys.stdout.reconfigure(encoding='utf-8')

def scan_file(filename):
    print(f"\nScanning products in: {filename}")
    df = pd.read_excel(filename, sheet_name='Ingrédients Déodorants')
    df = df.fillna('')
    products = set()
    # Let's inspect column 1 (usually brand or product name)
    # Print non-empty values that might look like product names
    for i, row in df.iterrows():
        vals = [str(x).strip() for x in row.values if str(x).strip() != '']
        if vals:
            # Print row if it looks like a product header
            print(f"Row {i}: {vals[:4]}")

scan_file('Analyse_Ingredients_Deodorants_Chimiques (1) (1).xlsx')
scan_file('Analyse_Ingredients_Deodorants_Naturels (1) (1).xlsx')
