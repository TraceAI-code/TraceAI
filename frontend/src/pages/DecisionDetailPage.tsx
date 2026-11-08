import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowLeft,
  AlertTriangle,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleDot,
  ClipboardList,
  Clock3,
  FileSearch,
  Fingerprint,
  LoaderCircle,
  LockKeyhole,
  Scale,
  Sparkles,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { AuditEvent, DecisionDetail } from '../types/decisionDetail';
import type { Policy, PolicyEvaluation } from '../types/policy';
import type { IntegrityInfo } from '../types/integrity';
import type { ReviewAction, ReviewActionKind } from '../types/review';
import { getDecisionDetail } from '../services/decisionDetailService';
import { getEvaluationsForDecision, getPolicyById } from '../services/policyService';
import { getIntegrityForDecision } from '../services/integrityService';
import { getReviewsForDecision, getReviewerId, submitReview } from '../services/reviewService';

const eventPresentation: Record<string, { title: string; description: string; icon: LucideIcon }> = {
  INPUT_RECEIVED: {
    title: 'Input received',
    description: 'The initial request and decision inputs were recorded.',
    icon: ClipboardList,
  },
  CONTEXT_CAPTURED: {
    title: 'Context captured',
    description: 'Relevant context available to the agent was captured.',
    icon: Waypoints,
  },
  EVIDENCE_RETRIEVED: {
    title: 'Evidence retrieved',
    description: 'Supporting material was retrieved and associated with this decision.',
    icon: FileSearch,
  },
  POLICY_EVALUATED: {
    title: 'Policy evaluated',
    description: 'The decision payload was checked against a governance policy.',
    icon: Scale,
  },
  DECISION_MADE: {
    title: 'Decision made',
    description: 'The agent recorded its decision and rationale.',
    icon: BrainCircuit,
  },
  ACTION_EXECUTED: {
    title: 'Action executed',
    description: 'A workflow action was recorded for this decision.',
    icon: Sparkles,
  },
  OUTCOME_RECORDED: {
    title: 'Outcome recorded',
    description: 'The resulting state or next step was recorded.',
    icon: Check,
  },
};

