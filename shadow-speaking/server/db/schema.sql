-- Shadow Speaking Database Schema
-- Cloudflare D1 (SQLite)

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  daily_minutes INTEGER NOT NULL DEFAULT 20,
  streak_days INTEGER NOT NULL DEFAULT 0,
  max_streak_days INTEGER NOT NULL DEFAULT 0,
  total_practice_days INTEGER NOT NULL DEFAULT 0,
  last_practice_date TEXT,
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Materials table
CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'direct',
  level INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'unlearned',
  tags TEXT DEFAULT '[]',
  translation TEXT,
  phonetic_notes TEXT,
  pause_marks TEXT,
  word_mask TEXT,
  expression_prompt TEXT,
  audio_slow_key TEXT,
  audio_normal_key TEXT,
  audio_fast_key TEXT,
  review_count INTEGER NOT NULL DEFAULT 0,
  next_review_date TEXT,
  last_practice_date TEXT,
  preprocess_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_materials_user_status ON materials(user_id, status);
CREATE INDEX IF NOT EXISTS idx_materials_user_review ON materials(user_id, next_review_date);
CREATE INDEX IF NOT EXISTS idx_materials_user_level ON materials(user_id, level);
CREATE INDEX IF NOT EXISTS idx_materials_user_content ON materials(user_id, content);

-- Daily plans table
CREATE TABLE IF NOT EXISTS daily_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_date TEXT NOT NULL,
  total_items INTEGER NOT NULL DEFAULT 0,
  completed_items INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_user_date ON daily_plans(user_id, plan_date);

-- Plan items table
CREATE TABLE IF NOT EXISTS plan_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  item_order INTEGER NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'new',
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (plan_id) REFERENCES daily_plans(id),
  FOREIGN KEY (material_id) REFERENCES materials(id)
);

-- Practice records table
CREATE TABLE IF NOT EXISTS practice_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  plan_item_id TEXT,
  completed_all_stages INTEGER NOT NULL DEFAULT 0,
  self_rating TEXT,
  is_poor_performance INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (material_id) REFERENCES materials(id),
  FOREIGN KEY (plan_item_id) REFERENCES plan_items(id)
);

-- Recordings table
CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  practice_record_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  stage INTEGER NOT NULL,
  round INTEGER NOT NULL DEFAULT 1,
  r2_key TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  is_silent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (practice_record_id) REFERENCES practice_records(id),
  FOREIGN KEY (material_id) REFERENCES materials(id)
);

-- Preprocess job tracking (for stuck-processing recovery)
CREATE TABLE IF NOT EXISTS preprocess_jobs (
  material_id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  FOREIGN KEY (material_id) REFERENCES materials(id)
);

CREATE INDEX IF NOT EXISTS idx_preprocess_jobs_started_at ON preprocess_jobs(started_at);

-- Generic operation locks
CREATE TABLE IF NOT EXISTS operation_locks (
  lock_key TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recordings_material ON recordings(material_id, created_at);
CREATE INDEX IF NOT EXISTS idx_plan_items_plan_id ON plan_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_practice_records_user_id ON practice_records(user_id);
CREATE INDEX IF NOT EXISTS idx_practice_records_material_id ON practice_records(material_id);
CREATE INDEX IF NOT EXISTS idx_recordings_practice_record_id ON recordings(practice_record_id);
