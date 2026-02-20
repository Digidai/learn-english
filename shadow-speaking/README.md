# Shadow Speaking

**Shadow Speaking** is a web application for practicing English speaking using the **shadow reading** (shadowing) method. It provides a structured 6-stage practice flow, spaced repetition scheduling, and AI-powered content analysis.

**Shadow Speaking** 是一款基于**影子跟读法**的英语口语练习 Web 应用。提供 6 阶段结构化练习流程、间隔重复复习调度，以及 AI 驱动的语料分析。

---

## Features / 功能特性

### Core Practice Flow / 核心练习流程

- **Stage 1 - Comprehension / 理解**: Read the sentence with translation and phonetic notes
- **Stage 2 - Listening / 精听**: Listen to native audio, focus on rhythm and intonation
- **Stage 3 - Sync Reading / 同步跟读**: Read along with slow and normal speed audio (2 rounds)
- **Stage 4 - Shadowing / 影子跟读**: Progressive text masking across 3 rounds (full text -> partial mask -> no text)
- **Stage 5 - Reproduction / 脱稿复述**: Recall and speak from Chinese translation only, then self-rate
- **Stage 6 - Free Expression / 自由表达**: Express similar ideas in your own words

### Smart Features / 智能功能

- **AI Content Analysis / AI 语料分析**: Automatic difficulty grading (L1-L5), translation, phonetic notes, word masking via MiniMax LLM
- **TTS Audio Generation / TTS 音频生成**: 3 speed variants (0.75x slow, 1.0x normal, 1.25x fast) via MiniMax Speech API
- **Spaced Repetition / 间隔重复**: Review intervals of 1, 2, 4, 7, 16, 30, 60 days with mastery detection
- **Daily Plan Generation / 每日计划**: Auto-generated practice plans prioritizing due reviews, with cron-based scheduling
- **Level Progression / 等级进阶**: Automatic level assessment with upgrade conditions and protection against regression
- **Silence Detection / 静音检测**: Web Audio API-based silence detection during recording with fallback suggestions

### User Experience / 用户体验

- **Onboarding / 新手引导**: 5-step guided setup (welcome -> level -> duration -> cold-start packs -> complete)
- **Cold Start Packs / 冷启动语料包**: 4 topic packs (daily conversation, business, travel, self-introduction) with 42 pre-built sentences
- **Corpus Management / 语料库管理**: Search, filter by status/level, pagination, detail view with recording history
- **Profile Dashboard / 个人中心**: Practice calendar heatmap, streak tracking, corpus stats, level progress

---

## Tech Stack / 技术栈

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19 + React Router 7 + Tailwind CSS 4 |
| **Runtime** | Cloudflare Workers |
| **Database** | Cloudflare D1 (SQLite) |
| **Storage** | Cloudflare R2 (audio files) |
| **Cache** | Cloudflare KV (sessions) |
| **AI / TTS** | MiniMax API (MiniMax-M2.5 LLM + Speech-02-Turbo TTS) |
| **Auth** | PBKDF2 + Cookie Session + KV |
| **Build** | Vite 7 |
| **Language** | TypeScript |

---

## Project Structure / 项目结构

