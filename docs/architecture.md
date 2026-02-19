# Shadow Speaking · 技术架构文档

> 版本：v2.0
> 更新日期：2026-02-18
> 关联文档：[requirements.md](./requirements.md) · [cost-breakdown.md](./cost-breakdown.md)

---

## 一、架构总览

全站部署在 Cloudflare 生态上，AI 能力统一调用 MiniMax API，零传统服务器。

```
┌─────────────────────────────────────────────────────────────────┐
│                          用户浏览器                              │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ Remix App │  │ MediaRecorder│  │ Web Audio API（静音检测）  │  │
│  │ (React)   │  │ （录音）     │  │                           │  │
│  └─────┬─────┘  └──────┬───────┘  └─────────────────────────┘  │
│        │               │                                        │
└────────┼───────────────┼────────────────────────────────────────┘
         │               │
         ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare 边缘网络                           │
│                                                                 │
│  ┌──────────────────────────────────────────────────────┐       │
│  │        Cloudflare Pages + Workers（Remix SSR）        │       │
│  │                                                      │       │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────┐ │       │
│  │  │ 页面路由    │  │ API 路由   │  │ Cron Trigger   │ │       │
│  │  │ SSR 渲染    │  │ /api/*     │  │ 每日计划生成    │ │       │
│  │  └────────────┘  └─────┬──────┘  └───────┬────────┘ │       │
│  │                        │                  │          │       │
│  └────────────────────────┼──────────────────┼──────────┘       │
│                           │                  │                  │
│     ┌─────────────────────┼──────────────────┼───────────┐      │
│     │                     ▼                  ▼           │      │
│     │  ┌──────┐    ┌──────────┐    ┌──────────────────┐  │      │
│     │  │  D1  │    │    R2    │    │   MiniMax API    │  │      │
│     │  │ 数据库│    │ 音频存储 │    │  TTS + LLM      │  │      │
│     │  │+认证  │    │          │    │                  │  │      │
│     │  └──────┘    └──────────┘    └──────────────────┘  │      │
│     │                                                    │      │
│     │  ┌──────┐                                          │      │
│     │  │  KV  │                                          │      │
│     │  │ 缓存  │                                          │      │
│     │  └──────┘                                          │      │
│     └────────────────────────────────────────────────────┘      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、技术选型

| 层级 | 选型 | 选择原因 |
|------|------|---------|
| **前端框架** | Remix + React | Cloudflare 一等公民支持，零配置部署到 Workers；基于 Web 标准 Fetch API；SSR 天然适配边缘渲染 |
| **样式方案** | Tailwind CSS | 原子化 CSS，零运行时开销，构建时生成 |
| **部署平台** | Cloudflare Pages | 前端静态资源 + Workers 函数一体化部署 |
| **数据库** | Cloudflare D1 | 边缘 SQLite，与 Workers 同网络零延迟；10 GB 上限足够单用户群体 |
| **音频存储** | Cloudflare R2 | 零出口流量费用（音频文件频繁读取，这一点至关重要）；与 Workers 原生集成 |
| **缓存** | Cloudflare KV | 高频读低频写场景（TTS 音频缓存索引、会话 token） |
| **TTS 语音合成** | MiniMax Speech-02-Turbo | 40 语种、100+ 音色、内置语速控制（0.5x-2.0x）、情感参数；输出 mp3/wav/flac |
| **LLM 文本处理** | MiniMax MiniMax-M2.5 | 材料预处理（释义、断句、难度评定等）；OpenAI SDK 兼容；$0.30/百万输入 token，成本极低 |
| **认证** | 自建账号密码 + Cookie Session | 单一账号密码登录，D1 存储用户凭证，Cookie 管理会话；零外部依赖，零额外费用 |
| **定时任务** | Workers Cron Triggers | 每日计划生成、预处理失败重试 |

---

## 三、MiniMax API 规格

统一使用 MiniMax 平台（api.minimax.io）提供 TTS 和 LLM 能力。

### 3.1 TTS — Speech-02-Turbo

| 参数 | 值 |
|------|------|
| 端点 | `POST https://api.minimax.io/v1/audio/synthesis` |
| 认证 | `Authorization: Bearer <MINIMAX_API_KEY>` |
| 输出格式 | mp3（默认）/ wav / flac |
| 采样率 | 8000-44100 Hz（默认 32000） |
| 语速控制 | 0.5x - 2.0x（通过 `speed` 参数） |
| 情感控制 | happy / sad / angry / neutral 等 7 种 |
| 音色 | 100+ 系统预置音色（通过 `voice_id` 指定） |
| 计费 | **~$0.025 / 千字符**（¥0.18/千字符，Turbo 套餐月包费率） |

