import { REVIEW_INTERVALS } from "../../app/lib/constants";

interface MaterialReviewData {
  id: string;
  review_count: number;
  status: string;
}

interface PracticeResult {
  completedAllStages: boolean;
  selfRating: string | null; // "good" | "fair" | "poor"
  isPoorPerformance: boolean;
}

const MASTERY_REVIEW_THRESHOLD = 5;

export function calculateNextReview(
  material: MaterialReviewData,
  practice: PracticeResult,
  today: string
): {
  reviewCount: number;
  nextReviewDate: string;
  newStatus: string;
} {
  // Poor performance handling
  if (practice.isPoorPerformance || practice.selfRating === "poor") {
    if (practice.completedAllStages) {
      // Completed all stages but performed poorly: halve review count, review in 1 day
      return {
        reviewCount: Math.max(1, Math.floor(material.review_count / 2)),
        nextReviewDate: addDays(today, 1),
        newStatus: "learning",
      };
    }
    // Didn't complete all stages: full reset
    return {
      reviewCount: 0,
      nextReviewDate: addDays(today, 1),
      newStatus: "learning",
    };
  }

  // "fair" rating: keep review_count the same, use half interval
  if (practice.selfRating === "fair") {
    const intervalIndex = Math.min(
      Math.max(material.review_count - 1, 0),
      REVIEW_INTERVALS.length - 1
    );
    const halfInterval = Math.max(1, Math.floor(REVIEW_INTERVALS[intervalIndex] / 2));
    return {
      reviewCount: material.review_count,
      nextReviewDate: addDays(today, halfInterval),
      newStatus: material.status === "unlearned" ? "learning" : material.status,
    };
  }

  const newReviewCount = material.review_count + 1;

  // Calculate next interval
  const intervalIndex = Math.min(newReviewCount - 1, REVIEW_INTERVALS.length - 1);
  const interval = REVIEW_INTERVALS[intervalIndex];
  const nextReviewDate = addDays(today, interval);

  // Check mastery conditions:
  // 1. review_count >= 5 (covers the 30-day interval)
  // 2. completed all stages at least once
  // 3. self_rating is not "poor"
  let newStatus = material.status;
  if (
    newReviewCount >= MASTERY_REVIEW_THRESHOLD &&
    practice.completedAllStages &&
    practice.selfRating !== "poor"
  ) {
    newStatus = "mastered";
  } else if (material.status === "unlearned") {
    newStatus = "learning";
  }

  return {
    reviewCount: newReviewCount,
    nextReviewDate,
    newStatus,
  };
}

export async function updateMaterialAfterPractice(
  db: D1Database,
  materialId: string,
  practice: PracticeResult,
  today: string
): Promise<void> {
  const material = await db
    .prepare("SELECT id, review_count, status FROM materials WHERE id = ?")
    .bind(materialId)
    .first<MaterialReviewData>();

  if (!material) return;

  const result = calculateNextReview(material, practice, today);

  await db
    .prepare(
      `UPDATE materials SET
        review_count = ?,
        next_review_date = ?,
        status = ?,
        last_practice_date = ?
       WHERE id = ?`
    )
    .bind(result.reviewCount, result.nextReviewDate, result.newStatus, today, materialId)
    .run();
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
