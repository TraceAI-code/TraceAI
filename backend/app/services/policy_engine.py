"""Policy evaluation engine for compliance and safety rules.

Evaluates decision inputs and tool arguments against active policies,
checks for personal data (PII), numeric limits, and blocked tools,
and logs evaluation results directly into the decision's audit chain.
"""

import re
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db.models import Decision, Policy
from app.services.event_recorder import EventRecorder


# Regular expressions for detecting sensitive personal information
PII_PATTERNS = {
    "ssn": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "credit_card": re.compile(r"\b(?:\d{4}[ -]?){3}\d{4}\b"),
    "email": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"),
}


class PolicyEngine:
    """Evaluates agent decisions and payloads against defined rules."""

    def __init__(self, db: Session):
        self.db = db

    def evaluate_decision(
        self,
        decision_id: UUID,
        target_payload: dict[str, Any] | None = None,
        policy_id: UUID | None = None,
        record_audit_event: bool = True,
    ) -> dict[str, Any]:
        """Evaluate a decision against all active policies or a single policy.

        Checks decision input and extra payloads against rules, and optionally records
        a POLICY_EVALUATION event in the decision's audit chain.

        When no policies are active the result is explicitly ``not_evaluated``
        rather than ``passed``: an empty policy set is a governance gap, not a
        compliance signal.
        """
        decision = self.db.get(Decision, decision_id)
        if not decision:
            return {"valid": False, "error": "Decision not found"}

        # Combine decision input with the target payload to evaluate
        data_to_check = dict(decision.input_data or {})
        if target_payload:
            data_to_check.update(target_payload)

        # Tool names recorded in the decision chain, so blocked_tools rules can
        # inspect actual tool usage rather than only the decision input.
        tool_names = self._collect_tool_names(decision)

        # Retrieve relevant policies
        policies = self._get_policies(policy_id)

        all_violations: list[dict[str, Any]] = []
        evaluated_names: list[str] = []
        evaluated_details: list[dict[str, str]] = []

        # Evaluate rules for each policy
        for p in policies:
            evaluated_names.append(f"{p.name} (v{p.version})")
            evaluated_details.append({
                "id": str(p.id),
                "name": p.name,
                "version": p.version,
            })
            violations = self._evaluate_rules(p.rules, data_to_check, tool_names)
            for v in violations:
                v["policy_id"] = str(p.id)
                v["policy_name"] = p.name
                v["policy_version"] = p.version
                all_violations.append(v)

        if not policies:
            status = "not_evaluated"
            passed: bool | None = None
        else:
            passed = len(all_violations) == 0
            status = "passed" if passed else "violated"

        # Record the evaluation result in the decision's audit chain if requested.
        # This happens even for zero-policy evaluations so the gap is auditable.
        event_record = None
        if record_audit_event:
            recorder = EventRecorder(self.db)
            event_record = recorder.record(
                decision,
                event_type="POLICY_EVALUATION",
                payload={
                    "status": status,
                    "policies_evaluated": evaluated_names,
                    "policy_details": evaluated_details,
                    "violations_count": len(all_violations),
                    "violations": all_violations,
                },
            )

            # If policies were violated, mark the decision status
            if all_violations:
                decision.status = "policy_violated"

            self.db.commit()
            self.db.refresh(decision)

        return {
            "decision_id": str(decision_id),
            "passed": passed,
            "status": status,
            "evaluated_policies": evaluated_names,
            "evaluated_policy_count": len(evaluated_names),
            "violations": all_violations,
            "event_id": str(event_record.id) if event_record else None,
        }

    def _get_policies(self, policy_id: UUID | None) -> list[Policy]:
        """Return the policies to evaluate.

        An explicit ``policy_id`` is always evaluated (useful for re-running a
        historical policy). Otherwise only currently effective policies apply.
        """
        if policy_id:
            policy = self.db.get(Policy, policy_id)
            return [policy] if policy else []

        now = datetime.now(timezone.utc)
        return (
            self.db.query(Policy)
            .filter(
                Policy.effective_from <= now,
                or_(Policy.effective_to.is_(None), Policy.effective_to >= now),
            )
            .all()
        )

    def _collect_tool_names(self, decision: Decision) -> list[str]:
        """Collect distinct tool names invoked in the decision's audit chain."""
        names: list[str] = []
        for event in decision.events:
            if event.event_type not in (
                "TOOL_CALL_STARTED",
                "TOOL_CALL_COMPLETED",
                "TOOL_CALL_FAILED",
            ):
                continue
            payload = event.payload or {}
            name = payload.get("tool_name") or payload.get("tool")
            if isinstance(name, str) and name and name not in names:
                names.append(name)
        return names

    def _evaluate_rules(
        self,
        rules_spec: dict[str, Any],
        data: dict[str, Any],
        tool_names: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Evaluate a set of rules against the provided data dictionary."""
        violations = []
        rules = rules_spec.get("rules", [])
        if isinstance(rules_spec, list):
            rules = rules_spec

        for rule in rules:
            rule_type = rule.get("type")
            rule_id = rule.get("id", rule_type)

            if rule_type == "pii_filter":
                v = self._check_pii(rule, data)
                if v:
                    violations.extend(v)
            elif rule_type == "threshold":
                v = self._check_threshold(rule, data)
                if v:
                    violations.append(v)
            elif rule_type == "blocked_tools":
                v = self._check_blocked_tools(rule, data, tool_names or [])
                if v:
                    violations.extend(v)

        return violations

    def _check_pii(self, rule: dict, data: dict) -> list[dict]:
        """Scan text fields for sensitive personal data like SSNs or credit card numbers."""
        violations = []
        patterns_to_check = rule.get("patterns", ["ssn", "credit_card"])

        text_representations = self._flatten_strings(data)
        for pattern_name in patterns_to_check:
            regex = PII_PATTERNS.get(pattern_name)
            if not regex:
                continue

            for field_name, text in text_representations:
                if regex.search(str(text)):
                    violations.append({
                        "rule_id": rule.get("id", "pii_filter"),
                        "type": "pii_violation",
                        "field": field_name,
                        "pattern": pattern_name,
                        "message": f"Detected sensitive {pattern_name.upper()} in field '{field_name}'",
                    })
        return violations

    def _check_threshold(self, rule: dict, data: dict) -> dict | None:
        """Verify that a numeric field satisfies a threshold condition (e.g. <= value)."""
        field = rule.get("field")
        op = rule.get("operator", "<=")
        limit = rule.get("value")

        if field not in data:
            return None

        val = data[field]
        try:
            val_num = float(val)
            limit_num = float(limit)
        except (ValueError, TypeError):
            return None

        violation = False
        if op == "<=" and val_num > limit_num:
            violation = True
        elif op == "<" and val_num >= limit_num:
            violation = True
        elif op == ">=" and val_num < limit_num:
            violation = True
        elif op == ">" and val_num <= limit_num:
            violation = True
        elif op == "==" and val_num != limit_num:
            violation = True

        if violation:
            return {
                "rule_id": rule.get("id", "threshold_check"),
                "type": "threshold_violation",
                "field": field,
                "actual_value": val_num,
                "expected": f"{op} {limit_num}",
                "message": f"Field '{field}' with value {val_num} violated threshold constraint ({op} {limit_num})",
            }
        return None

    def _check_blocked_tools(
        self,
        rule: dict,
        data: dict,
        tool_names: list[str],
    ) -> list[dict]:
        """Check whether the agent called a tool that is prohibited by policy."""
        blocked = set(rule.get("tools", []))
        if not blocked:
            return []

        candidates = list(tool_names)
        for key in ("tool_name", "tool"):
            value = data.get(key)
            if isinstance(value, str) and value:
                candidates.append(value)

        violations: list[dict] = []
        seen: set[str] = set()
        for tool_name in candidates:
            if tool_name in blocked and tool_name not in seen:
                seen.add(tool_name)
                violations.append({
                    "rule_id": rule.get("id", "blocked_tools"),
                    "type": "unauthorized_tool_call",
                    "tool_name": tool_name,
                    "message": f"Execution of prohibited tool '{tool_name}' was blocked by governance policy",
                })
        return violations

    def _flatten_strings(self, obj: Any, prefix: str = "") -> list[tuple[str, str]]:
        """Extract all string values and their key paths from nested structures."""
        items = []
        if isinstance(obj, dict):
            for k, v in obj.items():
                p = f"{prefix}.{k}" if prefix else k
                items.extend(self._flatten_strings(v, p))
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                items.extend(self._flatten_strings(v, f"{prefix}[{i}]"))
        elif isinstance(obj, str):
            items.append((prefix, obj))
        return items
