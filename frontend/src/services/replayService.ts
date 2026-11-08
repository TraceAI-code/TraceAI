import { api } from './apiClient';
import type { ReplayCondition, ReplayDifference, ReplayRun } from '../types/replay';

interface BackendDiffSummary {
  is_match: boolean;
  status: string;
  overall_similarity: number;
  action_diff: {
    original: Record<string, unknown> | null;
    replayed: Record<string, unknown> | null;
    match: boolean;
  };
  tools_match: boolean;
  tools_executed_count: number;
  tool_details: Array<{
    tool_name: string;
    original_args: Record<string, unknown>;
    replayed_args: Record<string, unknown>;
    args_match: boolean;
    result_match: boolean;
  }>;
  reasoning_similarity_ratio: number;
  reasoning_diff: string[];
  policy_diff: Record<string, unknown>;
  metrics_diff: Record<string, unknown>;
  summary: string;
}

interface BackendReplay {
  id: string;
  decision_id: string;
  status: string;
  replay_mode: string;
  similarity_score: number;
  diff_summary: BackendDiffSummary;
  replayed_events: Array<Record<string, unknown>>;
  created_at: string;
}

function toReplayRun(r: BackendReplay): ReplayRun {
  const diff = r.diff_summary ?? {};
  const actionDiff = diff.action_diff ?? {};

  // Build conditions from tool_details
  const conditions: ReplayCondition[] = (diff.tool_details ?? []).map((t) => ({
    name: t.tool_name,
    original_value: JSON.stringify(t.original_args),
    replay_value: JSON.stringify(t.replayed_args),
    changed: !t.args_match,
  }));

  // Build differences from reasoning diff and action diff
  const differences: ReplayDifference[] = [];
  if (!actionDiff.match) {
    differences.push({
      field: 'Action / Outcome',
      original_value: JSON.stringify(actionDiff.original ?? {}),
      replay_value: JSON.stringify(actionDiff.replayed ?? {}),
      significance: 'The final action diverged between the original and replayed executions.',
    });
  }
  if ((diff.reasoning_similarity_ratio ?? 1) < 1) {
    differences.push({
      field: 'Reasoning Text',
      original_value: '(original reasoning)',
      replay_value: '(replayed reasoning)',
      significance: `Reasoning similarity: ${Math.round((diff.reasoning_similarity_ratio ?? 0) * 100)}%`,
    });
  }

  return {
    id: r.id,
    decision_id: r.decision_id,
    mode: r.replay_mode?.toUpperCase() ?? 'DETERMINISTIC',
    status: r.status?.toUpperCase() ?? 'COMPLETED',
    created_at: r.created_at,
    completed_at: r.created_at,
    original_result: (actionDiff.original as Record<string, string>)?.['action'] ?? (actionDiff.original as Record<string, string>)?.['status'] ?? 'N/A',
    replay_result: (actionDiff.replayed as Record<string, string>)?.['action'] ?? (actionDiff.replayed as Record<string, string>)?.['status'] ?? 'N/A',
    summary: diff.summary ?? '',
    differences,
    conditions,
  };
}

export async function getReplayRuns(): Promise<ReplayRun[]> {
  // No global replays list endpoint — callers should use getReplayRunsForDecision
  return [];
}

export async function getReplayRunsForDecision(decisionId: string): Promise<ReplayRun[]> {
  const results = await api.get<BackendReplay[]>(`/decisions/${decisionId}/replays`);
  return results.map(toReplayRun).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getReplayById(replayId: string): Promise<ReplayRun | null> {
  try {
    const r = await api.get<BackendReplay>(`/decisions/replays/run/${replayId}`);
    return toReplayRun(r);
  } catch {
    return null;
  }
}

export async function createDeterministicReplay(decisionId: string): Promise<ReplayRun> {
  const r = await api.post<BackendReplay>(`/decisions/${decisionId}/replay`, {
    mode: 'deterministic',
    mock_tools: true,
  });
  return toReplayRun(r);
}

function parseConditionValue(condition: ReplayCondition): unknown {
  const raw = condition.replay_value;
  switch (condition.value_type) {
    case 'number': {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : raw;
    }
    case 'boolean':
      return raw === 'true';
    case 'json':
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    default:
      return raw;
  }
}

export async function createWhatIfReplay(
  decisionId: string,
  inputConditions: ReplayCondition[],
): Promise<ReplayRun> {
  // Convert conditions to an override_inputs dict, preserving native types.
  const overrideInputs: Record<string, unknown> = {};
  for (const c of inputConditions.filter((c) => c.changed)) {
    overrideInputs[c.name] = parseConditionValue(c);
  }

  const r = await api.post<BackendReplay>(`/decisions/${decisionId}/replay`, {
    mode: 'what_if',
    override_inputs: overrideInputs,
    mock_tools: true,
  });
  return toReplayRun(r);
}
