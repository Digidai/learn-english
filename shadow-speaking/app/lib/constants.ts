// Spaced repetition intervals (in days)
export const REVIEW_INTERVALS = [1, 2, 4, 7, 16, 30, 60];

// Level definitions
export const LEVELS = [1, 2, 3, 4, 5] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = {
  1: "L1 - 基础",
  2: "L2 - 初级",
  3: "L3 - 中级",
  4: "L4 - 中高级",
  5: "L5 - 高级",
};

// Daily practice durations
export const DAILY_MINUTES_OPTIONS = [10, 20, 30] as const;

// Practice stages
export const STAGES = {
  COMPREHENSION: 1,
  LISTENING: 2,
  SYNC_READING: 3,
  SHADOWING: 4,
  REPRODUCTION: 5,
  FREE_EXPRESSION: 6,
} as const;

// Material status
export const MATERIAL_STATUS = {
  UNLEARNED: "unlearned",
  LEARNING: "learning",
  MASTERED: "mastered",
} as const;

// Preprocess status
export const PREPROCESS_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  DONE: "done",
  FAILED: "failed",
} as const;

// Self rating options
export const SELF_RATINGS = {
  GOOD: "good",
  FAIR: "fair",
  POOR: "poor",
} as const;

// TTS speeds
export const TTS_SPEEDS = {
  SLOW: 0.75,
  NORMAL: 1.0,
  FAST: 1.25,
} as const;

// Tab navigation items
export const TAB_ITEMS = [
  { path: "/today", label: "今日练习", icon: "calendar" },
  { path: "/input", label: "添加素材", icon: "plus" },
  { path: "/corpus", label: "我的语料", icon: "book" },
  { path: "/profile", label: "个人中心", icon: "user" },
] as const;