**本项目 TTS 调用方式：**

每条语料生成 3 个语速版本的音频，通过 `speed` 参数控制：
- 慢速：speed = 0.75
- 常速：speed = 1.0
- 快速：speed = 1.25

音色固定选一个清晰的英文音色（如 `English_FriendlyPerson`），全局统一。

### 3.2 LLM — MiniMax-M2.5

| 参数 | 值 |
|------|------|
| 端点 | `POST https://api.minimax.io/v1/chat/completions`（OpenAI 兼容） |
| 认证 | `Authorization: Bearer <MINIMAX_API_KEY>` |
| 上下文窗口 | 196,608 tokens |
| 输入价格 | $0.30 / 百万 tokens |
| 输出价格 | $1.10 / 百万 tokens |
| 结构化输出 | 通过 function calling 实现 JSON 结构化返回 |

**本项目 LLM 调用方式：**

材料预处理时，一次 API 调用完成所有分析。通过 function calling 定义输出 schema，确保返回结构化 JSON：

```
输入：英文原句
输出：{
  level: 3,                           // 难度等级
  translation: "中文释义",             // 中文翻译
  phonetic_notes: [...],              // 连读/弱读/省音标注
  pause_marks: [3, 7],                // 断句位置（词索引）
  word_mask: [1, 2, 6],              // 遮盖词位置（实词索引）
  tags: ["工作", "会议"],             // 主题标签
  expression_prompt: "表达你对..."    // 自由表达提示
}
```

### 3.3 API Key 管理

只需 **一个 MiniMax API Key**，同时用于 TTS 和 LLM 调用。Key 通过 Cloudflare Workers Secret 存储，不进代码仓库。

---

## 四、Cloudflare 服务用量与限制

基于 Paid Plan（$5/月基础费用）。

### 4.1 Workers

| 指标 | 限制 | 本项目预估 |
|------|------|-----------|
| 请求数 | 10M/月含 | 1 万用户 × 日均 50 请求 = 15M/月（轻度超出） |
| CPU 时间 | 30 秒/请求 | 单次 API 请求 < 50ms CPU，充足 |
| Worker 包体积 | 10 MB（压缩后） | Remix 构建产物约 2-5 MB，充足 |
| 子请求数 | 10,000/请求 | 预处理流程调 MiniMax 4 次（1 LLM + 3 TTS），充足 |

### 4.2 D1

| 指标 | 限制 | 本项目预估 |
|------|------|-----------|
| 单库容量 | 10 GB | 1 万用户、每人 500 条语料、含元数据 ≈ 约 500 MB，充足 |
| 行读取 | 25B/月含 | 充足 |
| 行写入 | 50M/月含 | 1 万用户日均写入 20 行 = 6M/月，充足 |

### 4.3 R2

| 指标 | 限制/价格 | 本项目预估 |
|------|----------|-----------|
| 存储 | $0.015/GB·月 | 每条语料 3 个 TTS 音频（约 150 KB）+ 每次练习 7 段录音（约 280 KB）；万级用户初期约 50 GB |
| 读取 | 10M/月免费 | 每日练习读取 TTS 音频，约 5M/月，免费覆盖 |
| 写入 | 1M/月免费 | 录音上传，万级用户约 2M/月，轻度超出 |
| 出口流量 | **免费** | 选择 R2 的核心原因 |

---

## 五、认证方案

### 5.1 方案说明

采用最简单的账号密码认证，不依赖任何第三方认证服务。