```
shadow-speaking/
├── app/
│   ├── routes/                    # Page routes
│   │   ├── login.tsx              # Login page / 登录
│   │   ├── register.tsx           # Registration / 注册
│   │   ├── onboarding.tsx         # Onboarding flow / 新手引导
│   │   ├── _app.tsx               # Authenticated layout + tab nav
│   │   ├── _app.today.tsx         # Daily practice plan / 今日练习
│   │   ├── _app.today.$planItemId.tsx  # Practice session / 练习页
│   │   ├── _app.input.tsx         # Add materials / 添加素材
│   │   ├── _app.corpus.tsx        # Corpus list / 语料库
│   │   ├── _app.corpus.$id.tsx    # Corpus detail / 语料详情
│   │   ├── _app.profile.tsx       # User profile / 个人中心
│   │   ├── _app.settings.tsx      # Settings / 设置
│   │   ├── api.audio.tsx          # Audio streaming API
│   │   ├── api.retry-preprocess.tsx # Admin API: retry preprocess
│   │   └── api.integrity-check.tsx  # Admin API: integrity audit
│   ├── components/
│   │   ├── practice/              # 6 stage components + PracticeFlow controller
│   │   └── audio/                 # AudioPlayer + AudioRecorder
│   ├── hooks/                     # useAudioPlayer, useAudioRecorder, usePracticeFlow, useSilenceDetection
│   └── lib/
│       ├── constants.ts           # App constants
│       └── auth.server.ts         # Auth middleware
├── server/
│   ├── services/
│   │   ├── auth.ts                # PBKDF2 hashing, session management, rate limiting
│   │   ├── minimax.ts             # MiniMax LLM + TTS integration
│   │   ├── preprocessor.ts        # Language detection, sentence splitting
│   │   ├── spaced-repetition.ts   # Review scheduling algorithm
│   │   ├── plan-generator.ts      # Daily plan generation
│   │   ├── level-assessor.ts      # Level progression logic
│   │   ├── data-integrity.ts      # Practice data integrity audit
│   │   └── cold-start.ts          # Cold start sentence packs
│   ├── db/
│   │   ├── schema.sql             # D1 database schema (6 tables)
│   │   └── queries.ts             # Database query functions
│   ├── api/
│   │   └── practice.ts            # Practice completion handler
│   └── cron/
│       └── daily-plan.ts          # Cron job for daily plan generation
├── workers/
│   └── app.ts                     # Worker entry (fetch + scheduled handlers)
├── wrangler.jsonc                 # Cloudflare configuration
└── package.json
```

---

## Prerequisites / 前提条件

