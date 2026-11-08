# SP011: `conflict-sim`

Kết quả: Người dùng thấy hai session tranh chấp theo từng nhịp. PostgreSQL dùng 5 kịch bản giả lập, nhãn Mô phỏng, đối chiếu với Postgres thật trong CI. MySQL dùng hai connection thật, nhãn Thật.

## Story và Task

| Story | Task | Việc | Phụ thuộc | Đợt |
|---|---|---|---|---|
| STR048 Giả lập PostgreSQL | Task050 | Lõi giả lập 5 kịch bản | Không | 1 |
| STR049 Đối chiếu trong CI | Task051 | Golden test so với Postgres thật | Task050 | 2 |
| STR050 Tranh chấp MySQL | chưa chia | | SP004 STR019 | sau |
| STR051 Timeline | Task070 | | Task050 | 3 |
| STR052 Tiêu chí hỏng | Task079 | Tiêu chí hỏng tùy biến cho kịch bản | STR051 | 3 |

## Các file bị đụng

| Task | File |
|---|---|
| Task050 | `web/src/modules/conflict-sim/engine/**` |
| Task051 | `web/src/modules/conflict-sim/golden/**`, `.github/workflows/**` |
| Task070 | `web/src/modules/conflict-sim/ui/**`, `web/e2e/conflict-sim.spec.ts` |
| Task079 | `web/src/modules/conflict-sim/**`, `web/messages/*/conflictSim.json`, `web/e2e/**` |