- **注册**：用户提供用户名 + 密码，密码经哈希后存入 D1
- **登录**：验证用户名密码，成功后生成 Session Token 写入 Cookie
- **会话维持**：Cookie 中的 Session Token 在每次请求时由 Worker 验证
- **会话存储**：Session 数据存在 KV 中（key = token, value = user_id），设置过期时间

### 5.2 安全措施

| 措施 | 说明 |
|------|------|
| 密码哈希 | 使用 Web Crypto API 的 PBKDF2 算法，加盐哈希存储，不存明文 |
| Cookie 属性 | HttpOnly + Secure + SameSite=Lax，防止 XSS 和 CSRF |
| Session 过期 | 7 天有效期，每次活跃请求自动续期 |
| 登录限流 | 同一用户名 5 分钟内最多尝试 5 次，超出后锁定 15 分钟 |

### 5.3 涉及的数据

**KV 存储（会话）：**
- Key：Session Token（随机生成的 UUID）
- Value：`{ userId: "xxx", expiresAt: "..." }`
- TTL：7 天

**D1 存储（用户凭证）：** 见用户表设计（第七章）。

---

## 六、项目结构

```
shadow-speaking/
├── app/                          # Remix 应用
│   ├── routes/                   # 页面路由
│   │   ├── _index.tsx            # 首页重定向
│   │   ├── _app.tsx              # 主布局（Tab 导航 + 登录态校验）
│   │   ├── _app.today.tsx        # Tab 1：今日练习
│   │   ├── _app.today.$planItemId.tsx  # 练习详情（六阶段流程）
│   │   ├── _app.input.tsx        # Tab 2：添加素材
│   │   ├── _app.corpus.tsx       # Tab 3：我的语料
│   │   ├── _app.corpus.$id.tsx   # 语料详情
│   │   ├── _app.profile.tsx      # Tab 4：个人中心
│   │   ├── _app.settings.tsx     # 设置页
│   │   ├── login.tsx             # 登录页
│   │   ├── register.tsx          # 注册页
│   │   ├── onboarding.tsx        # 新用户引导
│   │   └── onboarding.test.tsx   # 水平测试
│   │
│   ├── components/               # UI 组件
│   │   ├── practice/             # 练习流程组件
│   │   │   ├── StageComprehension.tsx
│   │   │   ├── StageListening.tsx
│   │   │   ├── StageSyncReading.tsx
│   │   │   ├── StageShadowing.tsx
│   │   │   ├── StageReproduction.tsx
│   │   │   ├── StageFreeExpression.tsx
│   │   │   └── PracticeFlow.tsx      # 六阶段流程控制器
│   │   ├── audio/
│   │   │   ├── AudioPlayer.tsx       # 音频播放器
│   │   │   ├── AudioRecorder.tsx     # 录音组件
│   │   │   └── SilenceDetector.tsx   # 静音检测
│   │   ├── corpus/
│   │   │   ├── MaterialCard.tsx
│   │   │   └── CorpusList.tsx
│   │   └── ui/                       # 基础 UI 组件
│   │
│   ├── hooks/                    # React Hooks
│   │   ├── useAudioRecorder.ts   # 录音逻辑
│   │   ├── useAudioPlayer.ts     # 播放逻辑
│   │   ├── useSilenceDetection.ts# 静音检测逻辑
│   │   └── usePracticeFlow.ts    # 练习流程状态管理
│   │
│   ├── lib/                      # 共享工具
│   │   └── constants.ts          # 常量定义（等级、间隔天数等）
│   │
│   └── entry.server.tsx          # Remix 服务端入口
│
├── server/                       # 服务端逻辑（运行在 Workers 中）
│   ├── api/                      # API 路由处理
│   │   ├── auth.ts               # 注册/登录/登出
│   │   ├── materials.ts          # 语料 CRUD
│   │   ├── practice.ts           # 练习记录
│   │   ├── daily-plan.ts         # 每日计划
│   │   ├── recordings.ts         # 录音上传/读取
│   │   └── onboarding.ts         # 引导流程
│   │
│   ├── services/                 # 业务逻辑
│   │   ├── auth.ts               # 密码哈希、Session 管理
│   │   ├── minimax.ts            # MiniMax API 客户端（LLM + TTS 统一封装）
│   │   ├── preprocessor.ts       # 材料预处理（拆句、调 MiniMax 分析+生成音频）
│   │   ├── plan-generator.ts     # 每日计划编排算法
│   │   ├── spaced-repetition.ts  # 间隔复习算法
│   │   └── level-assessor.ts     # 难度评定
│   │
│   ├── db/                       # 数据库
│   │   ├── schema.sql            # D1 表结构
│   │   └── queries.ts            # 数据库查询函数
│   │
│   └── cron/                     # 定时任务
│       └── daily-plan.ts         # 凌晨生成每日计划
│
├── public/                       # 静态资源
│   └── audio/                    # 冷启动语料包的预置音频
│
├── wrangler.toml                 # Cloudflare 配置
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── docs/
    ├── requirements.md
    ├── architecture.md           # 本文档
    └── cost-breakdown.md
```

