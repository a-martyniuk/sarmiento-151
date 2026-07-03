import json
d = json.load(open('gastos.json', 'r', encoding='utf-8'))
multas = d.get('multas', [])
may_multas = [m for m in multas if m['periodo'] == '2026-05']
print(f"Multas en 2026-05 (Total: {len(may_multas)}):")
for m in may_multas:
    print(m)
