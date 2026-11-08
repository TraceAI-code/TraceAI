"""Tests for tool and LangChain interceptors."""

import asyncio
import uuid
import pytest
from fastapi.testclient import TestClient

from app.main import app
from traceai_sdk.client import TraceAIClient
from traceai_sdk.context import DecisionContext
from traceai_sdk.interceptors import TraceAICallbackHandler, instrument_tool


@pytest.fixture
def test_client():
    """Fixture providing a FastAPI TestClient instance."""
    return TestClient(app)


def test_instrument_tool_decorator_sync(test_client):
    """Test the @instrument_tool decorator on a synchronous function."""
    @instrument_tool(name="calculate_mortgage", snapshot=False)
    def calculate_mortgage(principal: float, rate: float, years: int) -> dict:
        return {"monthly_payment": 1850.50, "status": "calculated"}

    with DecisionContext(
        agent_id="mortgage_agent",
        agent_version="1.0.0",
        http_client=test_client,
    ) as ctx:
        res = calculate_mortgage(principal=300000, rate=5.5, years=30)
        assert res["monthly_payment"] == 1850.50

    # Verification: Initial + TOOL_CALL_STARTED + TOOL_CALL_COMPLETED + DECISION_COMPLETED = 4 events
    client = TraceAIClient(http_client=test_client)
    integrity = client.verify_integrity(ctx.decision_id)
    assert integrity.valid is True
    assert integrity.event_count == 4
    client.close()


def test_instrument_tool_large_output_auto_snapshot(test_client):
    """Test automatic evidence store offloading for tool outputs when snapshot=True."""
    @instrument_tool(name="fetch_full_credit_dossier", snapshot=True)
    def fetch_credit_dossier(user_id: str) -> dict:
        return {
            "user_id": user_id,
            "trade_lines": [{"creditor": f"Bank_{i}", "balance": i * 1000} for i in range(50)],
        }

    with DecisionContext(
        agent_id="dossier_agent",
        agent_version="1.0.0",
        http_client=test_client,
    ) as ctx:
        dossier = fetch_credit_dossier(user_id="user_888")
        assert len(dossier["trade_lines"]) == 50

    client = TraceAIClient(http_client=test_client)
    integrity = client.verify_integrity(ctx.decision_id)
    assert integrity.valid is True
    client.close()


def test_instrument_tool_exception_captured(test_client):
    """Test that tool exceptions are captured as TOOL_CALL_FAILED events in the audit chain."""
    @instrument_tool(name="flaky_service")
    def flaky_service():
        raise ConnectionResetError("Remote server disconnected")

    with DecisionContext(
        agent_id="resilient_agent",
        agent_version="1.0.0",
        http_client=test_client,
    ) as ctx:
        with pytest.raises(ConnectionResetError):
            flaky_service()

    # Tool failure recorded as TOOL_CALL_FAILED in the audit chain
    client = TraceAIClient(http_client=test_client)
    integrity = client.verify_integrity(ctx.decision_id)
    assert integrity.valid is True
    client.close()


def test_instrument_tool_async(test_client):
    """Test the @instrument_tool decorator on an asynchronous function."""
    @instrument_tool(name="async_database_lookup")
    async def async_lookup(account_id: str):
        await asyncio.sleep(0.01)
        return {"account_id": account_id, "balance": 9999}

    async def run():
        with DecisionContext(
            agent_id="async_agent",
            agent_version="1.0.0",
            http_client=test_client,
        ) as ctx:
            val = await async_lookup("acc_007")
            assert val["balance"] == 9999
        return ctx.decision_id

    d_id = asyncio.run(run())
    client = TraceAIClient(http_client=test_client)
    integrity = client.verify_integrity(d_id)
    assert integrity.valid is True
    client.close()


def test_langchain_callback_handler(test_client):
    """Test the TraceAICallbackHandler recording LLM and tool calls into DecisionContext."""
    from langchain_core.outputs import LLMResult, Generation

    with DecisionContext(
        agent_id="langchain_agent",
        agent_version="1.0.0",
        http_client=test_client,
    ) as ctx:
        handler = TraceAICallbackHandler(ctx)
        run_id = uuid.uuid4()

        # Simulate language model start and end
        handler.on_llm_start(
            serialized={"name": "ChatOpenAI"},
            prompts=["Analyze this loan request: applicant Sarah Connor"],
            run_id=run_id,
            metadata={"ls_model_name": "gpt-4o"},
        )

        handler.on_llm_end(
            response=LLMResult(
                generations=[[Generation(text="The risk is low. Recommendation: APPROVE")]],
                llm_output={"token_usage": {"prompt_tokens": 15, "completion_tokens": 8, "total_tokens": 23}},
            ),
            run_id=run_id,
        )

        # Simulate tool execution
        tool_run_id = uuid.uuid4()
        handler.on_tool_start(
            serialized={"name": "identity_verifier"},
            input_str="Sarah Connor, DOB: 1985-02-28",
            run_id=tool_run_id,
        )
        handler.on_tool_end(
            output={"identity_verified": True, "kyc_status": "PASS"},
            run_id=tool_run_id,
        )

    # Verification: Initial + LLM_START + LLM_END + TOOL_START + TOOL_END + DECISION_COMPLETED = 6 events
    client = TraceAIClient(http_client=test_client)
    integrity = client.verify_integrity(ctx.decision_id)
    assert integrity.valid is True
    assert integrity.event_count == 6
    client.close()


def test_langchain_tool_events_support_replay(test_client):
    """Tool events must carry the name, arguments, and evidence id replay needs."""
    with DecisionContext(
        agent_id="langchain_replay_agent",
        agent_version="1.0.0",
        http_client=test_client,
    ) as ctx:
        handler = TraceAICallbackHandler(ctx)
        run_id = uuid.uuid4()

        handler.on_tool_start(
            serialized={"name": "credit_bureau_report"},
            input_str='{"bureau": "Equifax", "applicant": "Sarah Connor"}',
            run_id=run_id,
        )
        # Output over 1 KB forces a content-addressable evidence snapshot.
        handler.on_tool_end(
            output={"score": 750, "notes": "x" * 2000},
            run_id=run_id,
        )

    detail = test_client.get(f"/api/v1/decisions/{ctx.decision_id}").json()
    completed = [
        event
        for event in detail["events"]
        if event["event_type"] == "TOOL_CALL_COMPLETED"
    ]
    assert len(completed) == 1

    payload = completed[0]["payload"]
    assert payload["tool_name"] == "credit_bureau_report"
    assert payload["arguments"] == {"bureau": "Equifax", "applicant": "Sarah Connor"}
    assert len(payload["evidence_ids"]) == 1

    evidence = test_client.get(f"/api/v1/evidence/{payload['evidence_ids'][0]}").json()
    assert evidence["type"] == "tool_output_credit_bureau_report"
    assert evidence["metadata_json"]["tool_name"] == "credit_bureau_report"
    assert evidence["metadata_json"]["arguments"] == {
        "bureau": "Equifax",
        "applicant": "Sarah Connor",
    }
