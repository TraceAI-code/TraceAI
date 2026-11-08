import { api } from './apiClient';
import type { ReviewAction, ReviewActionKind } from '../types/review';

const REVIEWER_STORAGE_KEY = 'traceai.reviewer_id';
const COMMENT_REQUIRED: ReviewActionKind[] = ['REJECTED', 'OVERRIDDEN', 'REQUESTED_REVIEW'];

interface BackendReview {
  id: string;
  decision_id: string;
  reviewer_id: string;
  action: string;
  comments: string | null;
  created_at: string;
}

function toReview(r: BackendReview): ReviewAction {
  return {
    id: r.id,
    decision_id: r.decision_id,
    // Backend uses `reviewer_id`; frontend uses `reviewer`
    reviewer: r.reviewer_id,
    action: r.action.toUpperCase() as ReviewActionKind,
    // Backend uses `comments`; frontend uses `comment`
    comment: r.comments,
    created_at: r.created_at,
  };
}

/**
 * Resolve the reviewer identity without inventing one.
 *
 * Priority: explicit build-time configuration, then a value an auditor has
 * persisted in this browser. There is intentionally no hardcoded fallback:
 * an audit trail must identify a real principal.
 */
export function getReviewerId(): string | null {
  const configured = import.meta.env.VITE_REVIEWER_ID?.trim();
  if (configured) return configured;

  try {
    const stored = window.localStorage.getItem(REVIEWER_STORAGE_KEY)?.trim();
    return stored || null;
  } catch {
    return null;
  }
}

export function setReviewerId(reviewerId: string): void {
  const normalized = reviewerId.trim();
  if (!normalized) return;
  try {
    window.localStorage.setItem(REVIEWER_STORAGE_KEY, normalized);
  } catch {
    // Storage can be unavailable (private mode); the caller still sends the
    // identity for this submission.
  }
}

export async function getReviewsForDecision(decisionId: string): Promise<ReviewAction[]> {
  const results = await api.get<BackendReview[]>(`/decisions/${decisionId}/reviews`);
  return results.map(toReview).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getReviewById(_reviewId: string): Promise<ReviewAction | null> {
  // No dedicated single-review endpoint — not needed by the UI
  return null;
}

export async function submitReview(input: {
  decision_id: string;
  action: ReviewActionKind;
  comment: string | null;
  reviewer_id?: string;
}): Promise<ReviewAction> {
  if (!input.decision_id) throw new Error('A decision is required for a review.');

  const reviewerId = (input.reviewer_id ?? getReviewerId())?.trim();
  if (!reviewerId) {
    throw new Error('Set your reviewer identity before submitting an audit review.');
  }

  if (COMMENT_REQUIRED.includes(input.action) && !input.comment?.trim()) {
    throw new Error(
      'A comment is required for reject, override, and request-review actions.',
    );
  }

  const review = await api.post<BackendReview>(`/decisions/${input.decision_id}/reviews`, {
    reviewer_id: reviewerId,
    action: input.action.toLowerCase(),
    comments: input.comment?.trim() || null,
  });

  setReviewerId(reviewerId);
  return toReview(review);
}
