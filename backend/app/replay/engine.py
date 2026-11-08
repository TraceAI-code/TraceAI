"""Sandboxed execution engine for replaying decisions."""

import copy
from typing import Any
import uuid
from sqlalchemy.orm import Session

from app.db.models import Decision, ReplayRun
from app.replay.comparator import ExecutionComparator
from app.schemas.replay import DiffSummary, ReplayRequest
from app.services.evidence_service import retrieve_evidence_content
from app.services.policy_engine import PolicyEngine


class ReplayEngine:
    """Executes deterministic or what-if replay simulations of past decisions.

    Uses recorded evidence snapshots to mock tool outputs without contacting
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

        # 2. Extract recorded tool evidence for mocking
        tool_cache = self._build_tool_evidence_cache(decision)

        # 3. Execute sandboxed replay simulation
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

        # 4. Compare original execution against replayed execution
        diff_summary = self.comparator.compare(original_events, replayed_events)

        # 5. Save the replay run record in the database
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

    def _build_tool_evidence_cache(self, decision: Decision) -> dict[str, Any]:
        """Build a lookup map of recorded tool responses from linked evidence snapshots."""
        cache = {}
        for link in decision.evidence_links:
            ev = link.evidence
            if ev:
                content = retrieve_evidence_content(self.db, ev.id)
                if content:
                    try:
                        import json
                        parsed = json.loads(content.decode("utf-8"))
                        cache[ev.type] = parsed
                        cache[link.role] = parsed
                    except Exception:
                        cache[ev.type] = content.decode("utf-8", errors="ignore")
        return cache

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
        replayed_events = []
        effective_inputs = dict(decision.input_data or {})
        if mode == "what_if" and override_inputs:
            effective_inputs.update(override_inputs)

        # 1. Initialize the replayed decision
        replayed_events.append({
            "sequence_number": 1,
            "event_type": "DECISION_CREATED",
            "payload": {
                "agent_id": decision.agent_id,
                "agent_version": decision.agent_version,
                "input_data": effective_inputs,
                "replay_mode": mode,
            },
        })

        seq = 2
        # Traverse original events and replay corresponding logic
        for ev in original_events:
            event_type = ev["event_type"]
            orig_payload = copy.deepcopy(ev["payload"])

            if event_type in ("DECISION_CREATED", "DECISION_COMPLETED"):
                continue

            # Handle tool executions by using cached mock results
            if event_type in ("TOOL_CALL_STARTED", "TOOL_CALL_COMPLETED", "TOOL_CALL_FAILED"):
                tool_name = orig_payload.get("tool_name", "unknown_tool")
                replayed_payload = {
                    **orig_payload,
                    "tool_name": tool_name,
                }
                if event_type == "TOOL_CALL_COMPLETED":
                    mocked_result = orig_payload.get("result")
                    if mocked_result is None or (isinstance(mocked_result, str) and "[Evidence stored" in mocked_result):
                        mocked_result = (
                            tool_cache.get(f"tool_output_{tool_name}")
                            or tool_cache.get(tool_name)
                            or mocked_result
                        )
                    replayed_payload["result"] = mocked_result
                    replayed_payload["mocked_from_evidence"] = mock_tools
                replayed_events.append({
                    "sequence_number": seq,
                    "event_type": event_type,
                    "payload": replayed_payload,
                })
                seq += 1

            # Re-evaluate policies against inputs
            elif event_type == "POLICY_EVALUATION":
                pol_report = self.policy_engine.evaluate_decision(
                    decision_id=decision.id,
                    target_payload=effective_inputs,
                    record_audit_event=False,
                )
                replayed_events.append({
                    "sequence_number": seq,
                    "event_type": "POLICY_EVALUATION",
                    "payload": {
                        "status": "passed" if pol_report.get("passed", True) else "violated",
                        "violations_count": len(pol_report.get("violations", [])),
                        "violations": pol_report.get("violations", []),
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
                if mode == "what_if":
                    if event_type in ("MODEL_INFERENCE", "LLM_INVOCATION_COMPLETED") and simulated_reasoning:
                        if "rationale" in replayed_payload:
                            replayed_payload["rationale"] = simulated_reasoning
                        elif "generations" in replayed_payload:
                            replayed_payload["generations"] = [{"text": simulated_reasoning}]
                        else:
                            replayed_payload["simulated_reasoning"] = simulated_reasoning

                    elif event_type == "ACTION_TAKEN" and simulated_action is not None:
                        replayed_payload = copy.deepcopy(simulated_action)

                    if override_inputs:
                        replayed_payload["_simulation_note"] = "Inputs modified during what-if simulation"
                        replayed_payload["_overridden_keys"] = list(override_inputs.keys())

                replayed_events.append({
                    "sequence_number": seq,
                    "event_type": event_type,
                    "payload": replayed_payload,
                })
                seq += 1

            # Handle any other custom agent events
            else:
                replayed_payload = copy.deepcopy(orig_payload)
                if mode == "what_if" and override_inputs:
                    replayed_payload["_overridden_keys"] = list(override_inputs.keys())
                replayed_events.append({
                    "sequence_number": seq,
                    "event_type": event_type,
                    "payload": replayed_payload,
                })
                seq += 1

        # Record final decision completion event
        replayed_events.append({
            "sequence_number": seq,
            "event_type": "DECISION_COMPLETED",
            "payload": {"status": "completed", "replay_mode": mode},
        })

        return replayed_events
