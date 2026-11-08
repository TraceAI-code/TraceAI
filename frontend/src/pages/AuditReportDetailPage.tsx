import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown, Clock3, Download, FileSearch, Fingerprint, LoaderCircle, Scale, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { getAuditReport } from '../services/auditReportService';
import { apiUrl } from '../services/apiClient';
import type { AuditReport } from '../types/auditReport';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

function readable(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function badgeClass(value: string): string {
  const status = value.toLowerCase();
  if (status.includes('reject') || status.includes('failed') || status.includes('warning')) return 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300';
  if (status.includes('approve') || status.includes('passed') || status.includes('intact')) return 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300';
  return 'border-slate-500/25 bg-slate-500/[0.08] text-slate-300';
}

function Badge({ value }: { value: string }) {
  return <span className={`inline-flex whitespace-nowrap border px-2 py-1 font-mono text-[9px] uppercase tracking-wider ${badgeClass(value)}`}>{readable(value)}</span>;
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof FileSearch; children: ReactNode }) {
  return <section className="min-w-0 border border-line bg-panel"><div className="flex min-h-11 items-center gap-2 border-b border-line px-4 py-3"><Icon size={14} className="shrink-0 text-slate-500" /><h2 className="text-xs font-medium text-slate-200">{title}</h2></div><div className="min-w-0 p-4">{children}</div></section>;
}

