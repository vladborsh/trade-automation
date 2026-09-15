# CHECKS — crypto extension

Produced by `crypto/checks_crypto.py`.

| check | symbol | condition | result | detail |
|---|---|---|---|---|
| C1 prefix-causality | BTCUSDT | win | PASS | 100 orders + 50 non-signal bars re-derived on a truncated tape; 0 differ |
| C2 invariants | BTCUSDT | win | PASS | 1,309 orders, 0 violations |
| C3 TS parity | BTCUSDT | win | PASS | 50 chunks, 131,648 evaluated bars (131,648 bit-exact), 1,309 TS orders vs 1,309 Python, 0 problems, missing chunks: 0 |
| C1 prefix-causality | BTCUSDT | all | PASS | 100 orders + 50 non-signal bars re-derived on a truncated tape; 0 differ |
| C2 invariants | BTCUSDT | all | PASS | 2,845 orders, 0 violations |
| C3 TS parity | BTCUSDT | all | PASS | 215 chunks, 2,164,320 evaluated bars (2,164,320 bit-exact), 2,845 TS orders vs 2,845 Python, 0 problems, missing chunks: 0 |
| C1 prefix-causality | ETHUSDT | win | PASS | 100 orders + 50 non-signal bars re-derived on a truncated tape; 0 differ |
| C2 invariants | ETHUSDT | win | PASS | 1,145 orders, 0 violations |
| C3 TS parity | ETHUSDT | win | PASS | 50 chunks, 131,648 evaluated bars (131,648 bit-exact), 1,145 TS orders vs 1,145 Python, 0 problems, missing chunks: 0 |
| C1 prefix-causality | ETHUSDT | all | PASS | 100 orders + 50 non-signal bars re-derived on a truncated tape; 0 differ |
| C2 invariants | ETHUSDT | all | PASS | 2,859 orders, 0 violations |
| C3 TS parity | ETHUSDT | all | PASS | 215 chunks, 2,164,320 evaluated bars (2,164,320 bit-exact), 2,859 TS orders vs 2,859 Python, 0 problems, missing chunks: 0 |

**Overall: ALL CHECKS PASS**
