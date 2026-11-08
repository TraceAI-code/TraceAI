import { useEffect, useState } from 'react';
import { ArrowRight, FileText, Fingerprint, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { getAuditReports } from '../services/auditReportService';
import type { AuditReport } from '../types/auditReport';

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const color = normalized.includes('reject') || normalized.includes('failed')
    ? 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300'
    : normalized.includes('approve') || normalized.includes('passed') || normalized.includes('intact')
      ? 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300'
      : 'border-slate-500/25 bg-slate-500/[0.08] text-slate-300';
  return <span className={`inline-flex border px-2 py-1 font-mono text-[9px] uppercase tracking-wider ${color}`}>{value.replace(/_/g, ' ')}</span>;
}

export default function AuditReportsPage() {
  const [reports, setReports] = useState<AuditReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getAuditReports()
      .then((items) => { if (active) setReports(items); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load audit reports.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <>
      <PageHeader title="Audit Reports" description="Consolidated decision records for investigator review, compiled directly from decision event timelines and cryptographic hash chains." />
      <div className="mb-5 flex items-start gap-2 border border-emerald-400/20 bg-emerald-400/[0.04] px-3 py-2 text-[10px] leading-4 text-emerald-300">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
        Live audit platform connected · Reports loaded directly from backend API.
      </div>
      {loading ? (
        <div role="status" className="flex items-center gap-3 border border-line bg-panel px-5 py-8 text-sm text-slate-400"><LoaderCircle size={16} className="animate-spin text-accent" />Loading available reports…</div>
      ) : error ? (
        <div role="alert" className="border border-rose-400/20 bg-panel px-5 py-6 text-sm text-rose-300">Could not load reports: {error}</div>
      ) : reports.length === 0 ? (
        <div className="border border-line bg-panel px-5 py-10 text-center"><FileText size={20} className="mx-auto text-slate-500" /><p className="mt-3 text-sm text-slate-300">No audit reports are available.</p><p className="mt-1 text-xs text-slate-500">Reports will appear here once decisions are recorded.</p></div>
      ) : (
        <section aria-label="Available audit reports" className="border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3"><div><h2 className="text-xs font-medium text-slate-200">Available reports</h2><p className="mt-1 text-[10px] text-slate-500">{reports.length} reports</p></div><Fingerprint size={15} className="text-slate-500" /></div>
          <ul className="divide-y divide-line">
            {reports.map((report) => (
              <li key={report.decision.id}>
                <Link to={`/audit-reports/${report.decision.id}`} className="group grid gap-4 px-4 py-4 outline-none transition-colors hover:bg-white/[0.025] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/50 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center sm:px-5 sm:py-5">
                  <div className="min-w-0"><p className="text-xs font-medium text-slate-200">{report.decision.agent_id}</p><p className="mt-1 break-all font-mono text-[10px] text-slate-500">{report.decision.id}</p><p className="mt-1 text-[10px] text-slate-600">v{report.decision.agent_version}</p></div>
                  <div className="flex flex-col items-start gap-2">
                    <div className="flex flex-wrap items-center gap-2"><span className="text-[9px] uppercase tracking-wider text-slate-600">Decision status</span><StatusBadge value={report.decision.status} /></div>
                    {report.final_outcome && <div className="flex flex-wrap items-center gap-2"><span className="text-[9px] uppercase tracking-wider text-slate-600">Recorded outcome</span><span className="text-[10px] text-slate-400">{report.final_outcome.value.replace(/_/g, ' ')}</span></div>}
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[10px] text-slate-500 sm:justify-end"><span>{formatDate(report.decision.created_at)}</span><span className="inline-flex items-center gap-1 text-blue-300/80 transition-colors group-hover:text-blue-200">View report <ArrowRight size={12} /></span></div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
