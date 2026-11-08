import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpenText, ChevronDown, Clock3, LoaderCircle, Scale, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { Policy, PolicyEvaluation } from '../types/policy';
import { getPolicyById, getPolicyEvaluations } from '../services/policyService';

function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function resultStyle(result: string): string {
  switch (result.toUpperCase()) {
    case 'ACTIVE':
    case 'PASSED': return 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300';
    case 'FAILED': return 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300';
    case 'OVERRIDDEN': return 'border-amber-400/20 bg-amber-400/[0.08] text-amber-300';
    case 'INACTIVE': return 'border-amber-400/20 bg-amber-400/[0.08] text-amber-300';
    case 'NOT_APPLICABLE':
    case 'ARCHIVED': return 'border-slate-500/25 bg-slate-500/[0.08] text-slate-400';
    default: return 'border-slate-500/25 bg-slate-500/[0.08] text-slate-300';
  }
}

function ResultBadge({ result }: { result: string }) {
  return <span className={`inline-flex whitespace-nowrap border px-2 py-1 text-[10px] font-medium leading-none ${resultStyle(result)}`}>{humanize(result)}</span>;
}

function MetadataField({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1.5 text-[9px] uppercase tracking-wider text-slate-600">{label}</dt>
      <dd className={`break-words text-xs text-slate-300 ${mono ? 'font-mono' : ''}`}>{value || '—'}</dd>
    </div>
  );
}

