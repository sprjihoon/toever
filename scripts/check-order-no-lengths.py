import sqlite3
from collections import Counter

db = sqlite3.connect(r'C:/Users/one/Documents/SpringToeverOps/database/toever_ops.db')
rows = db.execute('SELECT toever_order_no FROM order_header').fetchall()
lengths = Counter(len(r[0]) for r in rows)
print('총 주문 수:', len(rows))
print('길이별 분포:', dict(sorted(lengths.items())))

print('\n샘플 (각 길이별 최대 5개):')
seen = {}
for (o,) in rows:
    l = len(o)
    seen.setdefault(l, [])
    if len(seen[l]) < 5:
        seen[l].append(o)
for l in sorted(seen):
    print(f'  길이 {l}:', seen[l])

print('\n_gift 포함 주문:', [o for (o,) in rows if 'gift' in o.lower()][:20])
