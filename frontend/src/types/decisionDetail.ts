export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

export interface AuditEvent {
  id: string;
  event_type: string;
  timestamp: string;
  sequence: number;
  actor: string;
  payload: JsonObject;
  hash: string;
  previous_hash: string | null;
}

export interface DecisionEvidenceReference {
  id: string;
  type: string;
  role: string;
}

export interface DecisionPolicyReference {
  id: string;
  name: string;
  version: string;
  result: string;
}

export interface HumanReview {
  reviewer_id: string;
  action: string;
  comments: string | null;
  created_at: string;
}

export interface DecisionDetail {
  id: string;
  agent_id: string;
  agent_version: string;
  status: string;
  created_at: string;
  root_hash: string | null;
  event_count: number;
  input_data: Record<string, unknown>;
  decision_summary: string;
  events: AuditEvent[];
  evidence: DecisionEvidenceReference[];
  policies: DecisionPolicyReference[];
  human_review: HumanReview | null;
}