---

## 七、数据库设计（D1）

### 7.1 表结构

**users — 用户表**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| username | TEXT UNIQUE | 用户名（登录用） |
| password_hash | TEXT | PBKDF2 哈希后的密码 |
| password_salt | TEXT | 密码盐值 |
| level | INTEGER | 当前等级 1-5，默认 1 |
| daily_minutes | INTEGER | 每日练习时长（10/20/30），默认 20 |
| streak_days | INTEGER | 当前连续天数，默认 0 |
| max_streak_days | INTEGER | 历史最长连续天数，默认 0 |
| total_practice_days | INTEGER | 累计练习天数，默认 0 |
| last_practice_date | TEXT | 最后练习日期（YYYY-MM-DD） |
| onboarding_completed | INTEGER | 是否完成引导（0/1），默认 0 |
| created_at | TEXT | 创建时间 |

索引：
- `idx_users_username` ON (username) UNIQUE

---

**materials — 语料表**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| user_id | TEXT FK | 所属用户 |
| content | TEXT | 英文原文（单句） |
| source_type | TEXT | direct / note / scene / diary |
| level | INTEGER | 难度等级 1-5 |
| status | TEXT | unlearned / learning / mastered |
| tags | TEXT | 主题标签（JSON 数组） |
| translation | TEXT | 中文释义 |
| phonetic_notes | TEXT | 语音现象标注（JSON） |
| pause_marks | TEXT | 断句标记（JSON：位置索引数组） |
| word_mask | TEXT | 遮盖词位置（JSON：词索引数组，用于阶段四第 2 轮） |
| expression_prompt | TEXT | 自由表达提示语 |
| audio_slow_key | TEXT | R2 慢速音频 key |
| audio_normal_key | TEXT | R2 常速音频 key |
| audio_fast_key | TEXT | R2 快速音频 key |
| review_count | INTEGER | 已复习次数 |
| next_review_date | TEXT | 下次复习日期（YYYY-MM-DD） |
| last_practice_date | TEXT | 最后练习日期 |
| preprocess_status | TEXT | pending / processing / done / failed |
| created_at | TEXT | 入库时间 |

索引：
- `idx_materials_user_status` ON (user_id, status)
- `idx_materials_user_review` ON (user_id, next_review_date)
- `idx_materials_user_level` ON (user_id, level)
- `idx_materials_user_content` ON (user_id, content)  — 去重查询用

---

**daily_plans — 每日计划表**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| user_id | TEXT FK | 所属用户 |
| plan_date | TEXT | 计划日期（YYYY-MM-DD） |
| total_items | INTEGER | 计划总条数 |
| completed_items | INTEGER | 已完成条数 |
| created_at | TEXT | 生成时间 |

索引：
- `idx_plans_user_date` ON (user_id, plan_date) UNIQUE

---

**plan_items — 计划条目表**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| plan_id | TEXT FK | 所属计划 |
| material_id | TEXT FK | 关联语料 |
| item_order | INTEGER | 排列顺序 |
| item_type | TEXT | new / review |
| status | TEXT | pending / in_progress / completed / skipped |
| started_at | TEXT | 开始练习时间 |
| completed_at | TEXT | 完成时间 |

