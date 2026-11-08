import { ApiError, api } from './apiClient';
import type { AuditReport, AuditReportOutcome, AuditReportPolicy } from '../types/auditReport';
import type { AuditEvent } from '../types/decisionDetail';
import type { Evidence } from '../types/evidence';
import type { PolicyEvaluation } from '../types/policy';
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

function buildPolicies(decisionId: string, events: AuditEvent[]): AuditReportPolicy[] {
  const entries = new Map<string, AuditReportPolicy>();

  // Newest evaluation first so the most recent policy result wins.
  for (const event of [...events].reverse()) {
    if (event.event_type !== 'POLICY_EVALUATION') continue;

    const details = Array.isArray(event.payload['policy_details'])
      ? event.payload['policy_details']
      : [];
    const rawViolations = Array.isArray(event.payload['violations'])
      ? event.payload['violations']
      : [];

    for (const rawDetail of details) {
      if (!rawDetail || typeof rawDetail !== 'object') continue;
      const detail = rawDetail as Record<string, unknown>;
      const id = typeof detail['id'] === 'string' ? detail['id'] : '';
      if (!id || entries.has(id)) continue;

      const name = typeof detail['name'] === 'string' ? detail['name'] : id;
      const version = typeof detail['version'] === 'string' ? detail['version'] : 'unknown';
      const violations = rawViolations.filter(
        (violation) => violation && typeof violation === 'object'
          && String((violation as Record<string, unknown>)['policy_id']) === id,
      ) as Array<Record<string, unknown>>;
      const passed = violations.length === 0;

      const evaluation: PolicyEvaluation = {
        id: `${event.id}:${id}`,
        policy_id: id,
        policy_version: version,
        decision_id: decisionId,
        evaluated_at: event.timestamp,
        result: passed ? 'PASSED' : 'FAILED',
        summary: passed
          ? `Policy '${name}' passed evaluation.`
          : violations.map((violation) => String(violation['message'] ?? 'Policy violation')).join('; '),
        conditions: violations.map((violation) => ({
          name: String(violation['rule_id'] ?? violation['type'] ?? 'rule'),
          expected: String(violation['expected'] ?? violation['pattern'] ?? 'no violation'),
          actual: String(violation['actual_value'] ?? violation['field'] ?? violation['tool_name'] ?? ''),
          result: 'FAILED',
        })),
      };

      entries.set(id, {
        policy: {
          id,
          name,
          version,
          status: 'active',
          description: '',
          policy_type: 'governance',
          effective_from: event.timestamp,
          effective_to: null,
          created_at: event.timestamp,
          updated_at: event.timestamp,
          rules: [],
        },
        evaluation,
      });
    }
  }

  return [...entries.values()];
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
    content: '',
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

  const policies = buildPolicies(dec.id, events);

  // Derive final outcome from the last OUTPUT, ACTION_TAKEN, or DECISION_MADE event
  const outputEvent = [...events].reverse().find(
    (e) => e.event_type === 'OUTPUT' || e.event_type === 'ACTION_TAKEN' || e.event_type === 'DECISION_MADE',
  );
  let finalOutcome: AuditReportOutcome | null = null;
  if (outputEvent) {
    const verdict = outputEvent.payload?.['verdict']
      ?? outputEvent.payload?.['action']
      ?? outputEvent.payload?.['decision']
      ?? outputEvent.payload?.['status'];
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
    executive_summary: `Decision ${dec.id} by agent ${dec.agent_id} (v${dec.agent_version}). Status: ${dec.status}. Chain: ${integ.valid ? 'VALID' : 'COMPROMISED'}. Policy evaluations: ${policies.length}.`,
    events,
    evidence,
    policies,
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
          events: events.map((event) => ({
            event_id: event.id,
            sequence: event.sequence,
            event_type: event.event_type,
            hash: event.hash,
            previous_hash: event.previous_hash,
          })),
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
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) return null;
    throw cause;
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
