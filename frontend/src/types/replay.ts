export interface ReplayCondition {
  name: string;
  original_value: string;
  replay_value: string;
  changed: boolean;
  /** Type of the captured input so what-if overrides keep their native JSON type. */
  value_type?: 'string' | 'number' | 'boolean' | 'json';
}

export interface ReplayDifference {
  field: string;
  original_value: string;
  replay_value: string;
  significance: string;
}

export type ReplayEventSource = 'recorded' | 'mocked_tool' | 'simulated' | 'unavailable';

export interface ReplayEvent {
  sequence: number;
  event_type: string;
  source: ReplayEventSource | string;
}

export interface ReplayRun {
  id: string;
  decision_id: string;
  mode: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  original_result: string;
  replay_result: string;
  summary: string;
  differences: ReplayDifference[];
  conditions: ReplayCondition[];
  trace_verified: boolean;
  trace_verification_reason: string | null;
  events: ReplayEvent[];
}