- **Node.js** >= 18
- **npm** >= 9
- **Wrangler CLI**: `npm install -g wrangler`
- **Cloudflare Account** with Workers, D1, R2, KV enabled
- **MiniMax API Key** from [minimax.io](https://www.minimax.io)

---

## Setup & Deployment / 安装与部署

### 1. Clone and Install / 克隆与安装

```bash
cd shadow-speaking
npm install
```

### 2. Create Cloudflare Resources / 创建 Cloudflare 资源

```bash
# Login to Cloudflare / 登录 Cloudflare
wrangler login

# Create D1 database / 创建 D1 数据库
wrangler d1 create shadow-speaking-db
# Copy the database_id to wrangler.jsonc
# 将 database_id 复制到 wrangler.jsonc

# Create KV namespace / 创建 KV 命名空间
wrangler kv namespace create KV
# Copy the id to wrangler.jsonc
# 将 id 复制到 wrangler.jsonc

# Create R2 bucket / 创建 R2 存储桶
wrangler r2 bucket create shadow-speaking-audio
```

### 3. Update Configuration / 更新配置

Edit `wrangler.jsonc` and replace the placeholder IDs:

编辑 `wrangler.jsonc`，替换占位符 ID：

```jsonc
{
  "d1_databases": [{
    "binding": "DB",
    "database_name": "shadow-speaking-db",
    "database_id": "<your-d1-database-id>"
  }],
  "kv_namespaces": [{
    "binding": "KV",
    "id": "<your-kv-namespace-id>"
  }]
}
```

### 4. Initialize Database / 初始化数据库

```bash
# Apply schema to remote D1 / 应用 schema 到远程 D1
wrangler d1 execute shadow-speaking-db --remote --file=server/db/schema.sql

# For local development / 本地开发用
wrangler d1 execute shadow-speaking-db --local --file=server/db/schema.sql
```

### 5. Set Secrets / 设置密钥

```bash
# Set MiniMax API key / 设置 MiniMax API 密钥
wrangler secret put MINIMAX_API_KEY
# Enter your API key when prompted / 按提示输入 API 密钥

# Set admin whitelist for admin APIs (comma-separated usernames)
# 设置管理员接口白名单（逗号分隔的用户名）
wrangler secret put RETRY_PREPROCESS_ADMIN_USERS
# Example input: dai,alice,bob
# 示例输入：dai,alice,bob
```

### 6. Local Development / 本地开发

```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

应用将在 `http://localhost:5173` 启动。

For local development, the D1/R2/KV bindings are automatically simulated by Wrangler.

本地开发时，D1/R2/KV 绑定由 Wrangler 自动模拟。

### 7. Deploy / 部署

```bash
npm run deploy
```

This builds the project and deploys to Cloudflare Workers.

构建项目并部署到 Cloudflare Workers。

### 8. Verify Cron / 验证定时任务

The cron trigger runs at **UTC 20:00 daily** (Beijing 04:00) to generate daily practice plans and recover stale preprocessing jobs.

定时任务每天 **UTC 20:00**（北京时间 04:00）运行，生成当日练习计划并恢复卡住的预处理任务。

### 9. Admin API: Retry Preprocess / 管理员接口：重试预处理

- Endpoint: `POST /api/retry-preprocess`
- Auth: must be logged in and username must be in `RETRY_PREPROCESS_ADMIN_USERS`
- Scope: retries up to 30 materials with `preprocess_status = 'pending'` (failed materials are reset to pending first)

- 接口：`POST /api/retry-preprocess`
- 鉴权：必须先登录，且用户名在 `RETRY_PREPROCESS_ADMIN_USERS` 白名单内
- 范围：单次最多重试 30 条 `preprocess_status = 'pending'` 的语料（会先把 `failed` 重置为 `pending`）

### 10. Admin API: Integrity Check / 管理员接口：数据一致性巡检

- Endpoint: `POST /api/integrity-check`
- Auth: must be logged in and username must be in `RETRY_PREPROCESS_ADMIN_USERS`
- Scope: returns integrity issues for practice-related tables (`daily_plans`, `plan_items`, `practice_records`), including duplicate `operation_id`
- Output: `{ checkedAt, issueCount, issues }`

- 接口：`POST /api/integrity-check`
- 鉴权：必须先登录，且用户名在 `RETRY_PREPROCESS_ADMIN_USERS` 白名单内
- 范围：巡检练习相关表（`daily_plans`、`plan_items`、`practice_records`）的一致性问题，包含重复 `operation_id`
- 输出：`{ checkedAt, issueCount, issues }`

---

## Development Commands / 开发命令

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server / 启动开发服务器 |
| `npm run build` | Build for production / 生产构建 |
| `npm run deploy` | Build + deploy to Cloudflare / 构建并部署 |
| `npm run preview` | Preview production build locally / 本地预览生产构建 |
| `npm run typecheck` | Run type checking / 类型检查 |
| `npm run cf-typegen` | Regenerate Cloudflare types / 重新生成 Cloudflare 类型 |

---

## Database Schema / 数据库结构

| Table | Description |
|-------|-------------|
| `users` | User accounts with auth, level, streak data / 用户账户及认证、等级、连续打卡数据 |
| `materials` | English sentences with AI analysis results / 英语语料及 AI 分析结果 |
| `daily_plans` | Daily practice plans / 每日练习计划 |
| `plan_items` | Individual items in a plan / 计划条目 |
| `practice_records` | Practice session records / 练习记录 |
| `recordings` | User voice recordings metadata / 录音元数据 |
| `preprocess_jobs` | In-flight preprocessing tracking / 预处理进行中任务跟踪 |
| `operation_locks` | Server-side operation locks / 服务端操作互斥锁 |

---

## Architecture Overview / 架构概览

```
User Browser
    |
    +-- React Router 7 (SSR on Cloudflare Workers)
    |   +-- Loaders: fetch data from D1
    |   +-- Actions: process forms, update D1
    |   +-- Components: practice flow, audio recording
    |
    +-- Audio API (/api/audio/:key)
    |   +-- Streams from R2 with auth + ownership check
    |
    +-- Async Preprocessing (waitUntil)
    |   +-- MiniMax LLM: sentence analysis
    |   +-- MiniMax TTS: 3-speed audio -> R2
    |
    +-- Cron (UTC 20:00)
        +-- Generate daily plans (UTC+8 date)
        +-- Recover stale preprocess jobs
        +-- Run practice data integrity audit
```

---

## Security / 安全措施

- PBKDF2 password hashing (100k iterations, SHA-256) with timing-safe comparison
- Cookie-based sessions (HttpOnly, Secure, SameSite=Lax) stored in KV
- Login rate limiting (max 5 failed attempts, then 15-minute lockout)
- Audio API requires authentication and validates resource ownership
- All database mutations verify user ownership
- Input length validation to prevent abuse

---

## License / 许可证

Private project. All rights reserved.

私有项目，保留所有权利。
