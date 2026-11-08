export interface LinkedDecision {
  id: string;
  agent_id: string;
  status: string;
  created_at: string;
}

export interface Evidence {
  id: string;
  evidence_type: string;
  title: string;
  source: string;
  source_reference: string | null;
  content: string;
  /** Whether the stored bytes still match the recorded content hash. */
  content_verified?: boolean;
  excerpt: string | null;
  created_at: string;
  retrieved_at: string | null;
  hash: string | null;
  metadata: Record<string, unknown>;
  linked_decision_ids: string[];
  linked_decisions?: LinkedDecision[];
}
