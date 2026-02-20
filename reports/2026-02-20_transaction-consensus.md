# 事务一致性专题共识（UX / 架构 / 魔鬼代言人）

日期：2026-02-20
范围：`shadow-speaking/server/api/practice.ts` 完成链路

## 一、三方共识

1. 本轮交互升级已完成，下一阶段应聚焦“练习完成链路一致性”。
2. 核心链路应明确划分：
   - 强一致：`plan_items`、`daily_plans`、`practice_records`、`materials(spaced repetition)`。
   - 可异步：`streak`、`level progression`、录音上传与录音元数据。
3. 不建议一次性重构全链路；建议先做 MVP 一致性加固，再迭代增强（幂等 token / 轻量 schema 扩展）。

## 二、当前主要风险（收敛版）

1. 多步骤写入不是单事务，失败时可能出现“看似完成但记录缺失”。
2. 并发提交下，`completed_items` 与 `practice_records` 存在错配风险。
3. 回滚依赖 best-effort，遇到并发更新时可能回滚不完全。
4. 缺少一致性告警指标，出错时难以及时发现。

## 三、MVP 改造建议（先做）

1. 将 `handlePracticeComplete` 核心步骤强约束为“关键失败即失败返回”，并保留可异步步骤不阻断主链路。
2. 对关键 CAS 更新统一检查 `meta.changes` 并记录结构化错误日志（包含 userId/materialId/planItemId）。
3. 增加最小数据质量守卫：
   - 检查 `completed_items <= total_items`
   - 检查 `plan_item=completed` 时存在对应 `practice_record`
4. 前端失败反馈保持可重试（已具备），并在后端失败时统一返回机器可识别错误码。

## 四、增强版（第二阶段）

1. 引入幂等 `operationId`（请求级）防止重放与重复插入。
2. 评估轻量 schema 增强：
   - `practice_records.operation_id`
   - 或 `plan_items.last_attempt_token`
3. 增加后台巡检与告警：
   - `plan_item_completed_without_record`
   - `spaced_repetition_cas_retries_exhausted`
   - `practice_compensation_failed`

## 五、上线门槛（建议）

1. 并发同 plan_item 提交，仅允许 1 次成功写入。
2. 核心 4 表状态一致（plan item、plan 计数、record、material）可被自动化测试覆盖。
3. 类型检查与构建通过。
4. 关键错误具备结构化日志与告警指标。

