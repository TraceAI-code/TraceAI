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
}