---

**practice_records — 练习记录表**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| user_id | TEXT FK | 用户 |
| material_id | TEXT FK | 语料 |
| plan_item_id | TEXT FK | 关联计划条目（可为空） |
| completed_all_stages | INTEGER | 是否完成全部六阶段（0/1） |
| self_rating | TEXT | good / fair / poor（阶段五自评） |
| is_poor_performance | INTEGER | 是否判定为表现不佳（0/1） |
| duration_seconds | INTEGER | 本次练习总时长（秒） |
| created_at | TEXT | 练习时间 |

---

**recordings — 录音记录表**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| practice_record_id | TEXT FK | 关联练习记录 |
| material_id | TEXT FK | 关联语料 |
| stage | INTEGER | 阶段编号（3/4/5/6） |
| round | INTEGER | 轮次（阶段四有 1/2/3 轮，其余为 1） |
| r2_key | TEXT | R2 存储 key |
| duration_ms | INTEGER | 录音时长（毫秒） |
| is_silent | INTEGER | 是否静音（0/1） |
| created_at | TEXT | 录音时间 |

索引：
- `idx_recordings_material` ON (material_id, created_at)

---

### 7.2 容量估算

| 数据项 | 单条大小 | 1 万用户 × 500 条语料 | 说明 |
|-------|---------|---------------------|------|
| users | ~300 B | ~3 MB | 用户量级小 |
| materials | ~2 KB | ~10 GB | 含 JSON 字段，接近 D1 单库上限 |
| practice_records | ~200 B | ~1 GB | 每条语料平均 10 次练习 |
| recordings（元数据） | ~150 B | ~3.5 GB | 每次练习 7 条 |
| daily_plans + plan_items | ~100 B | ~0.5 GB | 每日每用户 10 条 |

**达到 1 万用户规模时需要考虑分库策略。** MVP 阶段（千级用户）完全无压力。

---

## 八、核心业务流程实现

### 8.1 材料预处理流程

用户提交文本后触发的后台处理链：

```
用户提交英文文本
       │
       ▼
  ① Worker 接收请求
       │
       ▼
  ② 语言检测（本地正则 + 字符判断，无需外部 API）
       │ 非英文 → 返回错误
       ▼
  ③ 拆句（本地逻辑：按 .!? 拆分，处理缩写和特殊情况）
       │
       ▼
  ④ 去重（D1 查询：SELECT id FROM materials WHERE user_id=? AND content=?）
       │ 已存在 → 跳过该句
       ▼
  ⑤ 写入 D1（status=unlearned, preprocess_status=pending）
       │
       ▼
  ⑥ 返回响应给用户（"已添加 N 条，正在处理中"）
       │
       ▼
  ⑦ 异步预处理（通过 waitUntil 在后台执行）
       │
       ├─→ 调用 MiniMax LLM（MiniMax-M2.5，单次请求）
       │    通过 function calling 返回结构化 JSON：
       │    {
       │      level: 3,
       │      translation: "中文释义",
       │      phonetic_notes: [...],
       │      pause_marks: [...],
       │      word_mask: [...],
       │      tags: [...],
       │      expression_prompt: "..."
       │    }
       │
       ├─→ 调用 MiniMax TTS（Speech-02-Turbo）生成 3 个语速版本
       │    ├─ speed=0.75（慢速）→ 上传 R2
       │    ├─ speed=1.0 （常速）→ 上传 R2
       │    └─ speed=1.25（快速）→ 上传 R2
       │
       └─→ 更新 D1（填入分析结果 + 音频 R2 key，preprocess_status=done）
```

**失败处理：** 如果 MiniMax API 调用失败，材料保留 `preprocess_status=failed`，Cron 任务每小时扫描失败记录重试，最多重试 3 次。

### 8.2 每日计划生成

由 Cron Trigger 在凌晨 4:00（用户时区）触发，或由用户手动触发。

