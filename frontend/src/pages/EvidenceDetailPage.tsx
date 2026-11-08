import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpenText,
  CalendarClock,
  ChevronDown,
  Clock3,
  FileSearch,
  FileText,
  LoaderCircle,
  Link2,
  ReceiptText,
  type LucideIcon,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type { Evidence } from '../types/evidence';
import { getEvidenceById } from '../services/evidenceService';

const evidenceTypeIcons: Record<string, LucideIcon> = {
  DOCUMENT: FileText,
  INVOICE: ReceiptText,
  POLICY_DOCUMENT: BookOpenText,
  CUSTOMER_RECORD: FileSearch,
  SYSTEM_LOG: CalendarClock,
  KNOWLEDGE_BASE: BookOpenText,
  EMAIL: FileText,
  DATABASE_RECORD: FileSearch,
};

function humanize(value: string): string {
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
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

function statusStyle(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.startsWith('reviewed') || normalized === 'approved') return 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300';
  if (normalized.includes('reject')) return 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300';
  if (normalized.includes('challeng')) return 'border-amber-400/20 bg-amber-400/[0.08] text-amber-300';
  if (normalized === 'created' || normalized === 'running') return 'border-sky-400/20 bg-sky-400/[0.08] text-sky-300';
  return 'border-slate-500/25 bg-slate-500/[0.08] text-slate-300';
}

function TypeBadge({ type }: { type: string }) {
  const Icon = evidenceTypeIcons[type] ?? FileSearch;
  return <span className="inline-flex items-center gap-1.5 border border-slate-500/25 bg-slate-500/[0.06] px-2 py-1 text-[10px] font-medium text-slate-300"><Icon size={12} />{humanize(type)}</span>;
}

function MetadataField({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0 border-b border-line/70 pb-3 last:border-b-0 sm:last:border-b sm:[&:nth-last-child(-n+2)]:border-b-0">
      <p className="mb-1.5 text-[9px] uppercase tracking-wider text-slate-600">{label}</p>
      <p className={`break-words text-xs text-slate-300 ${mono ? 'font-mono [overflow-wrap:anywhere]' : ''}`} title={value ?? undefined}>{value || '—'}</p>
    </div>
  );
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function EvidenceContent({ evidence }: { evidence: Evidence }) {
  const [expanded, setExpanded] = useState(false);
  const parsedContent = useMemo(() => parseJson(evidence.content), [evidence.content]);
  const isStructured = parsedContent !== null && typeof parsedContent === 'object';
  const preview = evidence.excerpt ?? (evidence.content.length > 520 ? `${evidence.content.slice(0, 520).trimEnd()}…` : evidence.content);
  const hasMore = evidence.content.length > 520 || (evidence.excerpt !== null && evidence.excerpt !== evidence.content);

  return (
    <section className="border border-line bg-panel">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-slate-500" />
          <h2 className="text-xs font-medium text-slate-300">Content / Evidence</h2>
        </div>
        <span className="flex items-center gap-3">
          {evidence.content_verified !== undefined && (
            <span className={`font-mono text-[9px] ${evidence.content_verified ? 'text-emerald-300/80' : 'text-rose-300/80'}`}>
              {evidence.content_verified ? 'HASH VERIFIED' : 'HASH MISMATCH'}
            </span>
          )}
          {isStructured && <span className="font-mono text-[9px] text-slate-600">STRUCTURED JSON</span>}
        </span>
      </div>
      <div className="p-4 sm:p-5">
        {isStructured && expanded ? (
          <pre className="max-h-[520px] overflow-auto border border-line bg-shell p-4 font-mono text-[11px] leading-5 text-slate-300 [overflow-wrap:anywhere]">{JSON.stringify(parsedContent, null, 2)}</pre>
        ) : (
          <div className={`max-h-[420px] overflow-auto whitespace-pre-wrap break-words border border-line bg-shell p-4 text-xs leading-6 text-slate-300 ${isStructured ? 'font-mono text-[11px] leading-5 [overflow-wrap:anywhere]' : ''}`}>{expanded ? evidence.content : preview || 'No content preview is available.'}</div>
        )}
        {hasMore && (
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)} className="mt-3 inline-flex min-h-9 items-center gap-1.5 text-[11px] text-blue-300 outline-none hover:text-blue-200 focus-visible:ring-1 focus-visible:ring-accent/50">
            {expanded ? 'Show preview' : 'Expand full content'} <ChevronDown size={13} className={expanded ? 'rotate-180' : ''} />
          </button>
        )}
      </div>
    </section>
  );
}

function LoadingState() {
  return <div role="status" className="flex items-center gap-3 border border-line bg-panel px-5 py-8 text-sm text-slate-400"><LoaderCircle size={17} className="animate-spin text-accent" />Loading evidence…</div>;
}

function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="border border-rose-400/20 bg-rose-400/[0.04] px-5 py-6">
      <h1 className="text-sm font-medium text-rose-200">Could not load evidence</h1>
      <p className="mt-1 text-xs text-slate-400">{message}</p>
      <Link to="/evidence" className="mt-4 inline-flex items-center gap-2 text-xs text-slate-300 hover:text-white"><ArrowLeft size={13} />Back to evidence</Link>
    </div>
  );
}

