"""Tests for decision replay, diff engine, and audit report generation."""

from fastapi.testclient import TestClient
from app.main import app
from traceai_sdk.client import TraceAIClient

client = TestClient(app)


def test_deterministic_replay_and_diff():
    """Test deterministic replay matching and what-if simulation divergence."""
    # 1. Setup a complete decision trace
    dec_res = client.post(
        "/api/v1/decisions",
        json={
            "agent_id": "mortgage_underwriter",
            "agent_version": "1.0.0",
            "input_data": {"applicant": "Alice Smith", "requested_amount": 40000, "annual_income": 95000},
        },
    )
    assert dec_res.status_code == 201
    decision_id = dec_res.json()["id"]

    # 2. Record tool call and snapshot evidence
    ev_res = client.post(
        "/api/v1/evidence",
        json={
            "type": "credit_bureau_report",
            "content": {"bureau": "Equifax", "score": 750, "monthly_debt": 1200},
            "metadata": {"source": "api.equifax.internal"},
        },
    )
    assert ev_res.status_code == 201
    ev_id = ev_res.json()["id"]

    # Link evidence
    client.post(f"/api/v1/decisions/{decision_id}/evidence/{ev_id}?role=credit_record")

    # Record tool event
    client.post(
        f"/api/v1/decisions/{decision_id}/events",
        json={
            "event_type": "TOOL_CALL_COMPLETED",
            "payload": {
                "tool_name": "credit_bureau_report",
                "arguments": {"bureau": "Equifax"},
                "result": {"score": 750, "monthly_debt": 1200},
            },
            "evidence_ids": [ev_id],
        },
    )

    # Record reasoning and action
    client.post(
        f"/api/v1/decisions/{decision_id}/events",
        json={
            "event_type": "MODEL_INFERENCE",
            "payload": {
                "model": "claude-3-5-sonnet",
                "rationale": "Credit score 750 is strong and debt is low.",
                "confidence_score": 0.96,
            },
        },
    )

    client.post(
        f"/api/v1/decisions/{decision_id}/events",
        json={
            "event_type": "ACTION_TAKEN",
            "payload": {
                "action": "APPROVE_LOAN",
                "approved_amount": 40000,
                "rate": 5.99,
            },
        },
    )

    # 3. Trigger deterministic replay
    replay_res = client.post(
        f"/api/v1/decisions/{decision_id}/replay",
        json={"mode": "deterministic", "mock_tools": True},
    )
    assert replay_res.status_code == 200
    replay_data = replay_res.json()

    assert replay_data["status"] == "matched"
    assert replay_data["similarity_score"] == 1.0
    assert replay_data["diff_summary"]["is_match"] is True
    assert replay_data["diff_summary"]["action_diff"]["match"] is True

    # 4. Trigger what-if simulation with divergent loan amount
    what_if_res = client.post(
        f"/api/v1/decisions/{decision_id}/replay",
        json={
            "mode": "what_if",
            "override_inputs": {"requested_amount": 150000},
            "simulated_action": {
                "action": "REJECT_LOAN",
                "reason": "Requested amount exceeds permissible lending threshold.",
            },
            "mock_tools": True,
        },
    )
    assert what_if_res.status_code == 200
    what_if_data = what_if_res.json()

    assert what_if_data["status"] == "diverged"
    assert what_if_data["similarity_score"] < 1.0
    assert what_if_data["diff_summary"]["is_match"] is False
    assert what_if_data["diff_summary"]["action_diff"]["match"] is False
    assert what_if_data["diff_summary"]["action_diff"]["original"]["action"] == "APPROVE_LOAN"
    assert what_if_data["diff_summary"]["action_diff"]["replayed"]["action"] == "REJECT_LOAN"

    # 5. List replays
    list_res = client.get(f"/api/v1/decisions/{decision_id}/replays")
    assert list_res.status_code == 200
    replays = list_res.json()
    assert len(replays) >= 2
    # The list must carry diff data: the UI renders replay history from it.
    assert all("diff_summary" in replay for replay in replays)
    assert any(replay["diff_summary"]["is_match"] is False for replay in replays)


def test_audit_report_generation():
    """Test generating JSON and Markdown compliance audit reports."""
    # Setup decision
    dec_res = client.post(
        "/api/v1/decisions",
        json={
            "agent_id": "audit_test_agent",
            "agent_version": "1.0.0",
            "input_data": {"test_field": "sample_value"},
        },
    )
    decision_id = dec_res.json()["id"]

    # Submit a human review
    client.post(
        f"/api/v1/decisions/{decision_id}/reviews",
        json={
            "reviewer_id": "auditor_smith",
            "action": "approved",
            "comments": "Audited and verified compliant.",
        },
    )

    # Run a deterministic replay so the report includes replay verification
    client.post(
        f"/api/v1/decisions/{decision_id}/replay",
        json={"mode": "deterministic"},
    )

    # Test JSON audit report
    json_report_res = client.get(f"/api/v1/decisions/{decision_id}/audit-report?format=json")
    assert json_report_res.status_code == 200
    report_json = json_report_res.json()
    assert "report_metadata" in report_json
    assert "cryptographic_verification" in report_json
    assert report_json["cryptographic_verification"]["valid"] is True
    assert len(report_json["human_reviews"]) == 1
    assert len(report_json["replay_verification"]) == 1

    # Test Markdown audit report
    md_report_res = client.get(f"/api/v1/decisions/{decision_id}/audit-report?format=markdown")
    assert md_report_res.status_code == 200
    assert md_report_res.headers["content-type"].startswith("text/markdown")
    md_content = md_report_res.text
    assert "# TraceAI Compliance & Audit Report" in md_content
    assert "Cryptographic Integrity Proof" in md_content
    assert "VALID (Tamper-Free)" in md_content
    assert "Human Review & Compliance Sign-Offs" in md_content
    assert "auditor_smith" in md_content


def test_sdk_replay_client_methods():
    """Test triggering replays and fetching audit reports via the SDK client."""
    sdk_client = TraceAIClient(http_client=client)

    # Create decision
    session = sdk_client.create_decision(
        agent_id="sdk_replay_agent",
        agent_version="1.0.0",
        input_data={"amount": 25000},
    )

    # Trigger replay via SDK
    replay_run = sdk_client.trigger_replay(session.id, mode="deterministic")
    assert replay_run["status"] == "matched"
    assert replay_run["similarity_score"] == 1.0

    # Fetch audit report via SDK (JSON)
    json_rep = sdk_client.get_audit_report(session.id, format="json")
    assert isinstance(json_rep, dict)
    assert json_rep["decision"]["id"] == str(session.id)

    # Fetch audit report via SDK (Markdown)
    md_rep = sdk_client.get_audit_report(session.id, format="markdown")
    assert isinstance(md_rep, str)
    assert "# TraceAI Compliance & Audit Report" in md_rep

    sdk_client.close()
