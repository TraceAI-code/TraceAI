import { api } from './apiClient';
import type { AuditReport, AuditReportOutcome } from '../types/auditReport';
import type { AuditEvent } from '../types/decisionDetail';
import type { Evidence } from '../types/evidence';
import type { ReviewAction } from '../types/review';

interface BackendAuditEvent {
  sequence: number;
  event_type: string;
  timestamp: string;
  event_hash: string;
  previous_hash: string | null;
  payload: Record<string, unknown>;
}

interface BackendAuditReport {
  report_metadata: { generated_at: string; system: string };
  decision: {
    id: string;
    agent_id: string;
    agent_version: string;
    status: string;
    created_at: string;
    root_hash: string | null;
  };
  cryptographic_verification: {
    valid: boolean;
    event_count?: number;
    root_hash?: string | null;
  };
  audit_events_timeline: BackendAuditEvent[];
  evidence_inventory: Array<{
    evidence_id: string;
    type: string;
    content_hash: string;
    storage_uri: string;
    role: string;
    created_at: string;
  }>;
  human_reviews: Array<{
    review_id: string;
    reviewer_id: string;
    action: string;
    comments: string | null;
    timestamp: string;
  }>;
  replay_verification: Array<{
    replay_id: string;
    status: string;
    replay_mode: string;
    similarity_score: number;
    diff_summary: Record<string, unknown>;
    timestamp: string;
  }>;
}

function toAuditReport(r: BackendAuditReport): AuditReport {
  const dec = r.decision;

  const events: AuditEvent[] = (r.audit_events_timeline ?? []).map((e, i) => ({
    id: `${dec.id}-evt-${i}`,
    event_type: e.event_type,
    timestamp: e.timestamp,
    sequence: e.sequence,
    actor: (e.payload?.['agent_id'] as string) ?? 'system',
    payload: e.payload as Record<string, import('../types/decisionDetail').JsonValue>,
    hash: e.event_hash,
    previous_hash: e.previous_hash,
  }));

  const evidence: Evidence[] = (r.evidence_inventory ?? []).map((ev) => ({
    id: ev.evidence_id,
    evidence_type: ev.type,
    title: ev.type.replace(/_/g, ' '),
    source: 'TraceAI Evidence Store',
    source_reference: ev.storage_uri,
    content: ev.content_hash,
    excerpt: null,
    created_at: ev.created_at,
    retrieved_at: null,
    hash: ev.content_hash,
    metadata: { role: ev.role },
    linked_decision_ids: [dec.id],
    linked_decisions: [],
  }));

  const reviews: ReviewAction[] = (r.human_reviews ?? []).map((rev) => ({
    id: rev.review_id,
    decision_id: dec.id,
    reviewer: rev.reviewer_id,
    action: rev.action.toUpperCase(),
    comment: rev.comments,
    created_at: rev.timestamp,
  }));

  // Derive final outcome from the last OUTPUT or ACTION_TAKEN event
  const outputEvent = [...events].reverse().find(
    (e) => e.event_type === 'OUTPUT' || e.event_type === 'ACTION_TAKEN',
  );
  let finalOutcome: AuditReportOutcome | null = null;
  if (outputEvent) {
    const verdict = outputEvent.payload?.['verdict'] ?? outputEvent.payload?.['action'] ?? outputEvent.payload?.['status'];
    if (verdict) {
      finalOutcome = {
        value: String(verdict),
        source: 'RECORDED_RESULT',
        description: `Recorded at sequence ${outputEvent.sequence}`,
      };
    }
  }

  const integ = r.cryptographic_verification;

  return {
    decision: {
      id: dec.id,
      agent_id: dec.agent_id,
      agent_version: dec.agent_version,
      status: dec.status,
      created_at: dec.created_at,
      root_hash: dec.root_hash,
      event_count: events.length,
    },
    executive_summary: `Decision ${dec.id} by agent ${dec.agent_id} (v${dec.agent_version}). Status: ${dec.status}. Chain: ${integ.valid ? 'VALID' : 'COMPROMISED'}.`,
    events,
    evidence,
    policies: [],
    reviews,
    integrity: integ
      ? {
          decision_id: dec.id,
          root_hash: integ.root_hash ?? null,
          event_count: integ.event_count ?? events.length,
          events_hashed: integ.event_count ?? events.length,
          hash_algorithm: 'SHA-256',
          chain_status: integ.valid ? 'VALID' : 'COMPROMISED',
          verification_status: integ.valid ? 'VERIFIED' : 'FAILED',
          last_verified_at: r.report_metadata.generated_at,
          events: [],
        }
      : null,
    final_outcome: finalOutcome,
  };
}

export async function getAuditReport(decisionId: string): Promise<AuditReport | null> {
  try {
    const r = await api.get<BackendAuditReport>(
      `/decisions/${decisionId}/audit-report?format=json`,
    );
    return toAuditReport(r);
  } catch {
    return null;
  }
}

interface BackendAuditReportItem {
  decision_id: string;
  agent_id: string;
  agent_version: string;
  status: string;
  created_at: string;
  root_hash: string | null;
  event_count: number;
  final_outcome: string | null;
}

export async function getAuditReports(): Promise<AuditReport[]> {
  const items = await api.get<BackendAuditReportItem[]>('/decisions/audit-reports?limit=50');

  return items.map((item) => ({
    decision: {
      id: item.decision_id,
      agent_id: item.agent_id,
      agent_version: item.agent_version,
      status: item.status,
      created_at: item.created_at,
      root_hash: item.root_hash,
      event_count: item.event_count,
    },
    executive_summary: `Decision ${item.decision_id} by agent ${item.agent_id} (v${item.agent_version}).`,
    events: [],
    evidence: [],
    policies: [],
    reviews: [],
    integrity: null,
    final_outcome: item.final_outcome
      ? {
          value: item.final_outcome,
          source: 'RECORDED_RESULT',
          description: 'Recorded decision outcome',
        }
      : null,
  }));
}