function NotFoundState() {
  return (
    <div className="border border-line bg-panel px-6 py-10 text-center">
      <FileSearch size={20} className="mx-auto text-slate-500" />
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">404 / EVIDENCE_NOT_FOUND</p>
      <h1 className="mt-2 text-lg font-semibold text-slate-100">Evidence not found</h1>
      <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted">This ID is not present in the evidence store.</p>
      <Link to="/evidence" className="mt-5 inline-flex items-center gap-2 border border-line px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white"><ArrowLeft size={13} />Back to Evidence Explorer</Link>
    </div>
  );
}

function EvidenceDetail({ evidence }: { evidence: Evidence }) {
  const Icon = evidenceTypeIcons[evidence.evidence_type] ?? FileSearch;
  return (
    <>
      <div className="mb-6 border-b border-line pb-6">
        <Link to="/evidence" className="mb-5 inline-flex items-center gap-2 text-xs text-slate-400 outline-none hover:text-slate-100 focus-visible:ring-1 focus-visible:ring-accent/50"><ArrowLeft size={14} />Back to evidence</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-2 text-accent/80"><Icon size={16} /><span className="font-mono text-[10px] uppercase tracking-[0.16em]">Evidence record</span></div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">{evidence.title}</h1>
            <p className="mt-2 break-all font-mono text-[10px] text-slate-500 sm:text-[11px]">{evidence.id}</p>
          </div>
          <TypeBadge type={evidence.evidence_type} />
        </div>
      </div>

      <section className="mb-6 border border-line bg-panel px-4 py-4 sm:px-5">
        <div className="mb-4 flex items-center gap-2"><CalendarClock size={14} className="text-slate-500" /><h2 className="text-xs font-medium text-slate-300">Evidence metadata</h2></div>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <MetadataField label="Evidence ID" value={evidence.id} mono />
          <MetadataField label="Type" value={humanize(evidence.evidence_type)} />
          <MetadataField label="Source" value={evidence.source} />
          <MetadataField label="Source reference" value={evidence.source_reference} mono />
          <MetadataField label="Created at" value={formatTimestamp(evidence.created_at)} />
          <MetadataField label="Retrieved at" value={formatTimestamp(evidence.retrieved_at)} />
          <div className="sm:col-span-2 lg:col-span-3"><MetadataField label="Content hash" value={evidence.hash} mono /></div>
          {evidence.content_verified !== undefined && (
            <div className="sm:col-span-2 lg:col-span-3">
              <MetadataField
                label="Content integrity"
                value={evidence.content_verified ? 'Verified — stored bytes match the SHA-256 content hash' : 'Mismatch — stored bytes do not match the recorded hash'}
              />
            </div>
          )}
        </div>
        {Object.keys(evidence.metadata).length > 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <h3 className="mb-3 text-[9px] uppercase tracking-wider text-slate-600">Additional metadata</h3>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(evidence.metadata).map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <dt className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">{humanize(key)}</dt>
                  <dd className="break-words font-mono text-[10px] leading-4 text-slate-400">{formatMetadataValue(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <EvidenceContent evidence={evidence} />
        <section className="border border-line bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Link2 size={14} className="text-slate-500" />
            <h2 className="text-xs font-medium text-slate-300">Linked decisions</h2>
            <span className="ml-auto font-mono text-[10px] text-slate-500">{evidence.linked_decision_ids.length}</span>
          </div>
          <div className="px-4 py-3.5">
            {evidence.linked_decisions?.length ? (
              <ul className="space-y-3">
                {evidence.linked_decisions.map((decision) => (
                  <li key={decision.id}>
                    <Link to={`/decisions/${decision.id}`} className="block border border-line px-3 py-3 outline-none hover:border-slate-600 focus-visible:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/40">
                      <div className="flex items-start justify-between gap-2">
                        <span className="break-all font-mono text-[9px] leading-4 text-blue-300/90">{decision.id}</span>
                        <span className={`inline-flex shrink-0 border px-1.5 py-1 text-[9px] text-slate-300 ${statusStyle(decision.status)}`}>{humanize(decision.status)}</span>
                      </div>
                      <p className="mt-2 text-xs font-medium text-slate-300">{decision.agent_id}</p>
                      <p className="mt-1 inline-flex items-center gap-1.5 text-[10px] text-slate-500"><Clock3 size={11} />{formatTimestamp(decision.created_at)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[11px] leading-5 text-slate-500">No decisions are linked to this evidence record.</p>}
          </div>
        </section>
      </div>
    </>
  );
}

export default function EvidenceDetailPage() {
  const { evidenceId = '' } = useParams<{ evidenceId: string }>();
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setEvidence(null);

    getEvidenceById(evidenceId)
      .then((item) => { if (active) setEvidence(item); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'An unexpected error occurred.'); })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [evidenceId]);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link to="/evidence" className="inline-flex items-center gap-2 text-xs text-slate-400 outline-none hover:text-slate-100 focus-visible:ring-1 focus-visible:ring-accent/50"><ArrowLeft size={14} />Back to evidence</Link>
        <span className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Live evidence artifact</span>
      </div>
      {loading ? <LoadingState /> : error ? <ErrorState message={error} /> : evidence ? <EvidenceDetail key={evidence.id} evidence={evidence} /> : <NotFoundState />}
    </>
  );
}
