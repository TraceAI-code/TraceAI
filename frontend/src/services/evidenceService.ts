import { api } from './apiClient';
import type { Evidence, LinkedDecision } from '../types/evidence';

interface BackendEvidence {
  id: string;
  type: string;
  content_hash: string;
  storage_uri: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

interface BackendEvidenceDetail extends BackendEvidence {
  content: string | null;
  content_verified: boolean;
  linked_decisions: LinkedDecision[];
}

function toEvidence(e: BackendEvidence, detail?: BackendEvidenceDetail): Evidence {
  return {
    id: e.id,
    // Map backend `type` → frontend `evidence_type`
    evidence_type: e.type,
    title: e.metadata_json?.['title'] as string ?? e.type.replace(/_/g, ' '),
    source: e.metadata_json?.['source'] as string ?? 'TraceAI Evidence Store',
    source_reference: e.storage_uri,
    // The list endpoint returns metadata only; content is loaded on the detail page.
    content: detail?.content ?? '',
    content_verified: detail?.content_verified,
    excerpt: null,
    created_at: e.created_at,
    retrieved_at: null,
    // Map backend `content_hash` → frontend `hash`
    hash: e.content_hash,
    metadata: e.metadata_json ?? {},
    linked_decision_ids: detail?.linked_decisions.map((decision) => decision.id) ?? [],
    linked_decisions: detail?.linked_decisions ?? [],
  };
}

export async function getEvidence(): Promise<Evidence[]> {
  const results = await api.get<BackendEvidence[]>('/evidence?limit=100');
  return results.map((item) => toEvidence(item));
}

export async function getEvidenceById(evidenceId: string): Promise<Evidence | null> {
  try {
    const e = await api.get<BackendEvidenceDetail>(`/evidence/${evidenceId}`);
    return toEvidence(e, e);
  } catch {
    return null;
  }
}
