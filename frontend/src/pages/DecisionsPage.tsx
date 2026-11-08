import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, Clock3, LoaderCircle, Search, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { getDecisions } from '../services/decisionService';
import type { Decision } from '../types/decision';

type StatusFilter = 'all' | 'created' | 'reviewed' | 'rejected' | 'challenged' | 'other';

const statusFilters: { label: string; value: StatusFilter }[] = [
  { label: 'All statuses', value: 'all' },
  { label: 'Created', value: 'created' },
  { label: 'Reviewed', value: 'reviewed' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Challenged', value: 'challenged' },
  { label: 'Other', value: 'other' },
];

function statusGroup(status: string): Exclude<StatusFilter, 'all'> {
  const normalized = status.toLowerCase();
  if (normalized === 'created') return 'created';
  if (normalized.startsWith('reviewed')) return 'reviewed';
  if (normalized === 'rejected' || normalized.endsWith('_rejected')) return 'rejected';
  if (normalized === 'challenged' || normalized.endsWith('_challenged')) return 'challenged';
  return 'other';
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return status
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function statusClasses(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes('reject')) return 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300';
  if (normalized.includes('challeng') || normalized.includes('violat')) return 'border-amber-400/20 bg-amber-400/[0.08] text-amber-300';
  if (normalized === 'created' || normalized === 'running') return 'border-sky-400/20 bg-sky-400/[0.08] text-sky-300';
  if (normalized.includes('approved') || normalized === 'reviewed_commented') return 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300';
  return 'border-slate-500/25 bg-slate-500/[0.08] text-slate-300';
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex whitespace-nowrap border px-2 py-1 text-[10px] font-medium leading-none ${statusClasses(status)}`}>
      {statusLabel(status)}
    </span>
  );
}

function LoadingState() {
  return (
    <div role="status" className="flex items-center gap-3 border border-line bg-panel px-5 py-8 text-sm text-slate-400">
      <LoaderCircle size={17} className="animate-spin text-accent" />
      Loading decision records…
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3 border border-rose-400/20 bg-rose-400/[0.04] px-5 py-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertTriangle size={17} className="mt-0.5 shrink-0 text-rose-300" />
        <div>
          <h2 className="text-sm font-medium text-rose-200">Could not load decisions</h2>
          <p className="mt-1 text-xs text-slate-400">{message}</p>
        </div>
      </div>
      <button type="button" onClick={onRetry} className="w-fit border border-line px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white">
        Try again
      </button>
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="border border-line bg-panel px-5 py-12 text-center">
      <Search size={19} className="mx-auto text-slate-500" />
      <h2 className="mt-3 text-sm font-medium text-slate-200">No decisions found</h2>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-muted">
        {hasFilters
          ? 'No records match this search and status filter. Try changing or clearing your filters.'
          : 'There are no decision records to display.'}
      </p>
    </div>
  );
}

export default function DecisionsPage() {
  const navigate = useNavigate();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    getDecisions()
      .then((items) => {
        if (active) setDecisions(items);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'An unexpected error occurred.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reloadKey]);

  const filteredDecisions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return decisions.filter((decision) => {
      const matchesSearch =
        query.length === 0 ||
        decision.id.toLowerCase().includes(query) ||
        decision.agent_id.toLowerCase().includes(query);
      const matchesStatus = statusFilter === 'all' || statusGroup(decision.status) === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [decisions, search, statusFilter]);

  const hasFilters = search.trim().length > 0 || statusFilter !== 'all';

  return (
    <>
      <PageHeader
        eyebrow="Overview / Register"
        title="Decisions"
        description="The decision register is the entry point for inspecting an agent’s recorded inputs, events, evidence, and audit trail."
      />

      <div className="mb-4 flex flex-col gap-3 border border-line bg-panel p-3 sm:flex-row sm:items-center sm:p-4">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search by decision ID or agent ID</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search decision ID or agent ID"
            className="h-10 w-full border border-line bg-shell pl-9 pr-9 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-accent/60 focus-visible:ring-1 focus-visible:ring-accent/30 sm:h-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-200"
            >
              <X size={14} />
            </button>
          )}
        </label>
        <label className="flex w-full items-center gap-2 text-[11px] text-slate-500 sm:w-auto">
          <span className="whitespace-nowrap">Status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="h-10 min-w-0 flex-1 border border-line bg-shell px-3 text-xs text-slate-300 outline-none focus:border-accent/60 focus-visible:ring-1 focus-visible:ring-accent/30 sm:h-9 sm:min-w-36 sm:flex-none"
          >
            {statusFilters.map((filter) => (
              <option key={filter.value} value={filter.value}>{filter.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-3 flex flex-col gap-2 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <span role="status" className="font-medium text-slate-400">{loading ? 'Loading records…' : `${filteredDecisions.length} ${filteredDecisions.length === 1 ? 'record' : 'records'}`}</span>
        <span className="inline-flex items-center gap-1.5 text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Live database records
        </span>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} />
      ) : filteredDecisions.length === 0 ? (
        <EmptyState hasFilters={hasFilters} />
      ) : (
        <>
          <div className="hidden border border-line bg-panel xl:block">
            <table className="w-full min-w-[800px] border-collapse text-left">
              <thead className="border-b border-line bg-white/[0.015]">
                <tr className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-5 py-3">Decision ID</th>
                  <th scope="col" className="px-4 py-3">Agent</th>
                  <th scope="col" className="px-4 py-3">Version</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3 text-right">Events</th>
                  <th scope="col" className="px-4 py-3">Created</th>
                  <th scope="col" className="w-8 px-3 py-3"><span className="sr-only">Open decision</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {filteredDecisions.map((decision) => (
                  <tr
                    key={decision.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`Open decision ${decision.id}`}
                    onClick={() => navigate(`/decisions/${decision.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/decisions/${decision.id}`);
                      }
                    }}
                    className="group cursor-pointer text-xs text-slate-300 outline-none hover:bg-white/[0.035] focus-visible:bg-white/[0.045] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/50"
                  >
                    <td className="whitespace-nowrap px-5 py-4">
                      <Link to={`/decisions/${decision.id}`} onClick={(event) => event.stopPropagation()} className="font-mono text-[11px] text-blue-300/90 hover:text-blue-200">
                        {decision.id}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 font-medium text-slate-200">{decision.agent_id}</td>
                    <td className="whitespace-nowrap px-4 py-4 font-mono text-[11px] text-slate-400">{decision.agent_version}</td>
                    <td className="whitespace-nowrap px-4 py-4"><StatusBadge status={decision.status} /></td>
                    <td className="px-4 py-4 text-right font-mono tabular-nums text-slate-400">{decision.event_count}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-400">{formatCreatedAt(decision.created_at)}</td>
                    <td className="px-3 py-4 text-slate-600 transition-colors group-hover:text-blue-300"><ChevronRight size={15} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 xl:hidden">
            {filteredDecisions.map((decision) => (
              <Link
                key={decision.id}
                to={`/decisions/${decision.id}`}
                className="group block border border-line bg-panel p-4 outline-none transition-colors hover:border-slate-600 hover:bg-white/[0.015] focus-visible:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-all font-mono text-[10px] leading-5 text-blue-300/90">{decision.id}</span>
                  <span className="flex shrink-0 items-center gap-2"><StatusBadge status={decision.status} /><ChevronRight size={14} className="text-slate-600 transition-colors group-hover:text-blue-300" /></span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-medium text-slate-200">{decision.agent_id}</span>
                  <span className="font-mono text-[10px] text-slate-500">v{decision.agent_version}</span>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[10px] text-slate-500">
                  <span className="inline-flex items-center gap-1.5"><Clock3 size={12} />{formatCreatedAt(decision.created_at)}</span>
                  <span className="font-mono">{decision.event_count} events</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