```
输入：user_id
       │
       ▼
  ① 查询用户档案：level, daily_minutes
       │
       ▼
  ② 计算计划总条数：daily_minutes / 2
       │
       ▼
  ③ 查询到期复习材料：
     SELECT * FROM materials
     WHERE user_id = ?
       AND status = 'learning'
       AND next_review_date <= DATE('now')
       AND preprocess_status = 'done'
     ORDER BY next_review_date ASC
       │
       ▼
  ④ 填入全部复习材料（即使超出总条数）
       │
       ▼
  ⑤ 计算新材料名额 = MAX(0, 总条数 - 复习条数)
       │
       ▼
  ⑥ 查询新材料：
     SELECT * FROM materials
     WHERE user_id = ?
       AND status = 'unlearned'
       AND level <= (user_level + 1)
       AND preprocess_status = 'done'
     ORDER BY created_at DESC
     LIMIT ?
       │
       ▼
  ⑦ 排序：复习（按难度升序）在前，新材料（同主题聚合，难度升序）在后
       │
       ▼
  ⑧ 写入 daily_plans + plan_items
```

### 8.3 录音上传流程

```
用户完成一段跟读（浏览器端）
       │
       ▼
  ① MediaRecorder 停止录音，得到 Blob（WebM/Opus 格式）
       │
       ▼
  ② 客户端静音检测（Web Audio API 分析录音音量均值）
       │ 静音 → 不上传，提示用户重新录音
       ▼
  ③ 构造 FormData，POST 到 /api/recordings
       │
       ▼
  ④ Worker 接收：
     ├─ 生成 R2 key：recordings/{user_id}/{material_id}/{timestamp}.webm
     ├─ 上传到 R2
     ├─ 写入 recordings 表（元数据）
     └─ 返回 recording_id
```

### 8.4 间隔复习计算

```
材料完成一次练习后：
       │
       ▼
  判断 is_poor_performance
       │
       ├─ true：
       │    review_count = 0
       │    next_review_date = 明天
       │    status 保持 learning
       │
       └─ false：
            review_count += 1
            │
            ├─ review_count == 1 → next_review_date = +1天
            ├─ review_count == 2 → next_review_date = +2天
            ├─ review_count == 3 → next_review_date = +4天
            ├─ review_count == 4 → next_review_date = +7天
            ├─ review_count == 5 → next_review_date = +16天
            ├─ review_count == 6 → next_review_date = +30天
            └─ review_count >= 7 → next_review_date = +60天
            │
            └─ 如果 review_count >= 3
               且 self_rating != 'poor'
               且已完成完整六阶段至少 1 次
               → status = 'mastered'
```

### 8.5 等级进阶计算

每次练习完成后触发检查：

```
  ① 查询：当前等级已掌握材料数
     SELECT COUNT(*) FROM materials
     WHERE user_id = ? AND level = ? AND status = 'mastered'
       │
       ▼ >= 20
  ② 查询：最近 7 天完成率
     SELECT plan_date, completed_items, total_items
     FROM daily_plans
     WHERE user_id = ? AND plan_date >= DATE('now', '-7 days')
       │
       ▼ 平均完成率 > 80%
  ③ 标记用户为"进阶观察期"
     → 每日计划开始混入 20% 的 level+1 材料
       │
       ▼ 连续 5 天高等级材料完成率 > 70%
  ④ 正式升级：user.level += 1
```

---

## 九、API 路由设计

所有 API 路由为 Remix 的 Resource Routes，运行在 Workers 中。

### 9.1 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/register | 注册（username + password） |
| POST | /api/auth/login | 登录（返回 Set-Cookie） |
| POST | /api/auth/logout | 登出（清除 Cookie + 删除 KV Session） |

### 9.2 语料相关

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/materials | 提交文本，触发预处理 |
| GET | /api/materials | 查询语料列表（分页 + 筛选） |
| GET | /api/materials/:id | 查询语料详情 |
| DELETE | /api/materials/:id | 删除语料 |
| PATCH | /api/materials/:id/tags | 更新标签 |

### 9.3 每日计划

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/plan/today | 获取今日计划 |
| POST | /api/plan/regenerate | 手动重新生成今日计划 |
| PATCH | /api/plan/items/:id | 更新计划条目状态 |

