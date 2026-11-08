import { api } from './apiClient';
import type { ReviewAction, ReviewActionKind } from '../types/review';

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
}): Promise<ReviewAction> {
  if (!input.decision_id) throw new Error('A decision is required for a review.');
  if ((input.action === 'REJECTED' || input.action === 'OVERRIDDEN') && !input.comment?.trim()) {
    throw new Error('A comment is required for a rejected or overridden review.');
  }

  const review = await api.post<BackendReview>(`/decisions/${input.decision_id}/reviews`, {
    reviewer_id: 'auditor-ui',
    action: input.action.toLowerCase(),
    comments: input.comment?.trim() || null,
  });
  return toReview(review);
}
