"""Comparison and diff engine for replayed decisions."""

import difflib
import json
from typing import Any

from app.schemas.replay import ActionDiff, DiffSummary, ToolCallDiff


class ExecutionComparator:
    """Compares original decision events with replayed events.

    Checks actions, tool calls, model reasoning text, policies, and event counts
    to produce a clear similarity score and difference summary.
    """

    def compare(
        self,
        original_events: list[dict[str, Any]],
        replayed_events: list[dict[str, Any]],
    ) -> DiffSummary:
        """Compare original events with replayed events and calculate similarity."""
        action_diff = self._compare_actions(original_events, replayed_events)
        tools_match, tool_details = self._compare_tools(original_events, replayed_events)
        reasoning_ratio, reasoning_diff = self._compare_reasoning(original_events, replayed_events)
        policy_diff = self._compare_policies(original_events, replayed_events)
        metrics_diff = self._compare_metrics(original_events, replayed_events)

        # Calculate overall similarity score based on weights:
        # Action: 50%, Tools: 25%, Reasoning: 15%, Policy: 10%
        action_score = 1.0 if action_diff.match else 0.0
        tools_score = 1.0 if tools_match else 0.0
        policy_score = 1.0 if policy_diff.get("match", True) else 0.0

        overall_similarity = round(
            (action_score * 0.50) + (tools_score * 0.25) + (reasoning_ratio * 0.15) + (policy_score * 0.10),
            4,
        )

        is_match = (
            action_diff.match
            and tools_match
            and reasoning_ratio >= 0.95
            and policy_diff.get("match", True)
        )

        status = "matched" if is_match else "diverged"

        if is_match:
            summary = "Replay execution is an exact deterministic match with zero divergence."
        else:
            deviations = []
            if not action_diff.match:
                deviations.append(f"Action diverged (Original: {action_diff.original} vs Replay: {action_diff.replayed})")
            if not tools_match:
                deviations.append("Tool invocation sequence or arguments diverged")
            if reasoning_ratio < 0.95:
                deviations.append(f"Reasoning text similarity is {round(reasoning_ratio * 100, 1)}%")
            if not policy_diff.get("match", True):
                deviations.append("Governance policy outcome differed between runs")
            summary = "Divergence detected: " + "; ".join(deviations)

        return DiffSummary(
            is_match=is_match,
            status=status,
            overall_similarity=overall_similarity,
            action_diff=action_diff,
            tools_match=tools_match,
            tools_executed_count=len(tool_details),
            tool_details=tool_details,
            reasoning_similarity_ratio=round(reasoning_ratio, 4),
            reasoning_diff=reasoning_diff,
            policy_diff=policy_diff,
            metrics_diff=metrics_diff,
            summary=summary,
        )

    def _compare_actions(
        self,
        orig_events: list[dict],
        replay_events: list[dict],
    ) -> ActionDiff:
        """Compare the final actions taken in both runs."""
        orig_act = self._find_first_event(orig_events, ["ACTION_TAKEN"])
        replay_act = self._find_first_event(replay_events, ["ACTION_TAKEN"])

        if not orig_act and not replay_act:
            orig_comp = self._find_first_event(orig_events, ["DECISION_COMPLETED"])
            replay_comp = self._find_first_event(replay_events, ["DECISION_COMPLETED"])
            return ActionDiff(
                original=orig_comp.get("payload") if orig_comp else None,
                replayed=replay_comp.get("payload") if replay_comp else None,
                match=True,
            )

        orig_val = orig_act.get("payload") if orig_act else None
        replay_val = replay_act.get("payload") if replay_act else None

        match = self._normalize_json(orig_val) == self._normalize_json(replay_val)
        return ActionDiff(original=orig_val, replayed=replay_val, match=match)

    def _compare_tools(
        self,
        orig_events: list[dict],
        replay_events: list[dict],
    ) -> tuple[bool, list[ToolCallDiff]]:
        """Compare tool calls, input arguments, and results across both runs."""
        completed_types = ("TOOL_CALL_COMPLETED", "TOOL_CALL_FAILED")
        orig_tools = [e for e in orig_events if e.get("event_type") in completed_types]
        replay_tools = [e for e in replay_events if e.get("event_type") in completed_types]

        details: list[ToolCallDiff] = []
        all_matched = True

        max_len = max(len(orig_tools), len(replay_tools))
        for i in range(max_len):
            ot = orig_tools[i] if i < len(orig_tools) else {}
            rt = replay_tools[i] if i < len(replay_tools) else {}

            ot_payload = ot.get("payload", {})
            rt_payload = rt.get("payload", {})

            tool_name = ot_payload.get("tool_name") or rt_payload.get("tool_name") or f"tool_{i}"
            ot_args = ot_payload.get("arguments", {})
            rt_args = rt_payload.get("arguments", {})

            orig_res = ot_payload.get("result")
            replay_res = rt_payload.get("result")

            args_match = self._normalize_json(ot_args) == self._normalize_json(rt_args)

            if isinstance(orig_res, str) and "[Evidence stored" in orig_res:
                res_match = replay_res is not None
            else:
                res_match = self._normalize_json(orig_res) == self._normalize_json(replay_res)

            item_match = args_match and res_match
            if not item_match:
                all_matched = False

            details.append(
                ToolCallDiff(
                    tool_name=tool_name,
                    original_args=ot_args,
                    replayed_args=rt_args,
                    args_match=args_match,
                    result_match=res_match,
                )
            )

        return all_matched, details

    def _compare_reasoning(
        self,
        orig_events: list[dict],
        replay_events: list[dict],
    ) -> tuple[float, list[str]]:
        """Compare model reasoning text between runs and calculate similarity percentage."""
        orig_inference = self._find_first_event(orig_events, ["MODEL_INFERENCE", "LLM_INVOCATION_COMPLETED"])
        replay_inference = self._find_first_event(replay_events, ["MODEL_INFERENCE", "LLM_INVOCATION_COMPLETED"])

        orig_text = self._extract_reasoning_text(orig_inference)
        replay_text = self._extract_reasoning_text(replay_inference)

        if not orig_text and not replay_text:
            return 1.0, []

        matcher = difflib.SequenceMatcher(None, orig_text, replay_text)
        ratio = matcher.ratio()

        # Build line-by-line differences
        orig_lines = orig_text.splitlines()
        replay_lines = replay_text.splitlines()
        diff = list(difflib.unified_diff(orig_lines, replay_lines, fromfile="original", tofile="replay", lineterm=""))

        return ratio, diff

    def _compare_policies(
        self,
        orig_events: list[dict],
        replay_events: list[dict],
    ) -> dict[str, Any]:
        """Compare policy evaluation outcomes between runs."""
        orig_pol = self._find_first_event(orig_events, ["POLICY_EVALUATION"])
        replay_pol = self._find_first_event(replay_events, ["POLICY_EVALUATION"])

        if not orig_pol and not replay_pol:
            return {"match": True, "notes": "No policies evaluated in either run"}

        orig_status = (orig_pol or {}).get("payload", {}).get("status", "none")
        replay_status = (replay_pol or {}).get("payload", {}).get("status", "none")

        match = orig_status == replay_status
        return {
            "match": match,
            "original_status": orig_status,
            "replay_status": replay_status,
            "original_violations": (orig_pol or {}).get("payload", {}).get("violations_count", 0),
            "replay_violations": (replay_pol or {}).get("payload", {}).get("violations_count", 0),
        }

    def _compare_metrics(
        self,
        orig_events: list[dict],
        replay_events: list[dict],
    ) -> dict[str, Any]:
        """Calculate event count differences between runs."""
        return {
            "original_event_count": len(orig_events),
            "replayed_event_count": len(replay_events),
            "event_count_delta": len(replay_events) - len(orig_events),
        }

    def _find_first_event(self, events: list[dict], types: list[str]) -> dict | None:
        """Find the first event in a list matching any of the specified types."""
        for e in events:
            if e.get("event_type") in types:
                return e
        return None

    def _extract_reasoning_text(self, event: dict | None) -> str:
        """Extract reasoning, rationale, or model response text from an event payload."""
        if not event:
            return ""
        payload = event.get("payload", {})
        if "rationale" in payload:
            return str(payload["rationale"])
        if "decision" in payload:
            return str(payload.get("decision", ""))
        if "output" in payload:
            return str(payload.get("output", ""))
        if "generations" in payload:
            gens = payload["generations"]
            if isinstance(gens, list):
                extracted = []
                for g in gens:
                    if isinstance(g, dict) and "text" in g:
                        extracted.append(str(g["text"]))
                    elif isinstance(g, list):
                        extracted.extend(str(item.get("text", item)) if isinstance(item, dict) else str(item) for item in g)
                    else:
                        extracted.append(str(g))
                return "\n".join(extracted)
        return json.dumps(payload, sort_keys=True)

    def _normalize_json(self, data: Any) -> str:
        """Format an object as a sorted JSON string for exact comparison."""
        try:
            return json.dumps(data, sort_keys=True, default=str)
        except Exception:
            return str(data)