function humanize(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid timestamp';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function statusStyle(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes('reject') || normalized === 'failed') return 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300';
  if (normalized.includes('requested_review') || normalized.includes('overridden') || normalized.includes('violat') || normalized === 'chain_warning') return 'border-amber-400/20 bg-amber-400/[0.08] text-amber-300';
  if (normalized === 'reviewed_approved' || normalized === 'reviewed_commented' || normalized === 'approved' || normalized === 'passed' || normalized === 'chain_intact') {
    return 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300';
  }
  if (normalized === 'created' || normalized === 'running' || normalized === 'verification_available') {
    return 'border-sky-400/20 bg-sky-400/[0.08] text-sky-300';
  }
  return 'border-slate-500/25 bg-slate-500/[0.08] text-slate-300';
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex border px-2 py-1 text-[10px] font-medium leading-none ${statusStyle(status)}`}>
      {humanize(status)}
    </span>
  );
}

function EventItem({ event, expanded, onToggle }: { event: AuditEvent; expanded: boolean; onToggle: () => void }) {
  const presentation = eventPresentation[event.event_type] ?? {
    title: humanize(event.event_type),
    description: 'An additional audit event was recorded.',
    icon: CircleDot,
  };
  const Icon = presentation.icon;
  const detailsId = `event-details-${event.id}`;

  return (
    <li className="relative pb-4 pl-9 last:pb-0 sm:pl-10">
      <span className="absolute -left-[15px] top-3.5 flex h-7 w-7 items-center justify-center border border-line bg-[#0b1017] text-slate-400 sm:-left-[17px] sm:h-8 sm:w-8">
        <Icon size={14} strokeWidth={1.7} />
      </span>
      <article className="border border-line bg-panel">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} event ${event.sequence}: ${presentation.title}`}
          onClick={onToggle}
          className="flex w-full items-start justify-between gap-3 px-3.5 py-3 text-left outline-none hover:bg-white/[0.02] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/50 sm:gap-4 sm:px-4 sm:py-3.5"
        >
          <span className="min-w-0">
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-mono text-[10px] tabular-nums text-slate-500">#{event.sequence}</span>
              <span className="text-[13px] font-medium text-slate-200">{presentation.title}</span>
              <span className="font-mono text-[9px] uppercase tracking-wider text-slate-500">{event.event_type}</span>
            </span>
            <span className="mt-1 block text-[11px] leading-5 text-muted">{presentation.description}</span>
            <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><Clock3 size={11} />{formatTimestamp(event.timestamp)}</span>
              <span>Actor: <span className="font-mono text-slate-400">{event.actor}</span></span>
            </span>
          </span>
          <span className="flex shrink-0 items-center pt-0.5">
            <ChevronDown size={15} className={`text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {expanded && (
          <div id={detailsId} className="border-t border-line px-4 py-4 sm:px-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Event payload</h3>
              <span className="font-mono text-[9px] text-slate-600">JSON</span>
            </div>
            <pre className="max-h-80 overflow-auto border border-line bg-shell p-3 font-mono text-[10px] leading-5 text-slate-300 [overflow-wrap:anywhere] sm:text-[11px]">{JSON.stringify(event.payload, null, 2)}</pre>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <HashValue label="Event hash" value={event.hash} />
              <HashValue label="Previous hash" value={event.previous_hash} />
            </div>
          </div>
        )}
      </article>
    </li>
  );
}

function HashValue({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">{label}</p>
      <p className="break-all font-mono text-[9px] leading-4 text-slate-500">{value ?? '—'}</p>
    </div>
  );
}

function SupportingPanel({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="border border-line bg-panel">
      <div className="flex min-h-11 items-center gap-2 border-b border-line px-4 py-3">
        <Icon size={14} className="shrink-0 text-slate-500" />
        <h2 className="text-xs font-medium text-slate-300">{title}</h2>
      </div>
      <div className="min-w-0 px-4 py-3.5">{children}</div>
    </section>
  );
}

function ReviewPanel({ decisionId }: { decisionId: string }) {
  const [reviews, setReviews] = useState<ReviewAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<ReviewActionKind | ''>('');
  const [comment, setComment] = useState('');
  const [reviewerId, setReviewerIdState] = useState(() => getReviewerId() ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getReviewsForDecision(decisionId)
      .then((items) => { if (active) setReviews(items); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load review history.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [decisionId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError(null);
    setSubmitted(false);
    if (!action) {
      setValidationError('Choose a review action before submitting.');
      return;
    }
    if (!reviewerId.trim()) {
      setValidationError('Enter your reviewer identity before submitting.');
      return;
    }
    if ((action === 'REJECTED' || action === 'OVERRIDDEN' || action === 'REQUESTED_REVIEW') && !comment.trim()) {
      setValidationError('A comment is required for Reject, Override, and Request review actions.');
      return;
    }

    setSubmitting(true);
    try {
      const review = await submitReview({
        decision_id: decisionId,
        action,
        comment: comment || null,
        reviewer_id: reviewerId,
      });
      setReviews((current) => [review, ...current].sort((a, b) => b.created_at.localeCompare(a.created_at)));
      setAction('');
      setComment('');
      setSubmitted(true);
    } catch (cause) {
      setValidationError(cause instanceof Error ? cause.message : 'The review could not be recorded.');
    } finally {
      setSubmitting(false);
    }
  };

  const latestReview = reviews[0];

  return (
    <SupportingPanel title="Human review" icon={ClipboardList}>
      {loading ? <p role="status" className="text-[11px] text-slate-500">Loading review history…</p> : error ? (
        <p role="alert" className="text-[11px] text-rose-300">Could not load reviews: {error}</p>
      ) : latestReview ? (
        <>
          <div className="border-b border-line pb-3">
            <p className="mb-2 text-[9px] font-medium uppercase tracking-wider text-slate-600">Current / latest review</p>
            <div className="flex flex-wrap items-center justify-between gap-2"><StatusBadge status={latestReview.action} /><span className="text-[10px] text-slate-500">{formatTimestamp(latestReview.created_at)}</span></div>
            <p className="mt-2 text-[10px] text-slate-500">Reviewer <span className="font-mono text-slate-300">{latestReview.reviewer}</span></p>
            <p className="mt-2 text-[11px] leading-5 text-slate-300">{latestReview.comment || 'No comment recorded.'}</p>
          </div>
          <details className="group mt-3" open={reviews.length > 1}>
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] text-slate-400 outline-none hover:text-slate-200 focus-visible:ring-1 focus-visible:ring-accent/50"><ChevronDown size={12} className="transition-transform group-open:rotate-180" />Review history <span className="font-mono text-slate-600">{reviews.length}</span></summary>
            <ol className="mt-3 space-y-3 border-l border-line pl-3">
              {reviews.slice(1).map((review) => (
                <li key={review.id} className="relative">
                  <div className="flex flex-wrap items-center justify-between gap-2"><StatusBadge status={review.action} /><span className="text-[9px] text-slate-600">{formatTimestamp(review.created_at)}</span></div>
                  <p className="mt-1.5 text-[10px] text-slate-500">{review.reviewer}</p>
                  <p className="mt-1 text-[10px] leading-4 text-slate-400">{review.comment || 'No comment recorded.'}</p>
                </li>
              ))}
              {reviews.length === 1 && <li className="text-[10px] leading-4 text-slate-600">No earlier review actions.</li>}
            </ol>
          </details>
        </>
      ) : <p className="mb-4 text-[11px] text-slate-500">No human review recorded.</p>}

      {!loading && !error && (
        <form onSubmit={handleSubmit} className="mt-4 border-t border-line pt-4">
          <p className="mb-3 text-[10px] font-medium uppercase tracking-wider text-slate-500">Record a reviewer decision</p>
          <label className="mb-3 block text-[10px] text-slate-500">Reviewer identity
            <input
              value={reviewerId}
              onChange={(event) => { setReviewerIdState(event.target.value); setValidationError(null); }}
              placeholder="e.g. jane.doe@company.com"
              autoComplete="username"
              className="mt-1.5 h-10 w-full border border-line bg-shell px-3 text-xs text-slate-300 outline-none placeholder:text-slate-600 focus:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/30 sm:h-9"
            />
            <span className="mt-1 block text-[9px] leading-4 text-slate-600">Stored in this browser; override with VITE_REVIEWER_ID. Reviews are attributed to this identity.</span>
          </label>
          <label className="mb-3 block text-[10px] text-slate-500">Review action
            <select value={action} onChange={(event) => { setAction(event.target.value as ReviewActionKind | ''); setValidationError(null); }} className="mt-1.5 h-10 w-full border border-line bg-shell px-3 text-xs text-slate-300 outline-none focus:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/30 sm:h-9">
              <option value="">Choose an action</option>
              <option value="APPROVED">Approve</option>
              <option value="REJECTED">Reject</option>
              <option value="OVERRIDDEN">Override</option>
              <option value="REQUESTED_REVIEW">Request review</option>
              <option value="COMMENTED">Comment</option>
            </select>
          </label>
          <label className="block text-[10px] text-slate-500">Comment {(action === 'REJECTED' || action === 'OVERRIDDEN' || action === 'REQUESTED_REVIEW') && <span className="text-rose-300">· required</span>}
            <textarea value={comment} onChange={(event) => { setComment(event.target.value); setValidationError(null); }} rows={3} maxLength={500} placeholder="Add reviewer context…" className="mt-1.5 w-full resize-y border border-line bg-shell px-3 py-2 text-xs leading-5 text-slate-300 outline-none placeholder:text-slate-600 focus:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/30" />
          </label>
          {validationError && <p role="alert" className="mt-2 text-[10px] text-rose-300">{validationError}</p>}
          {submitted && <p role="status" className="mt-2 text-[10px] text-emerald-300/80">Review recorded in the audit trail.</p>}
          <button type="submit" disabled={submitting} className="mt-3 inline-flex min-h-10 items-center gap-2 border border-line px-3 text-[11px] text-slate-300 outline-none hover:border-slate-600 hover:text-white focus-visible:ring-1 focus-visible:ring-accent/50 disabled:opacity-50">
            {submitting ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}Submit review
          </button>
        </form>
      )}
    </SupportingPanel>
  );
}

function truncateHash(hash: string | null): string {
  if (!hash) return '—';
  return hash.length > 24 ? `${hash.slice(0, 12)}…${hash.slice(-8)}` : hash;
}

function IntegrityPanel({ decisionId }: { decisionId: string }) {
  const [integrity, setIntegrity] = useState<IntegrityInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getIntegrityForDecision(decisionId)
      .then((info) => { if (active) setIntegrity(info); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load integrity information.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [decisionId]);

  return (
    <SupportingPanel title="Audit integrity" icon={Fingerprint}>
      {loading ? <p role="status" className="text-[11px] text-slate-500">Loading integrity information…</p> : error ? (
        <p role="alert" className="text-[11px] text-rose-300">Could not load integrity information: {error}</p>
      ) : integrity ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500">Chain status</span><StatusBadge status={integrity.chain_status} />
          </div>
          {integrity.chain_status === 'CHAIN_WARNING' && <p className="mb-3 flex items-start gap-2 text-[10px] leading-4 text-amber-200/80"><AlertTriangle size={12} className="mt-0.5 shrink-0" />The backend reports a chain warning; this frontend has not independently checked it.</p>}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-3 border-b border-line pb-3">
            <div><dt className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Event count</dt><dd className="font-mono text-xs text-slate-300">{integrity.event_count}</dd></div>
            <div><dt className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Events hashed</dt><dd className="font-mono text-xs text-slate-300">{integrity.events_hashed}</dd></div>
            <div><dt className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Algorithm</dt><dd className="font-mono text-[10px] text-slate-400">{integrity.hash_algorithm ?? '—'}</dd></div>
            <div className="min-w-0"><dt className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Verification status</dt><dd><StatusBadge status={integrity.verification_status} /></dd></div>
          </dl>
          <div className="mt-3"><p className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Root hash</p><p className="break-all font-mono text-[10px] text-slate-400" title={integrity.root_hash ?? undefined}>{truncateHash(integrity.root_hash)}</p></div>
          <p className="mt-3 text-[9px] leading-4 text-slate-500">The chain status reflects the supplied audit record. Hashes are displayed for inspection; this frontend does not independently recompute or verify them.</p>
          <details className="group mt-3 border-t border-line pt-3">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] text-slate-400 outline-none hover:text-slate-200"><ChevronDown size={12} className="transition-transform group-open:rotate-180" />Inspect integrity chain <span className="font-mono text-slate-600">{integrity.events.length} records</span></summary>
            <div className="mt-3 space-y-3">
              <HashValue label="Full root hash" value={integrity.root_hash} />
              {integrity.events.slice().sort((a, b) => a.sequence - b.sequence).map((event) => (
                <div key={event.event_id} className="min-w-0 border-l border-line pl-3">
                  <p className="text-[9px] uppercase tracking-wider text-slate-600">Sequence {event.sequence} · Event type</p>
                  <p className="mt-1 text-[10px] font-medium text-slate-300">{humanize(event.event_type)}</p>
                  <div className="mt-2"><HashValue label="Event ID" value={event.event_id} /></div>
                  <div className="mt-2 space-y-2"><HashValue label="Event hash" value={event.hash} /><HashValue label="Previous hash" value={event.previous_hash} /></div>
                </div>
              ))}
              {integrity.last_verified_at && <p className="text-[9px] text-slate-600">Source last-verified timestamp: {formatTimestamp(integrity.last_verified_at)}</p>}
            </div>
          </details>
        </>
      ) : (
        <div className="flex items-start gap-2 text-[11px] leading-5 text-slate-500"><LockKeyhole size={13} className="mt-0.5 shrink-0" />Integrity information is unavailable for this decision.</div>
      )}
    </SupportingPanel>
  );
}

function DecisionContent({ decision }: { decision: DecisionDetail }) {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(() => new Set());
  const [policyEvaluations, setPolicyEvaluations] = useState<Array<{ evaluation: PolicyEvaluation; policy: Policy | null }>>([]);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyError, setPolicyError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setPolicyLoading(true);
    setPolicyError(null);
    getEvaluationsForDecision(decision.id)
      .then((evaluations) => Promise.all(evaluations.map(async (evaluation) => ({
        evaluation,
        policy: await getPolicyById(evaluation.policy_id),
      }))))
      .then((items) => { if (active) setPolicyEvaluations(items); })
      .catch((cause: unknown) => { if (active) setPolicyError(cause instanceof Error ? cause.message : 'An unexpected error occurred.'); })
      .finally(() => { if (active) setPolicyLoading(false); });
    return () => { active = false; };
  }, [decision.id]);
  const orderedEvents = useMemo(
    () => [...decision.events].sort((a, b) => a.sequence - b.sequence),
    [decision.events],
  );

  const toggleEvent = (eventId: string) => {
    setExpandedEvents((current) => {
      const next = new Set(current);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  return (
    <>
      <div className="mb-5 flex flex-col justify-between gap-3 border-b border-line pb-5 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-accent/80">Decision / Audit detail</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">Decision audit trail</h1>
            <StatusBadge status={decision.status} />
          </div>
          <p className="mt-2 break-all font-mono text-[11px] leading-5 text-slate-400">{decision.id}</p>
          <p className="mt-1 text-[10px] text-slate-500"><span className="font-medium text-slate-300">{decision.agent_id}</span><span className="mx-1.5 text-slate-700">·</span>version <span className="font-mono text-slate-400">{decision.agent_version}</span></p>
        </div>
        <Link to={`/audit-reports/${decision.id}`} className="inline-flex min-h-9 w-fit shrink-0 items-center gap-2 border border-line px-3 text-xs text-slate-400 outline-none hover:border-slate-600 hover:text-slate-100 focus-visible:ring-1 focus-visible:ring-accent/50">
          <Fingerprint size={13} /> View Audit Report
        </Link>
      </div>

      <section className="mb-5 border border-line bg-panel">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <MetadataItem label="Agent" value={decision.agent_id} />
          <MetadataItem label="Agent version" value={decision.agent_version} mono />
          <MetadataItem label="Created" value={formatTimestamp(decision.created_at)} />
          <MetadataItem label="Event count" value={String(decision.event_count)} mono />
        </div>
      </section>

      <section className="mb-6 border border-line bg-panel px-4 py-4 sm:px-5 sm:py-5">
        <div className="mb-3 flex items-center gap-2">
          <BrainCircuit size={15} className="text-accent/80" />
          <h2 className="text-sm font-semibold text-slate-200">Decision summary</h2>
        </div>
        <p className="text-[14px] leading-6 text-slate-200 sm:text-[15px]">{decision.decision_summary}</p>
        <div className="mt-4 grid gap-x-5 gap-y-2 border-t border-line pt-3 text-[10px] sm:grid-cols-3 sm:gap-y-0 sm:text-[11px]">
          <span>Agent <span className="ml-1 font-mono text-slate-300">{decision.agent_id}</span></span>
          <span>Status <span className="ml-1 text-slate-300">{humanize(decision.status)}</span></span>
          <span>Decision time <span className="ml-1 text-slate-300">{formatTimestamp(decision.created_at)}</span></span>
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-6">
        <section className="min-w-0">
          <div className="mb-3 flex items-end justify-between gap-3 sm:mb-4">
            <div>
              <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-accent/70">Ordered event record</p>
              <h2 className="text-base font-semibold text-slate-100">Audit timeline</h2>
            </div>
            <span className="text-[10px] text-slate-500">{orderedEvents.length} events</span>
          </div>
          {orderedEvents.length > 0 ? (
            <ol className="ml-3 border-l border-line sm:ml-4">
              {orderedEvents.map((event) => (
                <EventItem
                  key={event.id}
                  event={event}
                  expanded={expandedEvents.has(event.id)}
                  onToggle={() => toggleEvent(event.id)}
                />
              ))}
            </ol>
          ) : (
            <div className="border border-line bg-panel px-5 py-8 text-sm text-muted">No audit events are available for this decision.</div>
          )}
        </section>

        <aside className="space-y-3">
          <SupportingPanel title="Evidence" icon={FileSearch}>
            {decision.evidence.length ? (
              <ul className="space-y-3">
                {decision.evidence.map((item) => (
                  <li key={item.id} className="min-w-0 border-b border-line/70 pb-3 last:border-0 last:pb-0">
                    <Link to={`/evidence/${item.id}`} className="block outline-none hover:text-blue-200 focus-visible:text-blue-200 focus-visible:ring-1 focus-visible:ring-accent/50">
                      <p className="text-xs font-medium text-slate-300">{humanize(item.type)}</p>
                      <p className="mt-1 text-[9px] uppercase tracking-wider text-slate-600">Evidence type</p>
                      <p className="mt-1 text-[10px] text-slate-500">Role · <span className="text-slate-400">{humanize(item.role)}</span></p>
                      <p className="mt-1 break-all font-mono text-[9px] text-blue-300/70">{item.id}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px] text-slate-500">No evidence is linked to this decision.</p>}
            <p className="mt-3 border-t border-line pt-2.5 text-[10px] leading-4 text-slate-600">Open a linked record to inspect its stored evidence details.</p>
          </SupportingPanel>

          <SupportingPanel title="Policy" icon={Scale}>
            {policyLoading ? <p className="text-[11px] text-slate-500">Loading policy evaluations…</p> : policyError ? (
              <p role="alert" className="text-[11px] text-rose-300">Could not load policy evaluations: {policyError}</p>
            ) : policyEvaluations.length ? (
              <ul className="space-y-3">
                {policyEvaluations.map(({ evaluation, policy }) => (
                  <li key={evaluation.id} className="border-b border-line/70 pb-3 last:border-0 last:pb-0">
                    <Link to={`/policies/${evaluation.policy_id}`} className="block outline-none hover:text-blue-200 focus-visible:text-blue-200 focus-visible:ring-1 focus-visible:ring-accent/50">
                      <p className="text-xs font-medium text-slate-300">{policy?.name ?? 'Policy record unavailable'}</p>
                      <p className="mt-1 break-all font-mono text-[9px] text-blue-300/70">{evaluation.policy_id}</p>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                        <span>Version {evaluation.policy_version}</span>
                        <StatusBadge status={evaluation.result} />
                      </div>
                      <p className="mt-2 border-l border-line pl-2.5 text-[10px] leading-4 text-slate-400"><span className="mb-1 block text-[9px] uppercase tracking-wider text-slate-600">Evaluation summary</span>{evaluation.summary}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px] text-slate-500">No policy evaluation recorded.</p>}
          </SupportingPanel>

          <ReviewPanel decisionId={decision.id} />
          <IntegrityPanel decisionId={decision.id} />
        </aside>
      </div>
    </>
  );
}

function MetadataItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 border-b border-line px-4 py-3 last:border-b-0 sm:px-5 sm:py-3.5 sm:odd:border-r sm:[&:nth-child(n+3)]:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0">
      <p className="text-[9px] uppercase tracking-wider text-slate-600">{label}</p>
      <p className={`mt-1.5 break-words text-xs font-medium text-slate-200 ${mono ? 'font-mono' : ''}`} title={value}>{value}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div role="status" className="flex items-center gap-3 border border-line bg-panel px-5 py-8 text-sm text-slate-400">
      <LoaderCircle size={17} className="animate-spin text-accent" /> Loading decision detail…
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="border border-rose-400/20 bg-rose-400/[0.04] px-5 py-6">
      <h1 className="text-sm font-medium text-rose-200">Could not load decision</h1>
      <p className="mt-1 text-xs text-slate-400">{message}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 border border-line px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white">Retry</button>
        <Link to="/decisions" className="inline-flex items-center gap-2 text-xs text-slate-300 hover:text-white"><ArrowLeft size={13} /> Back to decisions</Link>
      </div>
    </div>
  );
}

function NotFoundState() {
  return (
    <div className="border border-line bg-panel px-6 py-10 text-center">
      <CircleDot size={20} className="mx-auto text-slate-500" />
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">404 / DECISION_NOT_FOUND</p>
      <h1 className="mt-2 text-lg font-semibold text-slate-100">Decision not found</h1>
      <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted">This ID is not present in the decision register.</p>
      <Link to="/decisions" className="mt-5 inline-flex items-center gap-2 border border-line px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white">
        <ArrowLeft size={13} /> Back to decisions
      </Link>
    </div>
  );
}

export default function DecisionDetailPage() {
  const { decisionId = '' } = useParams<{ decisionId: string }>();
  const [decision, setDecision] = useState<DecisionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setDecision(null);

    getDecisionDetail(decisionId)
      .then((detail) => {
        if (active) setDecision(detail);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'An unexpected error occurred.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [decisionId, reloadKey]);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link to="/decisions" className="inline-flex items-center gap-2 text-xs text-slate-400 outline-none hover:text-slate-100 focus-visible:ring-1 focus-visible:ring-accent/50">
          <ArrowLeft size={14} /> Back to decisions
        </Link>
        <span className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live audit trace
        </span>
      </div>
      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => setReloadKey((current) => current + 1)} /> : decision ? <DecisionContent key={decision.id} decision={decision} /> : <NotFoundState />}
    </>
  );
}
