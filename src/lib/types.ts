export type Source = "google_play" | "app_store";

export type Vertical =
  | "food"
  | "grocery"
  | "pharmacy"
  | "rappipay"
  | "courier"
  | "app"
  | "other";

export type PainPoint =
  | "late_delivery"
  | "missing_item"
  | "wrong_item"
  | "app_bug"
  | "payment_failure"
  | "support_unresponsive"
  | "courier_behavior"
  | "price_complaint"
  | "other";

export interface RawReview {
  id: string;
  source: Source;
  rating: number;
  review_date: string;
  text: string;
  language: string;
  country: string;
  raw_author_id: string | null;
}

export interface ClassifiedReview {
  review_id: string;
  vertical: Vertical;
  pain_point: PainPoint;
  sentiment: number;
  summary_es: string;
  classified_at: string;
}

export interface WeeklyBrief {
  id: string;
  week_start: string;
  vertical: Vertical;
  total_reviews: number;
  negative_share: number;
  top_pain_points: Array<{ pain_point: PainPoint; count: number; share: number }>;
  clusters: Array<{ theme: string; count: number; example_quote: string }>;
  generated_at: string;
}