function PolicyRules({ rules }: { rules: Policy['rules'] }) {
  return (
    <section className="border border-line bg-panel">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2"><Scale size={14} className="text-slate-500" /><h2 className="text-xs font-medium text-slate-300">Policy rules</h2></div>
        <span className="font-mono text-[10px] text-slate-500">{rules.length} defined</span>
      </div>
      {rules.length ? (
        <ol className="divide-y divide-line/70">
          {rules.map((rule, index) => (
            <li key={rule.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[32px_minmax(0,1fr)] sm:px-5">
              <span className="font-mono text-[10px] text-slate-600">{String(index + 1).padStart(2, '0')}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-sm font-medium text-slate-200">{rule.name}</h3><span className="break-all font-mono text-[9px] text-slate-600">{rule.id}</span></div>
                <p className="mt-1.5 text-xs leading-5 text-muted">{rule.description}</p>
                <dl className="mt-3 grid gap-3 border-l border-line pl-3 sm:grid-cols-2">
                  <div><dt className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Condition</dt><dd className="break-words font-mono text-[10px] leading-4 text-slate-300">{rule.condition}</dd></div>
                  <div><dt className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Action</dt><dd className="text-[10px] leading-4 text-slate-400">{rule.action}</dd></div>
                </dl>
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="px-5 py-6 text-xs text-slate-500">No rules are defined for this policy version.</p>}
    </section>
  );
}

function EvaluationEntry({ evaluation }: { evaluation: PolicyEvaluation }) {
  return (
    <li className="border-b border-line/70 last:border-b-0">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <p className="break-all font-mono text-[10px] text-slate-500">{evaluation.id}</p>
          <Link to={`/decisions/${evaluation.decision_id}`} className="mt-2 inline-flex items-center gap-1.5 break-all font-mono text-[11px] text-blue-300/90 outline-none hover:text-blue-200 focus-visible:ring-1 focus-visible:ring-accent/50">Decision {evaluation.decision_id}</Link>
          <p className="mt-1 text-[10px] text-slate-500">Policy version <span className="font-mono text-slate-400">{evaluation.policy_version}</span></p>
        </div>
        <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
          <ResultBadge result={evaluation.result} />
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[10px] text-slate-500"><Clock3 size={11} />{formatTimestamp(evaluation.evaluated_at)}</span>
        </div>
      </div>
      <div className="px-4 pb-4 sm:px-5">
        <p className="text-xs leading-5 text-slate-400">{evaluation.summary}</p>
        {evaluation.conditions.length > 0 && (
          <details className="group mt-3 border-t border-line/70 pt-3">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] text-slate-500 outline-none hover:text-slate-300 focus-visible:text-slate-200">
              <ChevronDown size={12} className="transition-transform group-open:rotate-180" />Condition results ({evaluation.conditions.length})
            </summary>
            <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {evaluation.conditions.map((condition) => (
                <div key={condition.name} className="grid min-w-0 gap-x-3 gap-y-2 border border-line/70 bg-shell/50 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-center">
                  <div className="min-w-0"><dt className="text-[9px] uppercase tracking-wider text-slate-600">Condition</dt><dd className="mt-1 break-words text-[10px] text-slate-300">{condition.name}</dd></div>
                  <div className="min-w-0"><dt className="text-[9px] uppercase tracking-wider text-slate-600">Expected</dt><dd className="mt-1 break-words font-mono text-[10px] text-slate-400">{condition.expected}</dd></div>
                  <div className="min-w-0"><dt className="text-[9px] uppercase tracking-wider text-slate-600">Actual</dt><dd className="mt-1 break-words font-mono text-[10px] text-slate-400">{condition.actual}</dd></div>
                  <div className="sm:col-span-2 xl:col-span-1"><dt className="mb-1 text-[9px] uppercase tracking-wider text-slate-600 xl:sr-only">Result</dt><dd><ResultBadge result={condition.result} /></dd></div>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
    </li>
  );
}

function LoadingState() {
  return <div role="status" className="flex items-center gap-3 border border-line bg-panel px-5 py-8 text-sm text-slate-400"><LoaderCircle size={17} className="animate-spin text-accent" />Loading policy…</div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="border border-rose-400/20 bg-rose-400/[0.04] px-5 py-6"><h1 className="text-sm font-medium text-rose-200">Could not load policy</h1><p className="mt-1 text-xs text-slate-400">{message}</p><div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={onRetry} className="inline-flex items-center gap-2 border border-line px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white">Retry</button><Link to="/policies" className="inline-flex items-center gap-2 text-xs text-slate-300 hover:text-white"><ArrowLeft size={13} />Back to Policy Library</Link></div></div>;
}

function NotFoundState() {
  return (
    <div className="border border-line bg-panel px-6 py-10 text-center">
      <BookOpenText size={20} className="mx-auto text-slate-500" />
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">404 / POLICY_NOT_FOUND</p>
      <h1 className="mt-2 text-lg font-semibold text-slate-100">Policy not found</h1>
      <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted">This ID is not present in the policy register.</p>
      <Link to="/policies" className="mt-5 inline-flex items-center gap-2 border border-line px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white"><ArrowLeft size={13} />Back to Policy Library</Link>
    </div>
  );
}

export default function PolicyDetailPage() {
  const { policyId = '' } = useParams<{ policyId: string }>();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [evaluations, setEvaluations] = useState<PolicyEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPolicy(null);
    setEvaluations([]);

    Promise.all([getPolicyById(policyId), getPolicyEvaluations(policyId)])
      .then(([policyRecord, evaluationRecords]) => {
        if (active) {
          setPolicy(policyRecord);
          setEvaluations(evaluationRecords);
        }
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'An unexpected error occurred.'); })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [policyId, reloadKey]);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link to="/policies" className="inline-flex items-center gap-2 text-xs text-slate-400 outline-none hover:text-slate-100 focus-visible:ring-1 focus-visible:ring-accent/50"><ArrowLeft size={14} />Back to Policy Library</Link>
        <span className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Live policy definition</span>
      </div>
      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => setReloadKey((current) => current + 1)} /> : policy ? (
        <>
          <div className="mb-6 flex flex-col justify-between gap-4 border-b border-line pb-6 sm:flex-row sm:items-start">
            <div className="min-w-0">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-accent/80">Governance / Policy detail</p>
              <div className="flex flex-wrap items-center gap-3"><h1 className="text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">{policy.name}</h1><ResultBadge result={policy.status} /></div>
              <p className="mt-2 break-all font-mono text-[10px] leading-5 text-slate-400">{policy.id}</p>
              <p className="mt-1 text-[10px] text-slate-500">Policy version <span className="font-mono text-slate-300">{policy.version}</span><span className="mx-1.5 text-slate-700">·</span>{humanize(policy.policy_type)}</p>
            </div>
            <span className="inline-flex items-center gap-2 border border-line bg-panel px-3 py-2 font-mono text-xs text-slate-300"><BookOpenText size={14} className="text-slate-500" />v{policy.version}</span>
          </div>

          <section className="mb-6 border border-line bg-panel px-4 py-4 sm:px-5">
            <div className="mb-4 flex items-center gap-2"><ShieldCheck size={14} className="text-slate-500" /><h2 className="text-xs font-medium text-slate-300">Policy information</h2></div>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetadataField label="Policy ID" value={policy.id} mono />
              <MetadataField label="Policy name" value={policy.name} />
              <MetadataField label="Version" value={policy.version} mono />
              <MetadataField label="Type" value={humanize(policy.policy_type)} />
              <MetadataField label="Status" value={humanize(policy.status)} />
              <MetadataField label="Created" value={formatTimestamp(policy.created_at)} />
              <MetadataField label="Updated" value={formatTimestamp(policy.updated_at)} />
              <MetadataField label="Effective from" value={formatTimestamp(policy.effective_from)} />
              <MetadataField label="Effective to" value={formatTimestamp(policy.effective_to)} />
            </dl>
            <div className="mt-4 border-t border-line pt-4"><p className="mb-1.5 text-[9px] uppercase tracking-wider text-slate-600">Description</p><p className="text-xs leading-5 text-slate-300">{policy.description}</p></div>
          </section>

          <div className="mb-6"><PolicyRules rules={policy.rules} /></div>

          <section className="border border-line bg-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
              <div><p className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-accent/70">Decision relationship</p><h2 className="text-xs font-medium text-slate-300">Evaluation history</h2></div>
              <span className="font-mono text-[10px] text-slate-500">{evaluations.length} evaluations</span>
            </div>
            {evaluations.length ? <ul>{evaluations.map((evaluation) => <EvaluationEntry key={evaluation.id} evaluation={evaluation} />)}</ul> : <p className="px-5 py-7 text-xs text-slate-500">No recorded evaluations reference this policy yet.</p>}
          </section>
        </>
      ) : <NotFoundState />}
    </>
  );
}
