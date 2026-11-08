import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BookOpenText,
  ChevronRight,
  ContactRound,
  Database,
  FileSearch,
  FileText,
  LoaderCircle,
  Mail,
  ReceiptText,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { getEvidence } from '../services/evidenceService';
import type { Evidence } from '../types/evidence';

const evidenceTypeIcons: Record<string, LucideIcon> = {
  DOCUMENT: FileText,
  INVOICE: ReceiptText,
  POLICY_DOCUMENT: BookOpenText,
  CUSTOMER_RECORD: ContactRound,
  SYSTEM_LOG: Activity,
  KNOWLEDGE_BASE: BookOpenText,
  EMAIL: Mail,
  DATABASE_RECORD: Database,
};

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

function shortHash(value: string | null): string {
  if (!value) return '—';
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function TypeBadge({ type }: { type: string }) {
  const Icon = evidenceTypeIcons[type] ?? FileSearch;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap border border-slate-500/25 bg-slate-500/[0.06] px-2 py-1 text-[10px] font-medium text-slate-300">
      <Icon size={12} strokeWidth={1.7} /> {humanize(type)}
    </span>
  );
}

function LoadingState() {
  return (
    <div role="status" className="flex items-center gap-3 border border-line bg-panel px-5 py-8 text-sm text-slate-400">
      <LoaderCircle size={17} className="animate-spin text-accent" /> Loading evidence records…
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="border border-line bg-panel px-5 py-12 text-center">
      <FileSearch size={20} className="mx-auto text-slate-500" />
      <h2 className="mt-3 text-sm font-medium text-slate-200">{filtered ? 'No evidence matches your search' : 'No evidence records available'}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-muted">
        {filtered ? 'Try a different search term or evidence type.' : 'Evidence records will appear here once available.'}
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3 border border-rose-400/20 bg-rose-400/[0.04] px-5 py-6 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-sm font-medium text-rose-200">Could not load evidence</h2>
        <p className="mt-1 text-xs text-slate-400">{message}</p>
      </div>
      <button type="button" onClick={onRetry} className="w-fit border border-line px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white">Try again</button>
    </div>
  );
}

