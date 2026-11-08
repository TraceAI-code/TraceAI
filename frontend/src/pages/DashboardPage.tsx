import { useEffect, useState } from 'react';
import { Activity, Archive, ArrowRight, FileSearch, Fingerprint, LoaderCircle, Scale, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { getDashboardData } from '../services/dashboardService';
import type { DashboardData } from '../services/dashboardService';
import type { Decision } from '../types/decision';

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function statusTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes('reject') || normalized.includes('failed')) return 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300';
  if (normalized.includes('approve') || normalized.includes('passed')) return 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300';
  if (normalized.includes('requested_review') || normalized.includes('warning') || normalized.includes('violat')) return 'border-amber-400/20 bg-amber-400/[0.08] text-amber-300';
  return 'border-slate-500/25 bg-slate-500/[0.08] text-slate-300';
}

function MetricCard({ label, value, description, icon: Icon, danger = false }: { label: string; value: number; description: string; icon: typeof Activity; danger?: boolean }) {
  return (
    <section className="border border-line bg-panel px-4 py-4 sm:px-5">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p><p className={`mt-2 font-mono text-2xl font-semibold tracking-tight ${danger ? 'text-rose-300' : 'text-slate-100'}`}>{value}</p></div><span className="flex h-8 w-8 items-center justify-center border border-line bg-shell text-slate-400"><Icon size={15} /></span></div>
      <p className={`mt-2 text-[10px] leading-4 ${danger ? 'text-rose-300/80' : 'text-slate-500'}`}>{description}</p>
    </section>
  );
}

function DecisionRow({ decision }: { decision: Decision }) {
  return (
    <li>
      <Link to={`/decisions/${decision.id}`} className="grid gap-2 px-4 py-3.5 outline-none hover:bg-white/[0.02] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/50 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto_auto] sm:items-center sm:px-5">
        <div className="min-w-0"><p className="truncate text-xs font-medium text-slate-200">{decision.agent_id}</p><p className="mt-1 truncate font-mono text-[9px] text-slate-600">{decision.id}</p></div>
        <span className="text-[10px] text-slate-500">{formatDate(decision.created_at)}</span>
        <span className={`inline-flex w-fit border px-2 py-1 font-mono text-[9px] uppercase tracking-wider ${statusTone(decision.status)}`}>{decision.status.replace(/_/g, ' ')}</span>
        <span className="text-[10px] text-slate-500">{decision.event_count} events</span>
      </Link>
    </li>
  );
}

function ReviewIntegrityPanel({ data }: { data: DashboardData }) {
  return (
    <section className="border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3"><ShieldCheck size={14} className="text-slate-500" /><h2 className="text-xs font-medium text-slate-200">Review & integrity status</h2></div>
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <div><p className="mb-2 text-[9px] uppercase tracking-wider text-slate-600">Human review records</p><div className="flex items-baseline gap-2"><span className="font-mono text-lg text-slate-200">{data.decisionsWithReviewHistory}</span><span className="text-[10px] text-slate-500">decisions with history</span></div><p className="mt-1 text-[10px] text-slate-600">{data.decisionsWithoutReviewHistory} decisions have no review history yet.</p></div>
        <div><p className="mb-2 text-[9px] uppercase tracking-wider text-slate-600">Chain verification</p><div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]"><span className={data.verifiedChainCount ? 'text-emerald-300/80' : 'text-slate-500'}>{data.verifiedChainCount} verified</span><span className={data.verificationFailureCount ? 'text-rose-300' : 'text-slate-500'}>{data.verificationFailureCount} failed</span></div><p className="mt-1 text-[10px] text-slate-600">The backend recomputes every hash in the {data.decisions.length} most recent decision chains.</p></div>
      </div>
      <div className="flex items-start gap-2 border-t border-line px-4 py-3 text-[9px] leading-4 text-slate-600"><ShieldAlert size={12} className="mt-0.5 shrink-0" />Verification failures mean an event hash, chain link, or root hash no longer matches the recorded value.</div>
    </section>
  );
}

