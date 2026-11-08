import { useEffect, useMemo, useState } from 'react';
import { BookOpenText, ChevronRight, LoaderCircle, Scale, Search, ShieldAlert, X, type LucideIcon } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { getPolicies } from '../services/policyService';
import type { Policy } from '../types/policy';

function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' }).format(date);
}

function statusStyle(status: string): string {
  switch (status.toUpperCase()) {
    case 'ACTIVE': return 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300';
    case 'INACTIVE': return 'border-amber-400/20 bg-amber-400/[0.08] text-amber-300';
    case 'ARCHIVED': return 'border-slate-500/25 bg-slate-500/[0.08] text-slate-400';
    default: return 'border-slate-500/25 bg-slate-500/[0.08] text-slate-300';
  }
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-flex border px-2 py-1 text-[10px] font-medium leading-none ${statusStyle(status)}`}>{humanize(status)}</span>;
}

function LoadingState() {
  return <div role="status" className="flex items-center gap-3 border border-line bg-panel px-5 py-8 text-sm text-slate-400"><LoaderCircle size={17} className="animate-spin text-accent" />Loading policies…</div>;
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="border border-line bg-panel px-5 py-12 text-center">
      <BookOpenText size={20} className="mx-auto text-slate-500" />
      <h2 className="mt-3 text-sm font-medium text-slate-200">{filtered ? 'No policies match your search' : 'No policies available'}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-muted">{filtered ? 'Try another search term or change the status or policy type filters.' : 'Policy records will appear here when available.'}</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3 border border-rose-400/20 bg-rose-400/[0.04] px-5 py-6 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="text-sm font-medium text-rose-200">Could not load policies</h2><p className="mt-1 text-xs text-slate-400">{message}</p></div>
      <button type="button" onClick={onRetry} className="w-fit border border-line px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white">Try again</button>
    </div>
  );
}

export default function PoliciesPage() {
  const navigate = useNavigate();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getPolicies()
      .then((items) => { if (active) setPolicies(items); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'An unexpected error occurred.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);

  const statuses = useMemo(() => [...new Set(policies.map((policy) => policy.status))].sort(), [policies]);
  const policyTypes = useMemo(() => [...new Set(policies.map((policy) => policy.policy_type))].sort(), [policies]);
  const filteredPolicies = useMemo(() => {
    const query = search.trim().toLowerCase();
    return policies.filter((policy) => {
      const matchesSearch = !query || [policy.id, policy.name, policy.version, policy.description].some((value) => value.toLowerCase().includes(query));
      const matchesStatus = statusFilter === 'all' || policy.status === statusFilter;
      const matchesType = typeFilter === 'all' || policy.policy_type === typeFilter;
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [policies, search, statusFilter, typeFilter]);
  const hasFilters = Boolean(search.trim()) || statusFilter !== 'all' || typeFilter !== 'all';

  const openPolicy = (policyId: string) => navigate(`/policies/${policyId}`);

  return (
    <>
      <PageHeader eyebrow="Audit / Governance" title="Policy Library" description="Review the governance policies used or evaluated during AI decisions, including their versions, rules, and evaluation history." />

      <div className="mb-4 flex flex-col gap-3 border border-line bg-panel p-3 xl:flex-row xl:items-center xl:p-4">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search policy ID, name, version, or description</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ID, name, version, or description" className="h-10 w-full border border-line bg-shell pl-9 pr-9 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-accent/60 focus-visible:ring-1 focus-visible:ring-accent/30 xl:h-9" />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-200"><X size={14} /></button>}
        </label>
        <div className="grid gap-3 sm:grid-cols-2 xl:flex xl:flex-wrap">
          <label className="flex min-w-0 items-center gap-2 text-[11px] text-slate-500">
            <span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 min-w-0 flex-1 border border-line bg-shell px-3 text-xs text-slate-300 outline-none focus:border-accent/60 focus-visible:ring-1 focus-visible:ring-accent/30 xl:h-9 xl:min-w-32 xl:flex-none">
              <option value="all">All statuses</option>
              {statuses.map((status) => <option key={status} value={status}>{humanize(status)}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 items-center gap-2 text-[11px] text-slate-500">
            <span>Type</span>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="h-10 min-w-0 flex-1 border border-line bg-shell px-3 text-xs text-slate-300 outline-none focus:border-accent/60 focus-visible:ring-1 focus-visible:ring-accent/30 xl:h-9 xl:min-w-36 xl:flex-none">
              <option value="all">All types</option>
              {policyTypes.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-2 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <span>{loading ? 'Loading policies…' : `${filteredPolicies.length} ${filteredPolicies.length === 1 ? 'policy' : 'policies'}`}</span>
        <span className="inline-flex items-center gap-1.5 text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Live governance policies</span>
      </div>

      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} /> : filteredPolicies.length === 0 ? <EmptyState filtered={hasFilters} /> : (
        <>
          <div className="hidden border border-line bg-panel 2xl:block">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead className="border-b border-line bg-white/[0.015]">
                <tr className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  <th scope="col" className="px-4 py-3">Policy</th><th scope="col" className="px-4 py-3">Version</th><th scope="col" className="px-4 py-3">Type</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3">Effective from</th><th scope="col" className="px-4 py-3">Updated</th><th scope="col" className="px-4 py-3">Rules</th><th scope="col" className="w-8 px-3 py-3"><span className="sr-only">Open policy</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {filteredPolicies.map((policy) => (
                  <tr key={policy.id} tabIndex={0} role="link" aria-label={`Open policy ${policy.name}`} onClick={() => openPolicy(policy.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPolicy(policy.id); } }} className="group cursor-pointer text-xs text-slate-300 outline-none hover:bg-white/[0.035] focus-visible:bg-white/[0.045] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/50">
                    <td className="max-w-[280px] px-4 py-4"><Link to={`/policies/${policy.id}`} onClick={(event) => event.stopPropagation()} className="block line-clamp-2 font-medium leading-5 text-slate-200 outline-none hover:text-blue-200">{policy.name}</Link><span className="mt-1 block break-all font-mono text-[9px] leading-4 text-slate-600">{policy.id}</span></td>
                    <td className="whitespace-nowrap px-4 py-4 font-mono text-[11px] text-slate-300">v{policy.version}</td>
                    <td className="whitespace-nowrap px-4 py-4"><span className="inline-flex items-center gap-1.5 text-slate-400"><Scale size={12} />{humanize(policy.policy_type)}</span></td>
                    <td className="whitespace-nowrap px-4 py-4"><StatusBadge status={policy.status} /></td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-400">{formatDate(policy.effective_from)}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-400">{formatDate(policy.updated_at)}</td>
                    <td className="px-4 py-4 text-right font-mono tabular-nums text-slate-400">{policy.rules.length}</td>
                    <td className="px-3 py-4 text-slate-600 transition-colors group-hover:text-blue-300"><ChevronRight size={15} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 2xl:hidden">
            {filteredPolicies.map((policy) => {
              const TypeIcon: LucideIcon = policy.policy_type === 'ACCOUNT_SAFETY' ? ShieldAlert : BookOpenText;
              return (
                <Link key={policy.id} to={`/policies/${policy.id}`} className="group block border border-line bg-panel p-4 outline-none transition-colors hover:border-slate-600 hover:bg-white/[0.015] focus-visible:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/40">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 flex-1 items-start gap-3"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-line bg-white/[0.02] text-slate-400"><TypeIcon size={15} /></span><span className="min-w-0"><span className="block text-xs font-medium leading-5 text-slate-200">{policy.name}</span><span className="mt-1 block break-all font-mono text-[9px] text-slate-600">{policy.id}</span></span></div><span className="flex shrink-0 items-center gap-2"><StatusBadge status={policy.status} /><ChevronRight size={14} className="text-slate-600 transition-colors group-hover:text-blue-300" /></span></div>
                  <dl className="mt-3 grid gap-x-4 gap-y-2 border-t border-line pt-3 text-[10px] sm:grid-cols-2"><div><dt className="text-[9px] uppercase tracking-wider text-slate-600">Version / type</dt><dd className="mt-0.5"><span className="font-mono text-slate-300">v{policy.version}</span><span className="mx-1.5 text-slate-700">·</span><span className="text-slate-400">{humanize(policy.policy_type)}</span></dd></div><div><dt className="text-[9px] uppercase tracking-wider text-slate-600">Rules / effective</dt><dd className="mt-0.5 text-slate-400">{policy.rules.length} rules · {formatDate(policy.effective_from)}</dd></div><div className="sm:col-span-2"><dt className="text-[9px] uppercase tracking-wider text-slate-600">Updated</dt><dd className="mt-0.5 text-slate-400">{formatDate(policy.updated_at)}</dd></div></dl>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
