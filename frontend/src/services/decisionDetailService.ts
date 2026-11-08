import { api } from './apiClient';
import type { DecisionDetail, AuditEvent, DecisionEvidenceReference, DecisionPolicyReference } from '../types/decisionDetail';

interface BackendEvent {
  id: string;
  event_type: string;
  sequence_number: number;
  timestamp: string;
  payload: Record<string, unknown>;
  previous_hash: string | null;
  event_hash: string;
}

interface BackendEvidenceLink {
  id: string;
  evidence_id: string;
  role: string;
  created_at: string;
}

interface BackendReview {
  id: string;
  reviewer_id: string;
  action: string;
  comments: string | null;
  created_at: string;
}

interface BackendDecisionDetail {
  id: string;
  agent_id: string;
  agent_version: string;
  status: string;
  created_at: string;
  root_hash: string | null;
  input_data: Record<string, unknown>;
  events: BackendEvent[];
  evidence_links: BackendEvidenceLink[];
  review_actions: BackendReview[];
}

function toAuditEvent(e: BackendEvent): AuditEvent {
  return {
    id: e.id,
    event_type: e.event_type,
    sequence: e.sequence_number,
    timestamp: e.timestamp,
    actor: e.payload?.['agent_id'] as string ?? 'system',
    payload: e.payload as Record<string, import('../types/decisionDetail').JsonValue>,
    hash: e.event_hash,
    previous_hash: e.previous_hash,
  };
}

export async function getDecisionDetail(decisionId: string): Promise<DecisionDetail | null> {
  try {
    const d = await api.get<BackendDecisionDetail>(`/decisions/${decisionId}`);

    const events: AuditEvent[] = (d.events ?? []).map(toAuditEvent);
    const evidence: DecisionEvidenceReference[] = (d.evidence_links ?? []).map((l) => ({
      id: l.evidence_id,
      type: 'evidence',
      role: l.role,
    }));
    const latestReview = d.review_actions?.[d.review_actions.length - 1] ?? null;

    // Derive policy references from POLICY_EVALUATION events, newest first.
    const policies: DecisionPolicyReference[] = [];
    for (const event of [...events].reverse()) {
      if (event.event_type !== 'POLICY_EVALUATION') continue;
      const details = event.payload?.['policy_details'];
      if (!Array.isArray(details)) continue;
      for (const detail of details) {
        if (!detail || typeof detail !== 'object') continue;
        const record = detail as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id : '';
        if (!id || policies.some((policy) => policy.id === id)) continue;
        policies.push({
          id,
          name: typeof record.name === 'string' ? record.name : id,
          version: typeof record.version === 'string' ? record.version : 'unknown',
          result: event.payload?.['status'] === 'violated' ? 'FAILED' : 'PASSED',
        });
      }
    }

    const lastAction = [...events].reverse().find(
      (event) => event.event_type === 'ACTION_TAKEN' || event.event_type === 'OUTPUT' || event.event_type === 'DECISION_MADE',
    );
    const outcome = lastAction
      ? lastAction.payload?.['action'] ?? lastAction.payload?.['verdict'] ?? lastAction.payload?.['status'] ?? lastAction.payload?.['decision']
      : undefined;
    const decisionSummary = outcome
      ? `Agent ${d.agent_id} (v${d.agent_version}) recorded ${String(outcome)} — status: ${d.status}.`
      : `Agent ${d.agent_id} (v${d.agent_version}) — status: ${d.status}.`;

    return {
      id: d.id,
      agent_id: d.agent_id,
      agent_version: d.agent_version,
      status: d.status,
      created_at: d.created_at,
      root_hash: d.root_hash,
      event_count: events.length,
      input_data: d.input_data ?? {},
      decision_summary: decisionSummary,
      events,
      evidence,
      policies,
      human_review: latestReview
        ? {
            reviewer_id: latestReview.reviewer_id,
            action: latestReview.action,
            comments: latestReview.comments,
            created_at: latestReview.created_at,
          }
        : null,
    };
  } catch {
    return null;
  }
}