export default function EvidencePage() {
  const navigate = useNavigate();
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    getEvidence()
      .then((items) => {
        if (active) setEvidence(items);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'An unexpected error occurred.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [reloadKey]);

  const evidenceTypes = useMemo(() => [...new Set(evidence.map((item) => item.evidence_type))].sort(), [evidence]);
  const filteredEvidence = useMemo(() => {
    const query = search.trim().toLowerCase();
    return evidence.filter((item) => {
      const matchesSearch = !query || [item.id, item.title, item.source, item.evidence_type]
        .some((value) => value.toLowerCase().includes(query));
      return matchesSearch && (typeFilter === 'all' || item.evidence_type === typeFilter);
    });
  }, [evidence, search, typeFilter]);
  const hasFilters = Boolean(search.trim()) || typeFilter !== 'all';

  const openEvidence = (evidenceId: string) => navigate(`/evidence/${evidenceId}`);

  return (
    <>
      <PageHeader
        eyebrow="Audit / Evidence"
        title="Evidence Explorer"
        description="Inspect evidence captured or referenced during AI decisions, and trace each artifact back to the decisions that used it."
      />

      <div className="mb-4 flex flex-col gap-3 border border-line bg-panel p-3 sm:flex-row sm:items-center sm:p-4">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search evidence ID, title, source, or type</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search ID, title, source, or type"
            className="h-10 w-full border border-line bg-shell pl-9 pr-9 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-accent/60 focus-visible:ring-1 focus-visible:ring-accent/30 sm:h-9"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-200">
              <X size={14} />
            </button>
          )}
        </label>
        <label className="flex w-full items-center gap-2 text-[11px] text-slate-500 sm:w-auto">
          <span className="whitespace-nowrap">Type</span>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="h-10 min-w-0 flex-1 border border-line bg-shell px-3 text-xs text-slate-300 outline-none focus:border-accent/60 focus-visible:ring-1 focus-visible:ring-accent/30 sm:h-9 sm:min-w-40 sm:flex-none">
            <option value="all">All types</option>
            {evidenceTypes.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}
          </select>
        </label>
      </div>

      <div className="mb-3 flex flex-col gap-2 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <span>{loading ? 'Loading records…' : `${filteredEvidence.length} ${filteredEvidence.length === 1 ? 'record' : 'records'}`}</span>
        <span className="inline-flex items-center gap-1.5 text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live evidence store
        </span>
      </div>

      {loading ? <LoadingState /> : error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} />
      ) : filteredEvidence.length === 0 ? (
        <EmptyState filtered={hasFilters} />
      ) : (
        <>
          <div className="hidden border border-line bg-panel 2xl:block">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead className="border-b border-line bg-white/[0.015]">
                <tr className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-4 py-3">Evidence</th>
                  <th scope="col" className="px-4 py-3">Type</th>
                  <th scope="col" className="px-4 py-3">Source</th>
                  <th scope="col" className="px-4 py-3">Retrieved</th>
                  <th scope="col" className="px-4 py-3">Linked decisions</th>
                  <th scope="col" className="px-4 py-3">Hash</th>
                  <th scope="col" className="w-8 px-3 py-3"><span className="sr-only">Open evidence</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {filteredEvidence.map((item) => (
                  <tr
                    key={item.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`Open evidence ${item.title}`}
                    onClick={() => openEvidence(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openEvidence(item.id);
                      }
                    }}
                    className="group cursor-pointer text-xs text-slate-300 outline-none hover:bg-white/[0.035] focus-visible:bg-white/[0.045] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/50"
                  >
                    <td className="max-w-[280px] px-4 py-4">
                      <Link to={`/evidence/${item.id}`} onClick={(event) => event.stopPropagation()} className="block line-clamp-2 font-medium leading-5 text-slate-200 outline-none hover:text-blue-200">{item.title}</Link>
                      <span className="mt-1 block break-all font-mono text-[9px] leading-4 text-slate-600">{item.id}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4"><TypeBadge type={item.evidence_type} /></td>
                    <td className="max-w-[170px] px-4 py-4"><span className="block truncate text-slate-400" title={item.source}>{item.source}</span></td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-400">{formatTimestamp(item.retrieved_at)}</td>
                    <td className="px-4 py-4 text-center font-mono tabular-nums text-slate-400">{item.linked_decision_ids.length}</td>
                    <td className="whitespace-nowrap px-4 py-4 font-mono text-[10px] text-slate-500" title={item.hash ?? undefined}>{shortHash(item.hash)}</td>
                    <td className="px-3 py-4 text-slate-600 transition-colors group-hover:text-blue-300"><ChevronRight size={15} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 2xl:hidden">
            {filteredEvidence.map((item) => {
              const Icon = evidenceTypeIcons[item.evidence_type] ?? FileSearch;
              return (
                <Link key={item.id} to={`/evidence/${item.id}`} className="group block border border-line bg-panel p-4 outline-none transition-colors hover:border-slate-600 hover:bg-white/[0.015] focus-visible:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/40">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-line bg-white/[0.02] text-slate-400"><Icon size={15} /></span>
                      <span className="min-w-0">
                        <span className="block text-xs font-medium leading-5 text-slate-200">{item.title}</span>
                        <span className="mt-1 block break-all font-mono text-[9px] text-slate-600">{item.id}</span>
                      </span>
                    </div>
                    <span className="flex shrink-0 items-center gap-2"><TypeBadge type={item.evidence_type} /><ChevronRight size={14} className="text-slate-600 transition-colors group-hover:text-blue-300" /></span>
                  </div>
                  <dl className="mt-3 grid gap-x-4 gap-y-2 border-t border-line pt-3 text-[10px] sm:grid-cols-2">
                    <div className="min-w-0"><dt className="text-[9px] uppercase tracking-wider text-slate-600">Source</dt><dd className="mt-0.5 break-words text-slate-400">{item.source}</dd></div>
                    <div><dt className="text-[9px] uppercase tracking-wider text-slate-600">Retrieved</dt><dd className="mt-0.5 text-slate-400">{formatTimestamp(item.retrieved_at)}</dd></div>
                    <div><dt className="text-[9px] uppercase tracking-wider text-slate-600">Linked decisions</dt><dd className="mt-0.5 font-mono text-slate-400">{item.linked_decision_ids.length}</dd></div>
                    <div className="min-w-0"><dt className="text-[9px] uppercase tracking-wider text-slate-600">Hash</dt><dd className="mt-0.5 truncate font-mono text-slate-500" title={item.hash ?? undefined}>{shortHash(item.hash)}</dd></div>
                  </dl>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
