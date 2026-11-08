"""Trace-reconstruction engine for replaying decisions.

This module reconstructs a recorded decision from its audit chain and evidence
snapshots. It does not execute the production agent or call an AI model. When
``mock_tools`` is enabled, recorded tool outputs are injected from the evidence
store; otherwise missing outputs are marked unavailable instead of being
silently copied.
"""

import copy
import json
from typing import Any
import uuid

from sqlalchemy.orm import Session

from app.core.hashing import canonical_json, canonical_timestamp, hash_event
from app.db.models import AuditEvent, Decision, ReplayRun
from app.replay.comparator import ExecutionComparator
from app.schemas.replay import DiffSummary, ReplayRequest
from app.services.evidence_service import retrieve_evidence_content
from app.services.policy_engine import PolicyEngine


TOOL_EVENT_TYPES = (
    "TOOL_CALL_STARTED",
    "TOOL_CALL_COMPLETED",
    "TOOL_CALL_FAILED",
)

PLACEHOLDER_MARKER = "[Evidence stored"


class ReplayEngine:
    """Reconstructs deterministic or what-if simulations of past decisions.

    Uses recorded evidence snapshots to supply tool outputs without contacting
    external services or causing side effects.
    """

    def __init__(self, db: Session):
        self.db = db
        self.comparator = ExecutionComparator()
        self.policy_engine = PolicyEngine(db)

    def replay_decision(
        self,
        decision_id: uuid.UUID,
        request: ReplayRequest,
    ) -> tuple[ReplayRun, DiffSummary]:
        """Replay a decision run, compare it against the original, and save results."""
        decision = self.db.get(Decision, decision_id)
        if not decision:
            raise ValueError(f"Decision {decision_id} not found")

        # 1. Extract original events into a structured list
        original_events = []
        for ev in sorted(decision.events, key=lambda x: x.sequence_number):
            original_events.append({
                "sequence_number": ev.sequence_number,
                "event_type": ev.event_type,
                "payload": copy.deepcopy(ev.payload),
                "timestamp": ev.timestamp.isoformat(),
                "event_hash": ev.event_hash,
                "previous_hash": ev.previous_hash,
            })

        # 2. Verify the recorded chain before claiming anything about replay
        trace_verified, trace_reason = self._verify_original_chain(decision)

        # 3. Extract recorded tool evidence for mocking
        tool_cache = self._build_tool_evidence_cache(decision)

        # 4. Reconstruct the sandboxed replay
        replayed_events = self._execute_sandbox(
            decision=decision,
            original_events=original_events,
            tool_cache=tool_cache,
            mode=request.mode,
            override_inputs=request.override_inputs,
            mock_tools=request.mock_tools,
            simulated_action=request.simulated_action,
            simulated_reasoning=request.simulated_reasoning,
        )

        # 5. Compare original execution against replayed execution
        diff_summary = self.comparator.compare(
            original_events,
            replayed_events,
            trace_verified=trace_verified,
            trace_verification_reason=trace_reason,
        )

        # 6. Save the replay run record in the database
        replay_record = ReplayRun(
            decision_id=decision.id,
            status=diff_summary.status,
            replay_mode=request.mode,
            similarity_score=diff_summary.overall_similarity,
            diff_summary=diff_summary.model_dump(),
            replayed_events=replayed_events,
        )
        self.db.add(replay_record)
        self.db.commit()
        self.db.refresh(replay_record)

        return replay_record, diff_summary

    def _verify_original_chain(self, decision: Decision) -> tuple[bool, str | None]:
        """Recompute the recorded hash chain to confirm the trace is intact."""
        events: list[AuditEvent] = sorted(
            decision.events,
            key=lambda event: event.sequence_number,
        )
        if not events:
            return False, "Decision has no audit events"

        previous_hash: str | None = None
        for index, event in enumerate(events, start=1):
            if event.sequence_number != index:
                return False, f"Sequence gap at event {event.sequence_number}"

            calculated = hash_event(
                event_type=event.event_type,
                timestamp=canonical_timestamp(event.timestamp),
                payload=event.payload,
                previous_hash=event.previous_hash,
            )
            if calculated != event.event_hash:
                return False, f"Event hash mismatch at sequence {event.sequence_number}"
            if event.previous_hash != previous_hash:
                return False, f"Hash chain broken at sequence {event.sequence_number}"

            previous_hash = event.event_hash

        if decision.root_hash != previous_hash:
            return False, "Decision root hash mismatch"

        return True, None

    def _build_tool_evidence_cache(self, decision: Decision) -> dict[str, Any]:
        """Build lookup maps of recorded tool responses from linked evidence."""
        cache: dict[str, Any] = {
            "by_key": {},
            "by_tool": {},
            "by_type": {},
            "by_role": {},
            "by_id": {},
        }

        for link in decision.evidence_links:
            evidence = link.evidence
            if not evidence:
                continue

            content = retrieve_evidence_content(self.db, evidence.id)
            if content is None:
                continue

            parsed = self._parse_content(content)
            cache["by_type"][evidence.type] = parsed
            cache["by_role"][link.role] = parsed
            cache["by_id"][str(evidence.id)] = parsed

            metadata = evidence.metadata_json or {}
            tool_name = metadata.get("tool_name")
            if not tool_name and evidence.type.startswith("tool_output_"):
                tool_name = evidence.type[len("tool_output_"):]
            if not tool_name:
                continue

            cache["by_tool"].setdefault(tool_name, parsed)
            arguments = metadata.get("arguments")
            if isinstance(arguments, dict):
                cache["by_key"][(tool_name, canonical_json(arguments))] = parsed

        return cache

    def _parse_content(self, content: bytes) -> Any:
        """Decode stored evidence as JSON when possible, otherwise as text."""
        text = content.decode("utf-8", errors="ignore")
        try:
            return json.loads(text)
        except Exception:
            return text

    def _lookup_tool_result(
        self,
        cache: dict[str, Any],
        tool_name: str,
        arguments: Any,
        evidence_ids: Any = None,
    ) -> Any | None:
        """Find a recorded tool result by evidence id, exact arguments, then tool name."""
        if isinstance(evidence_ids, list):
            for evidence_id in evidence_ids:
                value = cache["by_id"].get(str(evidence_id))
                if value is not None:
                    return value

        if isinstance(arguments, dict):
            exact = cache["by_key"].get((tool_name, canonical_json(arguments)))
            if exact is not None:
                return exact

        for key in (tool_name, f"tool_output_{tool_name}", "tool_result", "tool_output"):
            value = cache["by_tool"].get(key)
            if value is not None:
                return value
            value = cache["by_type"].get(key)
            if value is not None:
                return value
            value = cache["by_role"].get(key)
            if value is not None:
                return value

        return None

    def _execute_sandbox(
        self,
        decision: Decision,
        original_events: list[dict],
        tool_cache: dict[str, Any],
        mode: str,
        override_inputs: dict[str, Any],
        mock_tools: bool,
        simulated_action: dict[str, Any] | None = None,
        simulated_reasoning: str | None = None,
    ) -> list[dict[str, Any]]:
        """Reconstruct decision execution in an isolated sandbox environment."""
        replayed_events: list[dict[str, Any]] = []
        effective_inputs = dict(decision.input_data or {})
        overrides_applied = mode == "what_if" and bool(override_inputs)
        if overrides_applied:
            effective_inputs.update(override_inputs)

        # 1. Initialize the replayed decision
        replayed_events.append({
            "sequence_number": 1,
            "event_type": "DECISION_CREATED",
            "source": "simulated" if overrides_applied else "recorded",
            "payload": {
                "agent_id": decision.agent_id,
                "agent_version": decision.agent_version,
                "input_data": effective_inputs,
                "replay_mode": mode,
            },
        })

        seq = 2
        # Traverse original events and reconstruct corresponding logic
        for ev in original_events:
            event_type = ev["event_type"]
            orig_payload = copy.deepcopy(ev["payload"])

            if event_type == "DECISION_CREATED":
                continue

            # Handle tool executions by using cached mock results
            if event_type in TOOL_EVENT_TYPES:
                tool_name = (
                    orig_payload.get("tool_name")
                    or orig_payload.get("tool")
                    or "unknown_tool"
                )
                arguments = orig_payload.get("arguments")
                if arguments is None:
                    arguments = orig_payload.get("input")

                replayed_payload = {
                    **orig_payload,
                    "tool_name": tool_name,
                }
                if arguments is not None:
                    replayed_payload["arguments"] = arguments

                source = "recorded"
                result_available = True

                if event_type == "TOOL_CALL_COMPLETED":
                    result = orig_payload.get("result")
                    if result is None:
                        result = orig_payload.get("output")
                    placeholder = (
                        isinstance(result, str)
                        and PLACEHOLDER_MARKER in result
                    )

                    if not mock_tools:
                        # Without tool mocking, replay must not pretend it has
                        # the recorded output available.
                        result = None
                        result_available = False
                        source = "unavailable"
                    elif placeholder or result is None:
                        cached = self._lookup_tool_result(
                            tool_cache,
                            tool_name,
                            arguments,
                            orig_payload.get("evidence_ids"),
                        )
                        if cached is not None:
                            result = cached
                            source = "mocked_tool"
                        else:
                            # The original output lived in evidence storage and
                            # could not be recovered. Do not pretend it matched.
                            result = None
                            result_available = False
                            source = "unavailable"

                    replayed_payload["result"] = result
                    replayed_payload["tool_result_available"] = result_available
                    replayed_payload["mocked_from_evidence"] = source == "mocked_tool"

                    if overrides_applied:
                        # Tool outputs are recorded, not recomputed, so they may
                        # be stale relative to the simulated inputs.
                        replayed_payload["stale_tool_output"] = True

                replayed_events.append({
                    "sequence_number": seq,
                    "event_type": event_type,
                    "source": source,
                    "payload": replayed_payload,
                })
                seq += 1

            # Re-evaluate policies against the effective inputs
            elif event_type == "POLICY_EVALUATION":
                pol_report = self.policy_engine.evaluate_decision(
                    decision_id=decision.id,
                    target_payload=effective_inputs,
                    record_audit_event=False,
                )
                replayed_events.append({
                    "sequence_number": seq,
                    "event_type": "POLICY_EVALUATION",
                    "source": "simulated",
                    "payload": {
                        "status": pol_report.get("status", "not_evaluated"),
                        "policies_evaluated": pol_report.get("evaluated_policies", []),
                        "violations_count": len(pol_report.get("violations", [])),
                        "violations": pol_report.get("violations", []),
                        "replay_mode": mode,
                    },
                })
                seq += 1

            # Handle model inferences, reasoning, and actions taken
            elif event_type in (
                "LLM_INVOCATION_STARTED",
                "LLM_INVOCATION_COMPLETED",
                "MODEL_INFERENCE",
                "OUTPUT",
                "ACTION_TAKEN",
                "PLAN_GENERATED",
            ):
                replayed_payload = copy.deepcopy(orig_payload)
                source = "recorded"

                if mode == "what_if":
                    if event_type in ("MODEL_INFERENCE", "LLM_INVOCATION_COMPLETED") and simulated_reasoning:
                        if "rationale" in replayed_payload:
                            replayed_payload["rationale"] = simulated_reasoning
                        elif "generations" in replayed_payload:
                            replayed_payload["generations"] = [{"text": simulated_reasoning}]
                        else:
                            replayed_payload["simulated_reasoning"] = simulated_reasoning
                        source = "simulated"

                    elif event_type == "ACTION_TAKEN" and simulated_action is not None:
                        replayed_payload = copy.deepcopy(simulated_action)
                        source = "simulated"

                    if overrides_applied:
                        replayed_payload["_simulation_note"] = "Inputs modified during what-if simulation"
                        replayed_payload["_overridden_keys"] = list(override_inputs.keys())

                replayed_events.append({
                    "sequence_number": seq,
                    "event_type": event_type,
                    "source": source,
                    "payload": replayed_payload,
                })
                seq += 1

            # Handle any other custom agent events
            else:
                replayed_payload = copy.deepcopy(orig_payload)
                if overrides_applied:
                    replayed_payload["_overridden_keys"] = list(override_inputs.keys())
                replayed_events.append({
                    "sequence_number": seq,
                    "event_type": event_type,
                    "source": "recorded",
                    "payload": replayed_payload,
                })
                seq += 1

        # The terminal event (DECISION_COMPLETED / DECISION_FAILED) is part of
        # the recorded chain above. Do not synthesize one: a trace that never
        # completed must not be replayed as if it had.
        return replayed_events