function DashboardContent({ data }: { data: DashboardData }) {
  const recentDecisions = data.decisions.slice(0, 5);
  return (
    <>
      <PageHeader eyebrow="Overview / Investigator workspace" title="Dashboard" description="A concise overview of decision activity, evidence artifacts, and compliance integrity from live backend audits." />
      <div className="mb-6 flex items-start gap-2 border border-emerald-400/20 bg-emerald-400/[0.04] px-3 py-2 text-[10px] leading-4 text-emerald-300">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
        Live audit platform connected · Database synchronized with backend API.
      </div>

      <section aria-label="Audit metrics" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Decision records" value={data.decisions.length} description="Decision summaries available for investigation." icon={Activity} />
        <MetricCard label="Evidence records" value={data.evidenceCount} description="Stored evidence artifacts available in the explorer." icon={Archive} />
        <MetricCard label="Policy evaluations" value={data.policyEvaluationCount} description="Evaluation records linked to existing decisions." icon={Scale} />
        <MetricCard label="Verified audit chains" value={data.verifiedChainCount} description={data.verificationFailureCount ? `${data.verificationFailureCount} chain(s) failed hash verification.` : 'Recent chains recomputed and verified by the backend.'} icon={ShieldCheck} danger={data.verificationFailureCount > 0} />
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
        <section className="min-w-0 border border-line bg-panel">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5"><div><h2 className="text-xs font-medium text-slate-200">Recent decisions</h2><p className="mt-1 text-[10px] text-slate-500">Latest records in the local decision register</p></div><Link to="/decisions" className="inline-flex items-center gap-1.5 text-[10px] text-blue-300/80 hover:text-blue-200">View all decisions <ArrowRight size={12} /></Link></div>
          {recentDecisions.length ? <ul className="divide-y divide-line">{recentDecisions.map((decision) => <DecisionRow key={decision.id} decision={decision} />)}</ul> : <div className="px-4 py-8 text-center text-xs text-slate-500">No decision records are available yet.</div>}
        </section>

        <div className="space-y-5">
          <ReviewIntegrityPanel data={data} />
          <section className="border border-line bg-panel">
            <div className="border-b border-line px-4 py-3"><h2 className="text-xs font-medium text-slate-200">Investigation tools</h2><p className="mt-1 text-[10px] text-slate-500">Continue into a related audit area</p></div>
            <nav aria-label="Investigation tools" className="grid grid-cols-2 gap-2 p-3">
              <Link to="/evidence" className="inline-flex min-h-9 items-center gap-2 border border-line px-2.5 text-[10px] text-slate-400 hover:border-slate-600 hover:text-slate-200"><FileSearch size={13} />Evidence</Link>
              <Link to="/policies" className="inline-flex min-h-9 items-center gap-2 border border-line px-2.5 text-[10px] text-slate-400 hover:border-slate-600 hover:text-slate-200"><Scale size={13} />Policies</Link>
              <Link to="/replay" className="inline-flex min-h-9 items-center gap-2 border border-line px-2.5 text-[10px] text-slate-400 hover:border-slate-600 hover:text-slate-200"><Activity size={13} />Replay</Link>
              <Link to="/audit-reports" className="inline-flex min-h-9 items-center gap-2 border border-line px-2.5 text-[10px] text-slate-400 hover:border-slate-600 hover:text-slate-200"><Fingerprint size={13} />Audit reports</Link>
            </nav>
          </section>
        </div>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getDashboardData()
      .then((result) => { if (active) setData(result); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load dashboard information.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reloadKey]);

  if (loading) return <div role="status" className="flex items-center gap-3 border border-line bg-panel px-5 py-8 text-sm text-slate-400"><LoaderCircle size={16} className="animate-spin text-accent" />Loading investigator overview…</div>;
  if (error) return <div role="alert" className="border border-rose-400/20 bg-panel px-5 py-6"><h1 className="text-sm font-medium text-rose-200">Dashboard data unavailable</h1><p className="mt-1 text-xs text-slate-400">{error}</p><div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={() => setReloadKey((current) => current + 1)} className="inline-flex items-center gap-2 border border-line px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white">Retry</button><Link to="/decisions" className="inline-flex items-center gap-2 text-xs text-slate-300 hover:text-white">Open decision register <ArrowRight size={13} /></Link></div></div>;
  if (!data) return <div className="border border-line bg-panel px-5 py-8 text-center text-xs text-slate-500">No dashboard data is available.</div>;
  return <DashboardContent data={data} />;
}
