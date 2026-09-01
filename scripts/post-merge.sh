#!/bin/bash
set -e
pnpm install --no-frozen-lockfile
# pgvector must exist before Drizzle evaluates the vector(1536) column.
pnpm --filter @workspace/db run enable:vector
pnpm --filter @workspace/db run push-force
# 財務/錢包模組的冪等遷移（建表、欄位、partial unique index、成本回填）
pnpm --filter @workspace/db run migrate:finance-wallet
# ERP 進銷存 + 分倉庫存的冪等遷移（建表、欄位、預設倉、分倉數量回填校正）
pnpm --filter @workspace/db run migrate:erp-inventory
