import json
d = json.load(open('gastos.json', 'r', encoding='utf-8'))
gastos = d.get('gastos', [])
print("=== GASTOS CONTENIENDO 'MULTA' O 'SUM' ===")
for g in gastos:
    c = g['concepto'].lower()
    if 'multa' in c or 'sum' in c:
        print(f"Período: {g['periodo']} | Concepto: {g['concepto']} | Monto: {g['monto']}")
