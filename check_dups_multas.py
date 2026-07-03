import json
from collections import Counter
d = json.load(open('gastos.json', 'r', encoding='utf-8'))
multas = d.get('multas', [])
serializados = [f"{m['periodo']}_{m['uf']}_{m['propietario']}_{m['monto']}" for m in multas]
dups = [item for item, count in Counter(serializados).items() if count > 1]
print("=== MULTAS DUPLICADAS EN JSON ===")
for d in dups:
    print(d)