### 9.4 练习与录音

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/practice/start | 开始一条材料的练习 |
| POST | /api/practice/:id/complete | 完成练习（含自评、触发间隔更新） |
| POST | /api/recordings | 上传录音文件 |
| GET | /api/recordings/:materialId | 获取某条语料的历史录音列表 |

### 9.5 用户

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/user/profile | 获取用户档案 |
| PATCH | /api/user/settings | 更新设置 |
| GET | /api/user/stats | 获取进度统计数据 |
| POST | /api/user/level-test | 提交水平测试结果 |

### 9.6 音频

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/audio/:key | 从 R2 读取并返回音频文件（TTS 或录音） |

---

## 十、前端关键实现

### 10.1 录音能力

基于浏览器 MediaRecorder API：

**录音格式：** WebM + Opus 编码（Chrome/Firefox/Safari 均支持）。

**静音检测方案：**
- 录音同时通过 Web Audio API 的 AnalyserNode 采集实时音量
- 以固定间隔（100ms）采样振幅数据
- 录音结束后计算：有效发声时段（振幅 > 阈值）的总时长
- 如果有效发声时长 < 总时长的 10%，判定为静音

**连续静音检测（阶段四回退用）：**
- 实时监测振幅
- 连续 3 秒振幅低于阈值 → 记录为"卡顿"
- 录音结束后通知练习流程控制器

### 10.2 音频播放

**多语速播放：**
- 慢速、常速、快速使用三份不同的 TTS 音频文件（MiniMax 在生成时已通过 speed 参数控制语速）
- 不依赖客户端变速，音质更好

**播放控制：**
- 使用 HTML5 Audio API
- 支持：播放、暂停、重放
- 播放进度条
- 已播放次数计数器

### 10.3 六阶段练习流程控制

练习流程是一个客户端状态机：

```
状态定义：
  currentStage: 1 | 2 | 3 | 4 | 5 | 6
  currentRound: number（阶段三有 2 轮，阶段四有 3 轮）
  stageStatus: idle | playing | recording | reviewing | completed
  recordings: Map<string, Blob>  // 本轮录音暂存

状态转移（简化）：
  Stage1.confirmed      → Stage2
  Stage2.ready          → Stage3
  Stage3.round2.done    → Stage4
  Stage4.round3.done    → Stage5   （或回退到 Stage4.round2）
  Stage5.rated          → Stage6
  Stage6.recorded       → Complete
```

每个阶段是一个独立的 React 组件，由 PracticeFlow 控制器根据当前状态渲染对应组件。

### 10.4 离线策略（P0 简化版）

MVP 阶段不做完整的离线支持，但做以下基础保障：

- TTS 音频在每日计划生成后预加载到浏览器缓存（Service Worker 缓存策略）
- 练习过程中如果网络断开，录音暂存在本地 IndexedDB，恢复网络后自动上传
- 语料库浏览支持离线查看（D1 查询结果缓存在 Service Worker 中）

---

## 十一、Cloudflare 配置

### 11.1 wrangler.toml 核心配置

```toml
name = "shadow-speaking"
compatibility_date = "2026-02-01"

# Pages + Workers 集成部署
pages_build_output_dir = "./build/client"

# D1 数据库
[[d1_databases]]
binding = "DB"
database_name = "shadow-speaking-db"
database_id = "<database-id>"

# R2 存储桶
[[r2_buckets]]
binding = "R2"
bucket_name = "shadow-speaking-audio"

# KV 命名空间（会话存储）
[[kv_namespaces]]
binding = "KV"
id = "<kv-namespace-id>"

# 定时任务
[triggers]
crons = ["0 20 * * *"]  # UTC 20:00 = 北京时间 04:00

# 环境变量（MINIMAX_API_KEY 通过 wrangler secret put 设置，不写在此文件中）
```

### 11.2 Secrets（敏感配置）

通过 `wrangler secret put` 设置，不进代码仓库：

| Secret 名称 | 说明 |
|------------|------|
| MINIMAX_API_KEY | MiniMax 平台 API Key，用于 TTS 和 LLM 调用 |

