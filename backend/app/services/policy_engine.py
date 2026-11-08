"""Policy evaluation engine for compliance and safety rules.

Evaluates decision inputs and tool arguments against active policies,
checks for personal data (PII), numeric limits, and blocked tools,
and logs evaluation results directly into the decision's audit chain.
"""

import re
from typing import Any
from uuid import UUID
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
        """
        decision = self.db.get(Decision, decision_id)
        if not decision:
            return {"valid": False, "error": "Decision not found"}

        # Combine decision input with the target payload to evaluate
        data_to_check = dict(decision.input_data)
        if target_payload:
            data_to_check.update(target_payload)

        # Retrieve relevant policies
        if policy_id:
            policy = self.db.get(Policy, policy_id)
            policies = [policy] if policy else []
        else:
            # Query all registered policies
            policies = self.db.query(Policy).all()

        if not policies:
            return {
                "decision_id": str(decision_id),
                "passed": True,
                "evaluated_policies": 0,
                "violations": [],
            }

        all_violations = []
        evaluated_names = []
        evaluated_details = []

        # Evaluate rules for each policy
        for p in policies:
            evaluated_names.append(f"{p.name} (v{p.version})")
            evaluated_details.append({
                "id": str(p.id),
                "name": p.name,
                "version": p.version,
            })
            violations = self._evaluate_rules(p.rules, data_to_check)
            for v in violations:
                v["policy_id"] = str(p.id)
                v["policy_name"] = p.name
                v["policy_version"] = p.version
                all_violations.append(v)

        passed = len(all_violations) == 0

        # Record the evaluation result in the decision's audit chain if requested
        event_record = None
        if record_audit_event:
            recorder = EventRecorder(self.db)
            event_record = recorder.record(
                decision,
                event_type="POLICY_EVALUATION",
                payload={
                    "status": "passed" if passed else "violated",
                    "policies_evaluated": evaluated_names,
                    "policy_details": evaluated_details,
                    "violations_count": len(all_violations),
                    "violations": all_violations,
                },
            )

            # If policies were violated, mark the decision status
            if not passed:
                decision.status = "policy_violated"

            self.db.commit()
            self.db.refresh(decision)

        return {
            "decision_id": str(decision_id),
            "passed": passed,
            "evaluated_policies": evaluated_names,
            "violations": all_violations,
            "event_id": str(event_record.id) if event_record else None,
        }

    def _evaluate_rules(self, rules_spec: dict[str, Any], data: dict[str, Any]) -> list[dict[str, Any]]:
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
                v = self._check_blocked_tools(rule, data)
                if v:
                    violations.append(v)

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

    def _check_blocked_tools(self, rule: dict, data: dict) -> dict | None:
        """Check whether the agent called a tool that is prohibited by policy."""
        blocked = rule.get("tools", [])
        tool_name = data.get("tool_name") or data.get("tool")

        if tool_name and tool_name in blocked:
            return {
                "rule_id": rule.get("id", "blocked_tools"),
                "type": "unauthorized_tool_call",
                "tool_name": tool_name,
                "message": f"Execution of prohibited tool '{tool_name}' was blocked by governance policy",
            }
        return None

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