function truncateHash(value: string | null): string {
  if (!value) return '—';
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

function ReportBody({ report }: { report: AuditReport }) {
  const decision = report.decision;
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link to="/audit-reports" className="inline-flex items-center gap-2 text-xs text-slate-400 outline-none hover:text-slate-100 focus-visible:ring-1 focus-visible:ring-accent/50"><ArrowLeft size={14} />Back to audit reports</Link>
        <span className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Compiled from audit events</span>
      </div>
      <PageHeader eyebrow="Consolidated decision record" title="Audit Report" description="Investigator-oriented view of the recorded decision lifecycle and associated audit data." action={<div className="flex flex-wrap items-center gap-2"><a href={apiUrl(`/decisions/${decision.id}/audit-report?format=json`)} download={`traceai-audit-${decision.id}.json`} className="inline-flex min-h-9 w-fit items-center gap-2 border border-line px-3 text-xs text-slate-300 outline-none hover:border-slate-600 hover:text-white focus-visible:ring-1 focus-visible:ring-accent/50"><Download size={13} />JSON</a><a href={apiUrl(`/decisions/${decision.id}/audit-report?format=markdown`)} download={`traceai-audit-${decision.id}.md`} className="inline-flex min-h-9 w-fit items-center gap-2 border border-line px-3 text-xs text-slate-300 outline-none hover:border-slate-600 hover:text-white focus-visible:ring-1 focus-visible:ring-accent/50"><Download size={13} />Markdown</a><Link to={`/decisions/${decision.id}`} className="inline-flex min-h-9 w-fit items-center gap-2 border border-line px-3 text-xs text-slate-300 outline-none hover:border-slate-600 hover:text-white focus-visible:ring-1 focus-visible:ring-accent/50">Decision detail <ArrowLeft size={13} className="rotate-180" /></Link></div>} />

      <section className="mb-5 border border-line bg-panel">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-4 py-4 sm:px-5">
          <div className="min-w-0"><p className="text-sm font-medium text-slate-100">{decision.agent_id}</p><p className="mt-1 break-all font-mono text-[10px] text-slate-500">{decision.id}</p><p className="mt-1 text-[10px] text-slate-600">Agent version {decision.agent_version}</p></div>
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2"><div><p className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Decision status</p><Badge value={decision.status} /></div>{report.final_outcome && <div><p className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Recorded outcome</p><Badge value={report.final_outcome.value} /></div>}</div>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"><div className="min-w-0 border-b border-line p-4 last:border-b-0 sm:odd:border-r sm:[&:nth-child(n+3)]:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0"><dt className="text-[9px] uppercase tracking-wider text-slate-600">Created</dt><dd className="mt-1.5 break-words text-xs font-medium text-slate-200">{formatDate(decision.created_at)}</dd></div><div className="min-w-0 border-b border-line p-4 last:border-b-0 sm:odd:border-r sm:[&:nth-child(n+3)]:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0"><dt className="text-[9px] uppercase tracking-wider text-slate-600">Event count</dt><dd className="mt-1.5 font-mono text-xs font-medium text-slate-200">{decision.event_count}</dd></div><div className="min-w-0 border-b border-line p-4 last:border-b-0 sm:odd:border-r sm:[&:nth-child(n+3)]:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0"><dt className="text-[9px] uppercase tracking-wider text-slate-600">Evidence records</dt><dd className="mt-1.5 font-mono text-xs font-medium text-slate-200">{report.evidence.length}</dd></div><div className="min-w-0 border-b border-line p-4 last:border-b-0 sm:odd:border-r sm:[&:nth-child(n+3)]:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0"><dt className="text-[9px] uppercase tracking-wider text-slate-600">Policy evaluations</dt><dd className="mt-1.5 font-mono text-xs font-medium text-slate-200">{report.policies.filter((item) => item.evaluation).length}</dd></div></dl>
      </section>

      <section className="mb-5 border border-line bg-panel px-4 py-4 sm:px-5 sm:py-5"><h2 className="mb-2 text-xs font-medium text-slate-400">Executive summary</h2><p className="text-sm leading-6 text-slate-200 sm:text-[15px]">{report.executive_summary}</p></section>

      {report.final_outcome && <section className="mb-6 border border-accent/20 bg-accent/[0.035] px-4 py-4 sm:px-5"><div className="flex items-start gap-3"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" /><div><p className="text-[9px] uppercase tracking-wider text-slate-500">Final recorded outcome · {readable(report.final_outcome.source)}</p><p className="mt-1 text-xl font-semibold tracking-tight text-slate-100">{readable(report.final_outcome.value)}</p><p className="mt-1 text-[11px] leading-5 text-slate-400">{report.final_outcome.description}</p></div></div></section>}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)]">
        <Section title="Decision lifecycle" icon={Clock3}>
          {report.events.length ? (
            <ol className="ml-2 border-l border-line">
              {report.events.slice().sort((a, b) => a.sequence - b.sequence).map((event) => (
                <li key={event.id} className="relative pb-4 pl-5 last:pb-0">
                  <span className="absolute -left-[4px] top-1.5 h-2 w-2 rounded-full border border-accent/50 bg-panel" />
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-accent/50">
                      <span className="min-w-0">
                        <span className="font-mono text-[9px] tabular-nums text-slate-500">#{event.sequence}</span>
                        <span className="ml-2 text-xs font-medium text-slate-200">{readable(event.event_type)}</span>
                        <span className="mt-1 block text-[10px] text-slate-500">{formatDate(event.timestamp)} · <span className="font-mono text-slate-400">{event.actor}</span></span>
                      </span>
                      <ChevronDown size={13} className="mt-1 shrink-0 text-slate-600 transition-transform group-open:rotate-180" />
                    </summary>
                    <pre className="mt-3 max-h-72 overflow-auto border border-line bg-shell p-3 font-mono text-[10px] leading-5 text-slate-400 [overflow-wrap:anywhere]">{JSON.stringify(event.payload, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ol>
          ) : <p className="text-[11px] text-slate-500">No event timeline is available for this decision.</p>}
        </Section>

        <div className="space-y-5">
          <Section title="Evidence" icon={FileSearch}>
            {report.evidence.length ? <ul className="space-y-3">{report.evidence.map((item) => <li key={item.id} className="min-w-0 border-b border-line pb-3 last:border-0 last:pb-0"><Link to={`/evidence/${item.id}`} className="text-xs font-medium text-blue-200/90 outline-none hover:text-blue-100 focus-visible:ring-1 focus-visible:ring-accent/50">{item.title}</Link><p className="mt-1 break-all font-mono text-[9px] text-slate-600">{item.id}</p><p className="mt-1 break-words text-[10px] leading-4 text-slate-400">{readable(item.evidence_type)} · {item.source}</p><p className="mt-1 break-words text-[9px] text-slate-600">Linked to this decision{item.hash && <> · hash <span className="font-mono" title={item.hash}>{truncateHash(item.hash)}</span></>}</p></li>)}</ul> : <p className="text-[11px] text-slate-500">No evidence is linked in this report.</p>}
          </Section>

          <Section title="Policies" icon={Scale}>
            {report.policies.length ? <ul className="space-y-4">{report.policies.map(({ policy, evaluation }) => <li key={policy.id} className="min-w-0 border-b border-line pb-4 last:border-0 last:pb-0"><Link to={`/policies/${policy.id}`} className="text-xs font-medium text-blue-200/90 outline-none hover:text-blue-100 focus-visible:ring-1 focus-visible:ring-accent/50">{policy.name}</Link><p className="mt-1 break-all font-mono text-[9px] text-slate-600">{policy.id}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500"><span>Version <span className="font-mono text-slate-400">{evaluation?.policy_version ?? policy.version}</span></span><Badge value={policy.status} /></div>{evaluation ? <div className="mt-2 border-l border-line pl-2.5"><div className="flex flex-wrap items-center gap-2"><Badge value={evaluation.result} /><span className="text-[9px] text-slate-600">Evaluated {formatDate(evaluation.evaluated_at)}</span></div><p className="mt-2 break-words text-[10px] leading-4 text-slate-400">{evaluation.summary}</p></div> : <p className="mt-2 text-[10px] text-slate-500">No evaluation recorded.</p>}</li>)}</ul> : <p className="text-[11px] text-slate-500">No policy records are associated with this report.</p>}
          </Section>

          <Section title="Human review" icon={ShieldCheck}>
            {report.reviews.length ? (
              <>
                <p className="mb-2 text-[9px] font-medium uppercase tracking-wider text-slate-600">Latest review</p>
                {(() => {
                  const [latestReview, ...history] = report.reviews;
                  return <>
                    <div className="border-b border-line pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><Badge value={latestReview.action} /><span className="text-[9px] text-slate-600">{formatDate(latestReview.created_at)}</span></div><p className="mt-2 text-[10px] text-slate-500">Reviewer <span className="font-mono text-slate-300">{latestReview.reviewer}</span></p><p className="mt-1 break-words text-[10px] leading-4 text-slate-400">{latestReview.comment ?? 'No comment recorded.'}</p></div>
                    {history.length > 0 && <details className="group mt-3"><summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] text-slate-400 outline-none hover:text-slate-200 focus-visible:ring-1 focus-visible:ring-accent/50"><ChevronDown size={12} className="transition-transform group-open:rotate-180" />Review history <span className="font-mono text-slate-600">{history.length} earlier</span></summary><ol className="mt-3 space-y-3">{history.map((review) => <li key={review.id} className="border-l border-line pl-3"><div className="flex flex-wrap items-center justify-between gap-2"><Badge value={review.action} /><span className="text-[9px] text-slate-600">{formatDate(review.created_at)}</span></div><p className="mt-1.5 text-[10px] text-slate-500">Reviewer <span className="font-mono text-slate-400">{review.reviewer}</span></p><p className="mt-1 break-words text-[10px] leading-4 text-slate-500">{review.comment ?? 'No comment recorded.'}</p></li>)}</ol></details>}
                  </>;
                })()}
              </>
            ) : <p className="text-[11px] text-slate-500">No human review recorded.</p>}
          </Section>

          <Section title="Integrity" icon={Fingerprint}>
            <p className="mb-3 border border-amber-400/15 bg-amber-400/[0.035] px-3 py-2 text-[9px] leading-4 text-amber-200/80">Hash values are supplied by the audit record. This frontend does not independently recompute them.</p>
            {report.integrity ? (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] text-slate-500">Recorded chain status</span><Badge value={report.integrity.chain_status} /></div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-3 border-b border-line pb-3"><div><dt className="text-[9px] uppercase tracking-wider text-slate-600">Event count</dt><dd className="mt-1 font-mono text-xs text-slate-300">{report.integrity.event_count}</dd></div><div><dt className="text-[9px] uppercase tracking-wider text-slate-600">Events hashed</dt><dd className="mt-1 font-mono text-xs text-slate-300">{report.integrity.events_hashed}</dd></div><div><dt className="text-[9px] uppercase tracking-wider text-slate-600">Algorithm</dt><dd className="mt-1 break-words font-mono text-[10px] text-slate-400">{report.integrity.hash_algorithm ?? '—'}</dd></div><div><dt className="text-[9px] uppercase tracking-wider text-slate-600">Verification status</dt><dd className="mt-1"><Badge value={report.integrity.verification_status} /></dd></div></dl>
                <div className="mt-3"><p className="text-[9px] uppercase tracking-wider text-slate-600">Root hash</p><p className="mt-1 break-all font-mono text-[9px] leading-4 text-slate-400" title={report.integrity.root_hash ?? undefined}>{report.integrity.root_hash ?? '—'}</p></div>
                <p className="mt-3 text-[9px] leading-4 text-slate-500">The chain status and hash values shown are supplied by the audit record. This frontend does not independently recompute or verify them.</p>
                <details className="group mt-3 border-t border-line pt-3"><summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] text-slate-400 outline-none hover:text-slate-200 focus-visible:ring-1 focus-visible:ring-accent/50"><ChevronDown size={12} className="transition-transform group-open:rotate-180" />Inspect integrity chain <span className="font-mono text-slate-600">{report.integrity.events.length} records</span></summary><div className="mt-3 space-y-3"><div><p className="text-[9px] uppercase tracking-wider text-slate-600">Full root hash</p><p className="mt-1 break-all font-mono text-[9px] leading-4 text-slate-400">{report.integrity.root_hash ?? '—'}</p></div>{report.integrity.events.slice().sort((a, b) => a.sequence - b.sequence).map((event) => <div key={event.event_id} className="min-w-0 border-l border-line pl-3"><p className="text-[9px] uppercase tracking-wider text-slate-600">Sequence {event.sequence} · event type</p><p className="mt-1 text-[10px] font-medium text-slate-300">{readable(event.event_type)}</p><div className="mt-2"><p className="text-[9px] uppercase tracking-wider text-slate-600">Event ID</p><p className="mt-1 break-all font-mono text-[9px] leading-4 text-slate-500">{event.event_id}</p></div><div className="mt-2"><p className="text-[9px] uppercase tracking-wider text-slate-600">Event hash</p><p className="mt-1 break-all font-mono text-[9px] leading-4 text-slate-500">{event.hash}</p></div><div className="mt-2"><p className="text-[9px] uppercase tracking-wider text-slate-600">Previous hash</p><p className="mt-1 break-all font-mono text-[9px] leading-4 text-slate-500">{event.previous_hash ?? '—'}</p></div></div>)}</div></details>
              </>
            ) : <p className="text-[11px] text-slate-500">Integrity information is unavailable for this decision.</p>}
          </Section>
        </div>
      </div>
    </>
  );
}

export default function AuditReportDetailPage() {
  const { decisionId = '' } = useParams<{ decisionId: string }>();
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getAuditReport(decisionId).then((item) => { if (active) setReport(item); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load this audit report.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [decisionId, reloadKey]);

  if (loading) return <div role="status" className="flex items-center gap-3 border border-line bg-panel px-5 py-8 text-sm text-slate-400"><LoaderCircle size={16} className="animate-spin text-accent" />Loading audit report…</div>;
  if (error) return <div role="alert" className="border border-rose-400/20 bg-panel px-5 py-6"><p className="text-sm text-rose-300">Could not load audit report</p><p className="mt-1 text-xs text-slate-500">{error}</p><div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" onClick={() => setReloadKey((current) => current + 1)} className="inline-flex items-center gap-2 border border-line px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white">Retry</button><Link to="/audit-reports" className="inline-flex items-center gap-2 text-xs text-slate-300"><ArrowLeft size={13} />Back to reports</Link></div></div>;
  if (!report) return <div className="border border-line bg-panel px-6 py-10 text-center"><p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">404 / REPORT_NOT_FOUND</p><h1 className="mt-2 text-lg font-semibold text-slate-100">Audit report not found</h1><p className="mt-2 text-xs text-slate-500">No report is available for this decision in the stored audit records.</p><Link to="/audit-reports" className="mt-5 inline-flex items-center gap-2 border border-line px-3 py-2 text-xs text-slate-300 hover:text-white"><ArrowLeft size={13} />Back to audit reports</Link></div>;
  return <ReportBody report={report} />;
}
