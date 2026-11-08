import { api, isNotFound } from './apiClient';
import type { Policy, PolicyEvaluation } from '../types/policy';

interface BackendRule {
  id?: string;
  type?: string;
  field?: string;
  operator?: string;
  value?: unknown;
  action?: string;
  message?: string;
  patterns?: string[];
  tools?: string[];
}

interface BackendPolicy {
  id: string;
  name: string;
  version: string;
  status?: string;
  description?: string | null;
  content_hash?: string;
  storage_uri?: string | null;
  rules: Record<string, unknown> | BackendRule[];
  effective_from?: string;
  effective_to?: string | null;
  created_at: string;
  updated_at?: string;
}

interface BackendPolicyEvaluation {
  id: string;
  policy_id: string;
  policy_version: string;
  decision_id: string;
  evaluated_at: string;
  result: string;
  summary: string;
  conditions: Array<{
    name: string;
    expected: string;
    actual: string;
    result: string;
  }>;
}

function describeRule(rule: BackendRule, index: number, policyId: string): Policy['rules'][number] {
  const id = rule.id ?? `${policyId}-rule-${index}`;
  const action = rule.action ?? 'block';

  if (rule.type === 'pii_filter') {
    const patterns = rule.patterns?.length ? rule.patterns : ['ssn', 'credit_card'];
    return {
      id,
      name: rule.message ?? 'PII filter',
      description: `Blocks payloads containing ${patterns.join(', ')}.`,
      condition: `payload contains ${patterns.join(' or ')}`,
      action,
    };
  }

  if (rule.type === 'threshold') {
    const expression = `${rule.field ?? 'value'} ${rule.operator ?? '<='} ${JSON.stringify(rule.value)}`;
    return {
      id,
      name: rule.message ?? `Threshold · ${rule.field ?? 'value'}`,
      description: `Requires ${expression}.`,
      condition: expression,
      action,
    };
  }

  if (rule.type === 'blocked_tools') {
    const tools = rule.tools ?? [];
    return {
      id,
      name: rule.message ?? 'Blocked tools',
      description: tools.length ? `Prohibits calls to ${tools.join(', ')}.` : 'Prohibits configured tools.',
      condition: `tool_name in ${JSON.stringify(tools)}`,
      action,
    };
  }

  if (rule.field) {
    const expression = `${rule.field} ${rule.operator ?? '=='} ${JSON.stringify(rule.value)}`;
    return {
      id,
      name: rule.message ?? `Rule ${index + 1}`,
      description: expression,
      condition: expression,
      action,
    };
  }

  return {
    id,
    name: rule.message ?? rule.type ?? `Rule ${index + 1}`,
    description: rule.type ? `Custom ${rule.type.replace(/_/g, ' ')} rule.` : JSON.stringify(rule),
    condition: rule.type ?? 'custom rule',
    action,
  };
}

function toPolicy(p: BackendPolicy): Policy {
  // Backend stores rules as a JSON blob; normalize to array for the frontend
  const rawRules: BackendRule[] = Array.isArray(p.rules)
    ? (p.rules as BackendRule[])
    : ((p.rules?.['rules'] as BackendRule[] | undefined) ?? []);

  const now = new Date().toISOString();
  const effectiveFrom = p.effective_from || p.created_at || now;
  const isExpired = p.effective_to ? new Date(p.effective_to) < new Date() : false;
  const computedStatus = p.status || (isExpired ? 'inactive' : 'active');

  return {
    id: p.id,
    name: p.name,
    version: p.version,
    status: computedStatus,
    description: p.description ?? '',
    policy_type: 'governance',
    effective_from: effectiveFrom,
    effective_to: p.effective_to ?? null,
    created_at: p.created_at || now,
    updated_at: p.updated_at ?? p.created_at ?? now,
    rules: rawRules.map((rule, index) => describeRule(rule, index, p.id)),
  };
}

function toEvaluation(e: BackendPolicyEvaluation): PolicyEvaluation {
  return {
    id: e.id,
    policy_id: e.policy_id,
    policy_version: e.policy_version,
    decision_id: e.decision_id,
    evaluated_at: e.evaluated_at,
    result: e.result,
    summary: e.summary,
    conditions: e.conditions ?? [],
  };
}

export async function getPolicies(): Promise<Policy[]> {
  const results = await api.get<BackendPolicy[]>('/policies?active_only=false');
  return results.map(toPolicy);
}

export async function getPolicyById(policyId: string): Promise<Policy | null> {
  try {
    const p = await api.get<BackendPolicy>(`/policies/${policyId}`);
    return toPolicy(p);
  } catch (cause) {
    if (isNotFound(cause)) return null;
    throw cause;
  }
}

export async function getPolicyEvaluations(policyId: string): Promise<PolicyEvaluation[]> {
  const results = await api.get<BackendPolicyEvaluation[]>(`/policies/${policyId}/evaluations?limit=100`);
  return results.map(toEvaluation);
}

export async function getEvaluationsForDecision(decisionId: string): Promise<PolicyEvaluation[]> {
  const results = await api.get<BackendPolicyEvaluation[]>(`/decisions/${decisionId}/evaluations?limit=100`);
  return results.map(toEvaluation);
}
