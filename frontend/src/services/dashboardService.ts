import { api } from './apiClient';
import type { Decision } from '../types/decision';

export interface DashboardData {
  decisions: Decision[];
  evidenceCount: number;
  policyEvaluationCount: number;
  decisionsWithReviewHistory: number;
  decisionsWithoutReviewHistory: number;
  integrityAvailableCount: number;
  intactChainCount: number;
  warningChainCount: number;
  integrityUnavailableCount: number;
  verifiedChainCount: number;
  verificationFailureCount: number;
}

interface BackendDashboardStats {
  decisions: Array<{
    id: string;
    agent_id: string;
    agent_version: string;
    status: string;
    created_at: string;
    root_hash: string | null;
    event_count: number;
  }>;
  evidence_count: number;
  policy_evaluation_count: number;
  decisions_with_review_history: number;
  decisions_without_review_history: number;
  integrity_available_count: number;
  intact_chain_count: number;
  warning_chain_count: number;
  integrity_unavailable_count: number;
  verified_chain_count?: number;
  verification_failure_count?: number;
}

/**
 * Instantaneous dashboard load.
 * Fetches pre-aggregated statistics from GET /api/v1/decisions/dashboard-stats
 * in a single HTTP request instead of N+1 cascading requests.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const stats = await api.get<BackendDashboardStats>('/decisions/dashboard-stats');

  return {
    decisions: stats.decisions.map((d) => ({
      id: d.id,
      agent_id: d.agent_id,
      agent_version: d.agent_version,
      status: d.status,
      created_at: d.created_at,
      root_hash: d.root_hash,
      event_count: d.event_count ?? 0,
    })),
    evidenceCount: stats.evidence_count,
    policyEvaluationCount: stats.policy_evaluation_count,
    decisionsWithReviewHistory: stats.decisions_with_review_history,
    decisionsWithoutReviewHistory: stats.decisions_without_review_history,
    integrityAvailableCount: stats.integrity_available_count,
    intactChainCount: stats.intact_chain_count,
    warningChainCount: stats.warning_chain_count,
    integrityUnavailableCount: stats.integrity_unavailable_count,
    verifiedChainCount: stats.verified_chain_count ?? stats.intact_chain_count,
    verificationFailureCount: stats.verification_failure_count ?? 0,
  };
}
