import json
d = json.load(open('gastos.json', 'r', encoding='utf-8'))
multas = d.get('multas', [])
print(f"Total multas: {len(multas)}")
for m in multas[:15]:
    print(m)
