import { useEffect, useMemo, useState } from 'react';
import {

  ArrowRight,
  Check,
  Clock3,
  FileSearch,
  GitCompareArrows,
  LoaderCircle,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { getDecisionDetail } from '../services/decisionDetailService';
import { getDecisions } from '../services/decisionService';
import { createDeterministicReplay, createWhatIfReplay, getReplayRunsForDecision } from '../services/replayService';
import type { Decision } from '../types/decision';
import type { DecisionDetail } from '../types/decisionDetail';
import type { ReplayRun } from '../types/replay';

type ReplayMode = 'DETERMINISTIC' | 'WHAT_IF';
type ConditionValueType = 'string' | 'number' | 'boolean' | 'json';
interface ConditionField { name: string; value: string; valueType: ConditionValueType; }

function conditionFieldsFromInput(input: Record<string, unknown>): ConditionField[] {
  return Object.entries(input).map(([name, value]) => {
    if (typeof value === 'number') return { name, value: String(value), valueType: 'number' as const };
    if (typeof value === 'boolean') return { name, value: String(value), valueType: 'boolean' as const };
    if (value === null) return { name, value: '', valueType: 'string' as const };
    if (typeof value === 'object') return { name, value: JSON.stringify(value, null, 2), valueType: 'json' as const };
    return { name, value: String(value), valueType: 'string' as const };
  });
}

function humanize(value: string): string {
  return value.split(/[_\s-]+/).filter(Boolean).map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(' ');
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function normalizeOutcome(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim().toUpperCase();
  if (normalized.includes('APPROVE') || normalized.includes('ACCEPT')) return 'APPROVED';
  if (normalized.includes('REJECT') || normalized.includes('DENY') || normalized.includes('DECLINE')) return 'REJECTED';
  if (normalized.includes('REVIEW') || normalized.includes('ESCALAT') || normalized.includes('CHALLENGE')) return 'REVIEW_REQUIRED';
  return normalized;
}

function getOriginalResult(decision: Decision, detail: DecisionDetail | null): string {
  const outcomeEvent = [...(detail?.events ?? [])].reverse().find(
    (event) => ['ACTION_TAKEN', 'OUTPUT', 'DECISION_MADE', 'DECISION_COMPLETED'].includes(event.event_type),
  );
  const payload = outcomeEvent?.payload;
  const recorded = normalizeOutcome(payload?.['action'])
    ?? normalizeOutcome(payload?.['verdict'])
    ?? normalizeOutcome(payload?.['decision'])
    ?? normalizeOutcome(payload?.['status']);
  if (recorded && recorded !== 'COMPLETED') return recorded;

  const status = decision.status.toLowerCase();
  if (status.includes('approved')) return 'APPROVED';
  if (status.includes('rejected')) return 'REJECTED';
  if (status.includes('challenged') || status.includes('policy_violated')) return 'REVIEW_REQUIRED';
  return status ? decision.status.toUpperCase() : 'UNKNOWN';
}

function resultStyle(result: string): string {
  switch (result.toUpperCase()) {
    case 'APPROVED': return 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300';
    case 'REJECTED': return 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300';
    case 'REVIEW_REQUIRED':
    case 'ESCALATED': return 'border-amber-400/20 bg-amber-400/[0.08] text-amber-300';
    default: return 'border-slate-500/25 bg-slate-500/[0.08] text-slate-300';
  }
}

function ResultBadge({ result }: { result: string }) {
  return <span className={`inline-flex border px-2 py-1 text-[10px] font-medium ${resultStyle(result)}`}>{humanize(result)}</span>;
}

function ResultPanel({ label, result, subtitle }: { label: string; result: string; subtitle: string }) {
  return (
    <div className="min-w-0 border border-line bg-shell px-4 py-4">
      <p className="text-[9px] uppercase tracking-[0.15em] text-slate-500">{label}</p>
      <p className="mt-2 break-words text-lg font-semibold tracking-wide text-slate-100">{humanize(result)}</p>
      <p className="mt-1 break-words text-[10px] text-slate-500">{subtitle}</p>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return <div role="status" className="flex items-center gap-2 text-xs text-slate-500"><LoaderCircle size={14} className="animate-spin text-accent" />{label}</div>;
}

function NoReplaySelected() {
  return (
    <div className="border border-dashed border-line bg-panel/60 px-5 py-10 text-center">
      <GitCompareArrows size={21} className="mx-auto text-slate-500" />
      <h2 className="mt-3 text-sm font-medium text-slate-200">No replay selected</h2>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-muted">Select a decision and run a deterministic or what-if replay to compare its recorded outcome.</p>
    </div>
  );
}

function ReplayResult({ replay, decision, detail }: { replay: ReplayRun; decision: Decision; detail: DecisionDetail | null }) {

  return (
    <section className="border border-line bg-panel">
      <div className="flex flex-col justify-between gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-start sm:px-5">
        <div className="min-w-0">
          <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.15em] text-accent/75">Replay result · {humanize(replay.mode)}</p>
          <h2 className="break-all font-mono text-[10px] text-slate-500">{replay.id}</h2>
        </div>
        <span className={`inline-flex w-fit items-center gap-1.5 border px-2 py-1 text-[9px] uppercase tracking-wider ${['COMPLETED', 'MATCHED'].includes(replay.status) ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300' : replay.status === 'FAILED' ? 'border-rose-400/20 bg-rose-400/[0.06] text-rose-300' : 'border-amber-400/20 bg-amber-400/[0.06] text-amber-300'}`}>
          {['COMPLETED', 'MATCHED'].includes(replay.status) ? <Check size={11} /> : <Clock3 size={11} />}{humanize(replay.status)}
        </span>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] lg:items-center lg:p-5">
        <ResultPanel label="Original decision" result={replay.original_result} subtitle={decision.id} />
        <ArrowRight size={15} className="mx-auto hidden text-slate-600 lg:block" />
        <ResultPanel label={replay.mode === 'WHAT_IF' ? 'What-if replay' : 'Deterministic replay'} result={replay.replay_result} subtitle="Reconstructed from recorded events and tool outputs" />
      </div>

      {replay.original_result === replay.replay_result && <p className="px-4 pb-1 text-[10px] text-emerald-300/80 sm:px-5">Recorded and replay outcomes match.</p>}

      <div className="px-4 pb-5 sm:px-5">
        <div className="border-l border-line pl-3">
          <p className="text-[9px] uppercase tracking-wider text-slate-600">Summary</p>
          <p className="mt-1 text-xs leading-5 text-slate-300">{replay.summary}</p>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Condition comparison</h3>
            <span className="text-right text-[9px] text-slate-600">Only changed conditions are marked</span>
          </div>
          {replay.conditions.length ? (
            <div className="space-y-2">
              {replay.conditions.map((condition) => (
                <div key={condition.name} className="min-w-0 border border-line/70 px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] font-medium text-slate-300">{condition.name}</p>{condition.changed ? <span className="text-[9px] text-amber-300">Changed</span> : <span className="text-[9px] text-slate-600">Unchanged</span>}</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2"><div className="min-w-0"><p className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Original condition</p><p className="break-words font-mono text-[10px] text-slate-500">{condition.original_value}</p></div><div className="min-w-0"><p className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Replay condition</p><p className={`break-words font-mono text-[10px] ${condition.changed ? 'text-amber-200' : 'text-slate-500'}`}>{condition.replay_value}</p></div></div>
                </div>
              ))}
            </div>
          ) : <p className="text-[11px] text-slate-500">No input conditions were captured for this decision.</p>}
        </div>

        <div className="mt-5 grid gap-4 border-t border-line pt-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500">Why did it change?</h3>
            {replay.differences.length ? (
              <ul className="space-y-2">
                {replay.differences.map((difference) => (
                  <li key={`${difference.field}-${difference.original_value}-${difference.replay_value}`} className="border-l border-amber-400/30 pl-3">
                    <p className="text-[11px] font-medium text-slate-300">{difference.field}</p>
                    <p className="mt-0.5 break-words font-mono text-[10px] text-slate-400">{difference.original_value} <span className="text-slate-600">→</span> {difference.replay_value}</p>
                    <p className="mt-1 text-[10px] leading-4 text-slate-500">{difference.significance}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="inline-flex items-center gap-2 text-[11px] text-emerald-300/80"><Check size={13} />No material differences detected.</p>}
          </div>
          <div>
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500">Evidence & policy references</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {[{ label: 'Original decision', replay: false }, { label: 'Replay', replay: true }].map(({ label, replay: isReplay }) => {
                return (
                  <div key={label} className="min-w-0 border border-line/70 px-3 py-3">
                    <p className="mb-2 text-[9px] uppercase tracking-wider text-slate-600">{label}</p>
                    <p className="mb-1 text-[9px] text-slate-600">Evidence</p>
                    {!isReplay && detail?.evidence.length ? detail.evidence.map((item) => (
                      <Link key={item.id} to={`/evidence/${item.id}`} className="mb-1 block break-all font-mono text-[9px] text-blue-300/75 outline-none hover:text-blue-200 focus-visible:ring-1 focus-visible:ring-accent/50">{item.id}</Link>
                    )) : <p className="mb-1 text-[9px] text-slate-600">{isReplay ? 'Uses the same recorded evidence' : 'No evidence reference'}</p>}
                    <p className="mb-1 mt-2 text-[9px] text-slate-600">Policy</p>
                    {detail?.policies.length ? detail.policies.map((item) => (
                      <Link key={item.id} to={`/policies/${item.id}`} className="block break-words text-[9px] text-blue-300/75 outline-none hover:text-blue-200 focus-visible:ring-1 focus-visible:ring-accent/50">{item.name} · v{item.version}</Link>
                    )) : <p className="text-[9px] text-slate-600">No policy reference</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-[10px] text-slate-500">
          <span>Created {formatTimestamp(replay.created_at)}{replay.completed_at ? ` · completed ${formatTimestamp(replay.completed_at)}` : ''}</span>
          <Link to={`/decisions/${decision.id}`} className="inline-flex items-center gap-1.5 text-blue-300/80 outline-none hover:text-blue-200 focus-visible:ring-1 focus-visible:ring-accent/50">Open original decision <ArrowRight size={12} /></Link>
        </div>
      </div>
    </section>
  );
}

export default function ReplayPage() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [decisionQuery, setDecisionQuery] = useState('');
  const [selectedDecisionId, setSelectedDecisionId] = useState('');
  const [detail, setDetail] = useState<DecisionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [decisionLoading, setDecisionLoading] = useState(true);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [mode, setMode] = useState<ReplayMode>('DETERMINISTIC');
  const [whatIfValues, setWhatIfValues] = useState<Record<string, string>>({});
  const [activeReplay, setActiveReplay] = useState<ReplayRun | null>(null);
  const [history, setHistory] = useState<ReplayRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDecisionLoading(true);
    getDecisions()
      .then((items) => { if (active) setDecisions(items); })
      .catch((cause: unknown) => { if (active) setDecisionError(cause instanceof Error ? cause.message : 'An unexpected error occurred.'); })
      .finally(() => { if (active) setDecisionLoading(false); });
    return () => { active = false; };
  }, []);

  const selectedDecision = decisions.find((decision) => decision.id === selectedDecisionId) ?? null;
  const conditionFields = useMemo(() => detail ? conditionFieldsFromInput(detail.input_data) : [], [detail]);
  const originalResult = selectedDecision ? getOriginalResult(selectedDecision, detail) : '';
  const changedConditionCount = conditionFields.filter((condition) => (whatIfValues[condition.name] ?? condition.value) !== condition.value).length;

  useEffect(() => {
    setWhatIfValues(Object.fromEntries(conditionFields.map((condition) => [condition.name, condition.value])));
  }, [conditionFields]);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setActiveReplay(null);
    setDetailError(null);
    setHistory([]);
    if (!selectedDecisionId) {
      setDetailLoading(false);
      setHistoryLoading(false);
      setWhatIfValues({});
      return () => { active = false; };
    }

    setDetailLoading(true);
    setHistoryLoading(true);
    getDecisionDetail(selectedDecisionId)
      .then((record) => { if (active) setDetail(record); })
      .catch((cause: unknown) => { if (active) setDetailError(cause instanceof Error ? cause.message : 'Could not load the original decision context.'); })
      .finally(() => { if (active) setDetailLoading(false); });
    getReplayRunsForDecision(selectedDecisionId)
      .then((runs) => { if (active) setHistory(runs); })
      .finally(() => { if (active) setHistoryLoading(false); });

    return () => { active = false; };
  }, [selectedDecisionId, decisions]);

  const filteredDecisions = useMemo(() => {
    const query = decisionQuery.trim().toLowerCase();
    if (!query) return decisions;
    return decisions.filter((decision) => decision.id.toLowerCase().includes(query) || decision.agent_id.toLowerCase().includes(query));
  }, [decisions, decisionQuery]);

  const handleRun = async () => {
    if (!selectedDecision) return;
    setRunLoading(true);
    setRunError(null);
    try {
      const run = mode === 'DETERMINISTIC'
        ? await createDeterministicReplay(selectedDecision.id)
        : await createWhatIfReplay(
            selectedDecision.id,
            conditionFields.map((condition) => {
              const replayValue = whatIfValues[condition.name] ?? condition.value;
              return {
                name: condition.name,
                original_value: condition.value,
                replay_value: replayValue,
                changed: replayValue !== condition.value,
                value_type: condition.valueType,
              };
            }),
          );
      setActiveReplay(run);
      setHistory(await getReplayRunsForDecision(selectedDecision.id));
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : 'The replay could not be created.');
    } finally {
      setRunLoading(false);
    }
  };

  const selectHistoricalReplay = async (replay: ReplayRun) => {
    setActiveReplay(replay);
    setMode(replay.mode === 'WHAT_IF' ? 'WHAT_IF' : 'DETERMINISTIC');
    if (replay.mode === 'WHAT_IF') {
      setWhatIfValues(Object.fromEntries(replay.conditions.map((condition) => [condition.name, condition.replay_value])));
    }
  };

  return (
    <>
      <PageHeader eyebrow="Audit / Replay" title="Decision Replay" description="Reconstruct a recorded decision from its captured information, then explore how changed conditions affect its modeled outcome." />

      <div className="mb-6 flex items-start gap-3 border border-emerald-400/20 bg-emerald-400/[0.04] px-4 py-3">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-400" />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-emerald-300">Live Replay & Simulation Engine</p>
          <p className="mt-1 text-[11px] leading-5 text-slate-400">Replays are executed dynamically in the backend sandbox using recorded tool responses from the Evidence Store.</p>
        </div>
      </div>

      {decisionError ? <div role="alert" className="mb-5 border border-rose-400/20 bg-rose-400/[0.04] px-5 py-4 text-xs text-rose-200">Could not load decisions: {decisionError}</div> : null}

      <section className="mb-6 border border-line bg-panel p-4 sm:p-5">
        <div className="mb-3 flex items-center gap-2"><Search size={14} className="text-slate-500" /><h2 className="text-xs font-medium text-slate-300">Choose a decision</h2></div>
        <div className="grid gap-3 lg:grid-cols-2">
          <label className="relative block min-w-0">
            <span className="mb-1.5 block text-[10px] text-slate-500">1 · Search available decisions</span>
            <Search size={14} className="pointer-events-none absolute left-3 top-[2.45rem] -translate-y-1/2 text-slate-600" />
            <input aria-label="Search available decisions by ID or agent" value={decisionQuery} onChange={(event) => setDecisionQuery(event.target.value)} placeholder="Filter by decision ID or agent" className="h-10 w-full border border-line bg-shell pl-9 pr-9 text-xs text-slate-300 outline-none placeholder:text-slate-600 focus:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/30" />
            {decisionQuery && <button type="button" aria-label="Clear decision search" onClick={() => setDecisionQuery('')} className="absolute right-2 top-[2.45rem] -translate-y-1/2 p-1 text-slate-500 outline-none hover:text-slate-200 focus-visible:ring-1 focus-visible:ring-accent/50"><X size={13} /></button>}
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[10px] text-slate-500">2 · Select the decision to investigate</span>
            <select
              aria-label="Choose a decision"
              value={selectedDecisionId}
              onChange={(event) => {
                setSelectedDecisionId(event.target.value);
                setActiveReplay(null);
              }}
              disabled={decisionLoading}
              className="h-10 w-full min-w-0 border border-line bg-shell px-3 text-xs text-slate-200 outline-none focus:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/30 disabled:opacity-50"
            >
              <option value="" className="bg-[#0e141d] text-slate-400">
                {decisionLoading ? 'Loading decisions…' : 'Select a decision'}
              </option>
              {selectedDecision && !filteredDecisions.some((decision) => decision.id === selectedDecision.id) && (
                <option value={selectedDecision.id} className="bg-[#0e141d] text-slate-200">
                  {selectedDecision.agent_id} · {selectedDecision.id}
                </option>
              )}
              {filteredDecisions.map((decision) => (
                <option key={decision.id} value={decision.id} className="bg-[#0e141d] text-slate-200">
                  {decision.agent_id} · {decision.id}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selectedDecision && (
          <div className="mt-4 border border-line bg-shell/70 p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Selected decision</p><p className="break-all font-mono text-[10px] text-slate-300">{selectedDecision.id}</p></div><Link to={`/decisions/${selectedDecision.id}`} className="shrink-0 text-[10px] text-blue-300/80 outline-none hover:text-blue-200 focus-visible:ring-1 focus-visible:ring-accent/50">Open detail <ArrowRight size={11} className="inline" /></Link></div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500"><span>{selectedDecision.agent_id}</span><span className="font-mono">v{selectedDecision.agent_version}</span><span>Original status · {humanize(selectedDecision.status)}</span></div>
          </div>
        )}
        {!selectedDecision && !decisionLoading && <p className="mt-3 text-[10px] text-slate-600">Search to narrow the available decisions, then choose one from the selector.</p>}
      </section>

      {!selectedDecision ? (
        <div className="mb-6"><NoReplaySelected /></div>
      ) : (
        <>
          <section className="mb-6 border border-line bg-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5"><div><p className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-accent/70">Investigation context</p><h2 className="text-xs font-medium text-slate-300">Original decision</h2></div><Link to={`/decisions/${selectedDecision.id}`} className="inline-flex items-center gap-1.5 text-[10px] text-blue-300/80 hover:text-blue-200">Open decision detail <ArrowRight size={12} /></Link></div>
            {detailLoading ? <div className="px-5 py-4"><LoadingState label="Loading recorded context…" /></div> : (
              <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5 xl:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(100px,0.7fr))]">
                <div className="sm:col-span-2 xl:col-span-1"><p className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Decision summary</p><p className="text-xs leading-5 text-slate-300">{detail?.decision_summary ?? 'Detailed recorded context is unavailable for this decision.'}</p></div>
                <div><p className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Agent</p><p className="break-words text-xs text-slate-300">{selectedDecision.agent_id}</p><p className="mt-1 font-mono text-[10px] text-slate-500">v{selectedDecision.agent_version}</p></div>
                <div><p className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Status / result</p><p className="text-xs text-slate-300">{humanize(selectedDecision.status)}</p><p className="mt-1"><ResultBadge result={originalResult} /></p></div>
                <div><p className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">Created / events</p><p className="text-xs text-slate-300">{formatTimestamp(selectedDecision.created_at)}</p><p className="mt-1 font-mono text-[10px] text-slate-500">{detail?.event_count ?? selectedDecision.event_count} events</p></div>
                <div><p className="mb-1 text-[9px] uppercase tracking-wider text-slate-600">References</p><div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">{detail?.evidence.length ? <Link to={`/evidence/${detail.evidence[0].id}`} className="inline-flex items-center gap-1 text-blue-300/80 hover:text-blue-200"><FileSearch size={11} />{detail.evidence.length} evidence</Link> : <span className="text-slate-600">No evidence linked</span>}{detail?.policies.length ? <Link to={`/policies/${detail.policies[0].id}`} className="text-blue-300/80 hover:text-blue-200">{detail.policies.length} policy</Link> : <span className="text-slate-600">No policy linked</span>}</div></div>
                {detailError && <p role="alert" className="text-[10px] text-rose-300 sm:col-span-2 xl:col-span-5">Original decision detail unavailable: {detailError}</p>}
              </div>
            )}
          </section>

          <section className="mb-6">
            <div className="mb-3 flex items-center gap-2"><SlidersHorizontal size={14} className="text-slate-500" /><h2 className="text-xs font-medium text-slate-300">Replay mode</h2></div>
            <div className="grid gap-3 md:grid-cols-2">
              <button type="button" aria-pressed={mode === 'DETERMINISTIC'} onClick={() => { setMode('DETERMINISTIC'); setActiveReplay(null); }} className={`border px-4 py-4 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent/50 ${mode === 'DETERMINISTIC' ? 'border-accent/35 bg-accent/[0.045]' : 'border-line bg-panel hover:border-slate-600'}`}>
                <span className="flex items-center justify-between"><span className="text-xs font-medium text-slate-200">Deterministic replay</span><RotateCcw size={15} className={mode === 'DETERMINISTIC' ? 'text-accent' : 'text-slate-500'} /></span>
                <span className="mt-1.5 block text-[11px] leading-5 text-slate-500">Replay the recorded conditions to examine reproducibility.</span>
              </button>
              <button type="button" aria-pressed={mode === 'WHAT_IF'} onClick={() => { setMode('WHAT_IF'); setActiveReplay(null); }} className={`border px-4 py-4 text-left outline-none focus-visible:ring-1 focus-visible:ring-accent/50 ${mode === 'WHAT_IF' ? 'border-accent/35 bg-accent/[0.045]' : 'border-line bg-panel hover:border-slate-600'}`}>
                <span className="flex items-center justify-between"><span className="text-xs font-medium text-slate-200">What-if replay</span><GitCompareArrows size={15} className={mode === 'WHAT_IF' ? 'text-accent' : 'text-slate-500'} /></span>
                <span className="mt-1.5 block text-[11px] leading-5 text-slate-500">Change selected conditions to explore a hypothetical outcome.</span>
              </button>
            </div>
          </section>

          {mode === 'WHAT_IF' && (
            <section className="mb-6 border border-line bg-panel">
              <div className="border-b border-line px-4 py-3 sm:px-5"><h2 className="text-xs font-medium text-slate-300">What-if conditions</h2><p className="mt-1 text-[10px] text-slate-500">Edit the input fields captured with this decision. Values are re-evaluated by the recorded policy engine.</p></div>
              <div className="divide-y divide-line/70">
                {conditionFields.length === 0 && <p className="px-4 py-6 text-xs text-slate-500 sm:px-5">This decision was recorded without input fields, so there is nothing to override.</p>}
                {conditionFields.map((condition) => {
                  const replayValue = whatIfValues[condition.name] ?? condition.value;
                  const changed = replayValue !== condition.value;
                  return (
                    <label key={condition.name} className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[minmax(120px,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:px-5">
                      <span className="text-[11px] font-medium text-slate-300">{humanize(condition.name)}</span>
                      <span className="min-w-0 border border-line/70 bg-shell/50 px-3 py-2"><span className="mb-1 block text-[9px] uppercase tracking-wider text-slate-600">Original condition</span><span className="block break-words font-mono text-[11px] text-slate-500">{condition.value || '—'}</span></span>
                      <span className="min-w-0"><span className="mb-1 block text-[9px] uppercase tracking-wider text-slate-600">What-if value</span>
                        {condition.valueType === 'boolean' ? (
                          <select aria-label={`${condition.name} what-if value`} value={replayValue} onChange={(event) => { setWhatIfValues((current) => ({ ...current, [condition.name]: event.target.value })); setActiveReplay(null); }} className={`h-10 w-full border bg-shell px-3 font-mono text-[11px] outline-none focus:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/30 sm:h-9 ${changed ? 'border-amber-400/30 text-amber-200' : 'border-line text-slate-300'}`}>
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : (
                          <input aria-label={`${condition.name} what-if value`} type={condition.valueType === 'number' ? 'number' : 'text'} value={replayValue} onChange={(event) => { setWhatIfValues((current) => ({ ...current, [condition.name]: event.target.value })); setActiveReplay(null); }} className={`h-10 w-full border bg-shell px-3 font-mono text-[11px] outline-none focus:border-accent/50 focus-visible:ring-1 focus-visible:ring-accent/30 sm:h-9 ${changed ? 'border-amber-400/30 text-amber-200' : 'border-line text-slate-300'}`} />
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5"><span className="text-[10px] text-slate-500">{changedConditionCount ? `${changedConditionCount} condition${changedConditionCount === 1 ? '' : 's'} changed` : 'No conditions changed'}</span><button type="button" onClick={() => { setWhatIfValues(Object.fromEntries(conditionFields.map((condition) => [condition.name, condition.value]))); setActiveReplay(null); }} className="min-h-9 text-[10px] text-slate-400 outline-none hover:text-slate-200 focus-visible:ring-1 focus-visible:ring-accent/50">Reset conditions</button></div>
            </section>
          )}

          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[10px] leading-5 text-slate-600">Replays are reconstructed from recorded events and evidence. No AI model or external service is contacted.</div>
            <button type="button" disabled={runLoading || detailLoading} onClick={handleRun} className="inline-flex h-10 items-center justify-center gap-2 border border-accent/30 bg-accent/[0.08] px-4 text-xs font-medium text-blue-200 outline-none hover:border-accent/50 hover:bg-accent/[0.12] focus-visible:ring-1 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50">
              {runLoading ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={13} />}{runLoading ? 'Preparing replay…' : mode === 'WHAT_IF' ? 'Run What-If Replay' : 'Run Deterministic Replay'}
            </button>
          </div>
          {runError && <p role="alert" className="mb-5 border border-rose-400/20 bg-rose-400/[0.04] px-4 py-3 text-xs text-rose-200">{runError}</p>}
          {activeReplay && <div className="mb-7"><ReplayResult replay={activeReplay} decision={selectedDecision} detail={detail} /></div>}

          <section className="border border-line bg-panel">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5"><div><p className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">Selected decision</p><h2 className="text-xs font-medium text-slate-300">Replay history</h2></div><span className="font-mono text-[10px] text-slate-500">{history.length} runs</span></div>
            {historyLoading ? <div className="px-5 py-4"><LoadingState label="Loading replay history…" /></div> : history.length ? (
              <ul className="divide-y divide-line/70">{history.map((run) => <li key={run.id} className={`min-w-0 p-4 sm:px-5 ${activeReplay?.id === run.id ? 'bg-white/[0.025]' : ''}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><Link to={`/replay/${run.id}`} className="break-all font-mono text-[10px] text-blue-300/80 outline-none hover:text-blue-200 focus-visible:ring-1 focus-visible:ring-accent/50">{run.id}</Link><p className="mt-1 break-all font-mono text-[9px] text-slate-600">Decision · {run.decision_id}</p></div><span className="text-[10px] text-slate-500">{formatTimestamp(run.created_at)}</span></div><div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line/70 pt-3"><span className="text-[10px] text-slate-400">{humanize(run.mode)}</span><span className="text-[10px] text-slate-500">{humanize(run.status)}</span><div className="flex flex-wrap items-center gap-2"><span className="text-[9px] text-slate-600">Original</span><ResultBadge result={run.original_result} /><ArrowRight size={12} className="text-slate-600" /><span className="text-[9px] text-slate-600">Replay</span><ResultBadge result={run.replay_result} /></div><button type="button" onClick={() => { void selectHistoricalReplay(run); }} className="ml-auto min-h-9 border border-line px-3 text-[10px] text-slate-400 outline-none hover:border-slate-600 hover:text-slate-200 focus-visible:ring-1 focus-visible:ring-accent/50">Load comparison</button></div></li>)}</ul>
            ) : <div className="px-5 py-7 text-xs text-slate-500">No replay history for this decision yet. Run a replay to create a replay record.</div>}
          </section>
        </>
      )}
    </>
  );
}
