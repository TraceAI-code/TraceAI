import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, GitCompareArrows, LoaderCircle, RotateCcw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { getReplayById } from '../services/replayService';
import type { ReplayRun } from '../types/replay';

function humanize(value: string): string {
  return value.split(/[_\s-]+/).filter(Boolean).map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(' ');
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function outcomeStyle(value: string): string {
  switch (value.toUpperCase()) {
    case 'APPROVED': return 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300';
    case 'REJECTED': return 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300';
    case 'REVIEW_REQUIRED':
    case 'ESCALATED': return 'border-amber-400/20 bg-amber-400/[0.08] text-amber-300';
    default: return 'border-slate-500/25 bg-slate-500/[0.08] text-slate-300';
  }
}

function OutcomeBadge({ value }: { value: string }) {
  return <span className={`inline-flex border px-2 py-1 text-[10px] font-medium ${outcomeStyle(value)}`}>{humanize(value)}</span>;
}

function LoadingState() {
  return <div role="status" className="flex items-center gap-3 border border-line bg-panel px-5 py-8 text-sm text-slate-400"><LoaderCircle size={17} className="animate-spin text-accent" />Loading replay…</div>;
}

function NotFoundState() {
  return (
    <div className="border border-line bg-panel px-6 py-10 text-center">
      <GitCompareArrows size={20} className="mx-auto text-slate-500" />
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">404 / REPLAY_NOT_FOUND</p>
      <h1 className="mt-2 text-lg font-semibold text-slate-100">Replay not found</h1>
      <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted">This replay ID is not present in the stored replay records.</p>
      <Link to="/replay" className="mt-5 inline-flex items-center gap-2 border border-line px-3 py-2 text-xs text-slate-300 hover:border-slate-600 hover:text-white"><ArrowLeft size={13} />Back to Replay Workspace</Link>
    </div>
  );
}

function ReplayDetail({ replay }: { replay: ReplayRun }) {
  const deterministic = replay.mode === 'DETERMINISTIC';
  return (
    <>
      <div className="mb-6 border-b border-line pb-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link to="/replay" className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-100"><ArrowLeft size={14} />Back to Replay Workspace</Link>
          <span className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Live replay execution</span>
        </div>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-accent/80">Replay / Run detail</p>
        <h1 className="text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">{deterministic ? 'Deterministic replay' : 'What-if replay'}</h1>
        <p className="mt-2 break-all font-mono text-[10px] leading-5 text-slate-400">{replay.id}</p>
        <p className="mt-1 text-[10px] text-slate-500">Decision <Link to={`/decisions/${replay.decision_id}`} className="break-all font-mono text-blue-300/80 outline-none hover:text-blue-200 focus-visible:ring-1 focus-visible:ring-accent/50">{replay.decision_id}</Link></p>
      </div>

      <section className="mb-6 border border-line bg-panel">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          <Metadata label="Mode" value={humanize(replay.mode)} />
          <Metadata label="Status" value={humanize(replay.status)} />
          <Metadata label="Created" value={formatTimestamp(replay.created_at)} />
          <Metadata label="Completed" value={formatTimestamp(replay.completed_at)} />
        </div>
      </section>

      <section className="mb-6 border border-line bg-panel p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">Outcome comparison</h2><Link to={`/decisions/${replay.decision_id}`} className="inline-flex items-center gap-1.5 text-[10px] text-blue-300/80 hover:text-blue-200">Open decision <ArrowRight size={12} /></Link></div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] lg:items-center">
          <div className="border border-line bg-shell px-4 py-4"><p className="text-[9px] uppercase tracking-wider text-slate-500">Original decision</p><div className="mt-2"><OutcomeBadge value={replay.original_result} /></div></div>
          <ArrowRight size={15} className="mx-auto hidden text-slate-600 lg:block" />
          <div className="border border-line bg-shell px-4 py-4"><p className="text-[9px] uppercase tracking-wider text-slate-500">{deterministic ? 'Deterministic replay' : 'What-if replay'}</p><div className="mt-2"><OutcomeBadge value={replay.replay_result} /></div></div>
        </div>
        {replay.original_result === replay.replay_result && <p className="mt-3 text-[10px] text-emerald-300/80">Recorded and replay outcomes match.</p>}
        <p className="mt-4 border-l border-line pl-3 text-xs leading-5 text-slate-300">{replay.summary}</p>
        <p className="mt-3 text-[10px] text-slate-600">Reconstructed from recorded events and tool outputs. This record does not execute the production agent or AI model.</p>
      </section>

      <section className="mb-6 border border-line bg-panel">
        <div className="border-b border-line px-4 py-3 sm:px-5"><h2 className="text-xs font-medium text-slate-300">Conditions</h2></div>
        {replay.conditions.length ? <div className="space-y-2 p-4 sm:p-5">{replay.conditions.map((condition) => <article key={condition.name} className="min-w-0 border border-line/70 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[11px] font-medium text-slate-300">{condition.name}</h3><span className={`text-[9px] ${condition.changed ? 'text-amber-300' : 'text-slate-600'}`}>{condition.changed ? 'Changed' : 'Unchanged'}</span></div><div className="mt-2 grid gap-2 sm:grid-cols-2"><div className="min-w-0"><p className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Original</p><p className="break-words font-mono text-[10px] text-slate-500">{condition.original_value}</p></div><div className="min-w-0"><p className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Replay</p><p className={`break-words font-mono text-[10px] ${condition.changed ? 'text-amber-200' : 'text-slate-500'}`}>{condition.replay_value}</p></div></div></article>)}</div> : <p className="px-5 py-6 text-xs text-slate-500">No condition details are attached to this replay.</p>}
      </section>

      <section className="border border-line bg-panel">
        <div className="border-b border-line px-4 py-3 sm:px-5"><h2 className="text-xs font-medium text-slate-300">Differences</h2></div>
        {replay.differences.length ? <ul className="divide-y divide-line/70">{replay.differences.map((difference) => <li key={`${difference.field}-${difference.original_value}-${difference.replay_value}`} className="border-l border-amber-400/25 px-4 py-3 sm:px-5"><p className="text-xs font-medium text-slate-300">{difference.field}</p><p className="mt-1 break-words font-mono text-[10px] text-slate-400">{difference.original_value} <span className="text-slate-600">→</span> {difference.replay_value}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{difference.significance}</p></li>)}</ul> : <p className="inline-flex items-center gap-2 px-5 py-5 text-xs text-emerald-300/80"><Check size={14} />No material differences detected.</p>}
      </section>
      <div className="mt-5 flex flex-wrap gap-4 text-[10px]"><Link to={`/decisions/${replay.decision_id}`} className="text-blue-300/80 hover:text-blue-200">View Decision Detail</Link><Link to="/replay" className="text-blue-300/80 hover:text-blue-200">Return to Replay Workspace</Link><Link to="/replay" className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-300"><RotateCcw size={11} />Start another replay</Link></div>
    </>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border-b border-line px-4 py-3.5 last:border-b-0 sm:px-5 sm:odd:border-r sm:[&:nth-child(n+3)]:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0"><p className="text-[9px] uppercase tracking-wider text-slate-600">{label}</p><p className="mt-1.5 break-words text-xs font-medium text-slate-200" title={value}>{value}</p></div>;
}

export default function ReplayDetailPage() {
  const { replayId = '' } = useParams<{ replayId: string }>();
  const [replay, setReplay] = useState<ReplayRun | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getReplayById(replayId)
      .then((run) => { if (active) setReplay(run); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [replayId]);

  return <>{loading ? <LoadingState /> : replay ? <ReplayDetail replay={replay} /> : <NotFoundState />}</>;
}