### 11.3 自定义域名

- 主站：`shadowspeaking.com` → Cloudflare Pages
- 音频 CDN：`audio.shadowspeaking.com` → R2 Bucket 自定义域名

### 11.4 部署流程

```
本地开发                   部署
   │                       │
   ▼                       ▼
npm run dev              git push main
（wrangler pages dev）    → Cloudflare Pages 自动构建部署
                          → Workers + D1 + R2 + KV 绑定自动生效
```

---

## 十二、关键依赖

| 依赖 | 用途 | 说明 |
|------|------|------|
| @remix-run/cloudflare | Remix Cloudflare 适配 | 核心框架 |
| openai | MiniMax API 客户端 | MiniMax 兼容 OpenAI SDK，设置 baseURL 即可 |
| tailwindcss | 样式 | 构建时生成 |
| drizzle-orm | D1 ORM | 类型安全的数据库查询，原生支持 D1 |
| uuid | ID 生成 | 语料/录音等实体 ID |

注意：MiniMax API 兼容 OpenAI SDK 协议，只需将 `baseURL` 设为 `https://api.minimax.io/v1`，无需额外安装 MiniMax 专用 SDK。

---

## 十三、MVP 研发分期

### Phase 1 — 基础骨架（约 1 周）

- [ ] 项目初始化：Remix + Cloudflare Pages + Tailwind
- [ ] D1 数据库建表 + Drizzle ORM 配置
- [ ] 自建认证：注册/登录页面 + 密码哈希 + Cookie Session + KV 会话
- [ ] R2 存储桶创建 + 音频上传/读取 API
- [ ] 四个 Tab 页面骨架 + 路由 + 登录态校验

### Phase 2 — 内容输入与预处理（约 1 周）

- [ ] 文本输入页面
- [ ] 拆句 + 语言检测 + 去重逻辑
- [ ] MiniMax LLM 调用：难度评定、释义、断句、标注、提示语（单次 function calling）
- [ ] MiniMax TTS 调用：三个语速版本音频生成 + 上传 R2
- [ ] 预处理结果预览确认页面
- [ ] 预处理失败重试（Cron 扫描）

### Phase 3 — 六阶段练习流程（约 2 周）

- [ ] 音频播放组件（多语速切换）
- [ ] 录音组件（MediaRecorder + 上传 R2）
- [ ] 静音检测组件（Web Audio API AnalyserNode）
- [ ] 阶段一：理解（文本+释义展示，复习简化模式）
- [ ] 阶段二：精听（播放+计数+轻提示）
- [ ] 阶段三：同步跟读（慢速/常速两轮 + 录音 + 回放）
- [ ] 阶段四：影子跟读（韵律→部分遮盖→无文本，三轮 + 回退机制）
- [ ] 阶段五：脱稿复述（中文提示→录音→原文对照→自评）
- [ ] 阶段六：自由表达（提示→录音→完成）
- [ ] PracticeFlow 状态机控制器
- [ ] 练习完成后数据写入（practice_records, recordings, 状态更新）

### Phase 4 — 每日计划与复习系统（约 1 周）

- [ ] 间隔复习算法实现
- [ ] 每日计划生成算法
- [ ] Cron Trigger 配置（凌晨自动生成）
- [ ] 手动刷新计划（每日限 3 次）
- [ ] 今日练习列表页面
- [ ] 今日小结页面
- [ ] 计划为空时的引导

### Phase 5 — 用户系统与进度（约 1 周）

- [ ] 水平测试流程
- [ ] 新用户引导完整流程（6 步）
- [ ] 冷启动语料包（4 个主题，预置数据）
- [ ] 等级进阶/回退逻辑
- [ ] 进度统计页面（打卡日历、语料库统计、等级进度）
- [ ] 设置页面

### Phase 6 — 打磨与部署（约 1 周）

- [ ] 语料库管理页面（搜索、列表、详情、历史录音）
- [ ] 移动端适配（响应式布局）
- [ ] Service Worker 音频预缓存
- [ ] 录音断网暂存 + 恢复上传
- [ ] 自定义域名配置
- [ ] 生产环境部署验证
