"""Tests for the governance policy engine and audit logging."""

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_policy_engine_evaluation_and_audit_event():
    """Test policy evaluation rules for PII, limits, and blocked tools."""
    # 1. Register a governance policy with PII, Threshold, and Blocked Tools rules
    policy_res = client.post(
        "/api/v1/policies",
        json={
            "name": "enterprise_lending_governance",
            "version": "1.0.0",
            "description": "Enterprise lending risk and compliance policy",
            "rules": {
                "rules": [
                    {
                        "id": "rule_no_pii_leak",
                        "type": "pii_filter",
                        "patterns": ["ssn", "credit_card"],
                    },
                    {
                        "id": "rule_max_loan_limit",
                        "type": "threshold",
                        "field": "requested_amount",
                        "operator": "<=",
                        "value": 100000,
                    },
                    {
                        "id": "rule_prohibited_tools",
                        "type": "blocked_tools",
                        "tools": ["execute_shell", "delete_database", "bypass_kyc"],
                    },
                ]
            },
        },
    )
    assert policy_res.status_code == 201
    policy_id = policy_res.json()["id"]

    # 2. Test compliant decision that satisfies all rules
    clean_dec = client.post(
        "/api/v1/decisions",
        json={
            "agent_id": "underwriter_agent",
            "agent_version": "1.0.0",
            "input_data": {"applicant": "Jane Doe", "requested_amount": 50000},
        },
    ).json()

    eval_res = client.post(
        f"/api/v1/policies/evaluate/{clean_dec['id']}?policy_id={policy_id}",
        json={"notes": "All checks passed cleanly"},
    )
    assert eval_res.status_code == 200
    report = eval_res.json()
    assert report["passed"] is True
    assert len(report["violations"]) == 0

    # Verify per-policy and per-decision evaluation history endpoints
    policy_evals = client.get(f"/api/v1/policies/{policy_id}/evaluations").json()
    assert any(
        e["decision_id"] == clean_dec["id"]
        and e["policy_id"] == policy_id
        and e["result"] == "PASSED"
        for e in policy_evals
    )
    decision_evals = client.get(
        f"/api/v1/decisions/{clean_dec['id']}/evaluations"
    ).json()
    assert decision_evals[0]["policy_id"] == policy_id
    assert decision_evals[0]["policy_version"] == "1.0.0"

    # Verify audit chain integrity with the POLICY_EVALUATION event
    integrity = client.get(f"/api/v1/decisions/{clean_dec['id']}/integrity").json()
    assert integrity["valid"] is True
    assert integrity["event_count"] == 2  # DECISION_CREATED + POLICY_EVALUATION

    # 3. Test sensitive personal information violation (SSN in payload)
    pii_dec = client.post(
        "/api/v1/decisions",
        json={
            "agent_id": "underwriter_agent",
            "agent_version": "1.0.0",
            "input_data": {"applicant": "John Leak", "requested_amount": 30000},
        },
    ).json()

    eval_res = client.post(
        f"/api/v1/policies/evaluate/{pii_dec['id']}?policy_id={policy_id}",
        json={"notes": "Customer SSN is 000-12-3456 in raw text"},
    )
    assert eval_res.status_code == 200
    report = eval_res.json()
    assert report["passed"] is False
    assert any(v["type"] == "pii_violation" for v in report["violations"])

    # Decision status should be flagged
    dec_detail = client.get(f"/api/v1/decisions/{pii_dec['id']}").json()
    assert dec_detail["status"] == "policy_violated"

    # 4. Test threshold violation (requested amount exceeds limit)
    thresh_dec = client.post(
        "/api/v1/decisions",
        json={
            "agent_id": "underwriter_agent",
            "agent_version": "1.0.0",
            "input_data": {"applicant": "Rich Buyer", "requested_amount": 150000},
        },
    ).json()

    eval_res = client.post(
        f"/api/v1/policies/evaluate/{thresh_dec['id']}?policy_id={policy_id}",
    )
    assert eval_res.status_code == 200
    report = eval_res.json()
    assert report["passed"] is False
    assert any(v["type"] == "threshold_violation" for v in report["violations"])

    # 5. Test blocked tool violation
    blocked_tool_dec = client.post(
        "/api/v1/decisions",
        json={
            "agent_id": "underwriter_agent",
            "agent_version": "1.0.0",
            "input_data": {"applicant": "Sneaky Agent", "requested_amount": 20000},
        },
    ).json()

    eval_res = client.post(
        f"/api/v1/policies/evaluate/{blocked_tool_dec['id']}?policy_id={policy_id}",
        json={"tool_name": "bypass_kyc", "arguments": {}},
    )
    assert eval_res.status_code == 200
    report = eval_res.json()
    assert report["passed"] is False
    assert any(v["type"] == "unauthorized_tool_call" for v in report["violations"])

    # All decisions must retain 100% cryptographic integrity
    for d_id in [clean_dec["id"], pii_dec["id"], thresh_dec["id"], blocked_tool_dec["id"]]:
        integ = client.get(f"/api/v1/decisions/{d_id}/integrity").json()
        assert integ["valid"] is True
