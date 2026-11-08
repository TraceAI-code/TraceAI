import { api, isNotFound } from './apiClient';
import type { IntegrityInfo } from '../types/integrity';

interface BackendIntegrity {
  valid: boolean;
  event_count?: number;
  root_hash?: string | null;
  reason?: string;
  event_id?: string;
  sequence_number?: number;
}

export async function getIntegrityForDecision(decisionId: string): Promise<IntegrityInfo | null> {
  try {
    const r = await api.get<BackendIntegrity>(`/decisions/${decisionId}/integrity`);
    return {
      decision_id: decisionId,
      root_hash: r.root_hash ?? null,
      event_count: r.event_count ?? 0,
      events_hashed: r.event_count ?? 0,
      hash_algorithm: 'SHA-256',
      chain_status: r.valid ? 'VALID' : 'COMPROMISED',
      verification_status: r.valid ? 'VERIFIED' : 'FAILED',
      last_verified_at: new Date().toISOString(),
      events: [],
    };
  } catch (cause) {
    if (isNotFound(cause)) return null;
    throw cause;
  }
}
