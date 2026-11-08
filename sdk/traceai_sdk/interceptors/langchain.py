"""LangChain and LangGraph callback handler for TraceAI auditing."""

import json
from typing import Any, Dict, List, Optional
from uuid import UUID

try:
    from langchain_core.callbacks import BaseCallbackHandler
    from langchain_core.outputs import LLMResult
except ImportError:
    class BaseCallbackHandler:  # type: ignore
        """Fallback callback handler base if langchain_core is not installed."""
        pass
    LLMResult = Any  # type: ignore

from traceai_sdk.context import DecisionContext


class TraceAICallbackHandler(BaseCallbackHandler):
    """LangChain callback handler that records agent events into a DecisionContext.

    Example:
        handler = TraceAICallbackHandler(ctx)
        agent_executor.invoke({"input": "..."}, config={"callbacks": [handler]})
    """

    def __init__(self, ctx: DecisionContext, capture_prompts: bool = True):
        super().__init__()
        self.ctx = ctx
        self.capture_prompts = capture_prompts
        # Track in-flight tool runs so on_tool_end can attach the tool name and
        # arguments to the completion event and its evidence snapshot.
        self._tool_runs: Dict[str, Dict[str, Any]] = {}

    def on_llm_start(
        self,
        serialized: Dict[str, Any],
        prompts: List[str],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        tags: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """Record the start of a language model call."""
        model_name = (
            (metadata or {}).get("ls_model_name")
            or (serialized or {}).get("name")
            or (serialized or {}).get("id", ["LLM"])[-1]
        )
        payload = {
            "model": str(model_name),
            "run_id": str(run_id),
            "parent_run_id": str(parent_run_id) if parent_run_id else None,
        }
        if self.capture_prompts:
            payload["prompts"] = prompts

        self.ctx.record_event("LLM_INVOCATION_STARTED", payload=payload)

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Record the completion of a language model call."""
        generations = []
        try:
            for gen_list in response.generations:
                for gen in gen_list:
                    generations.append(gen.text)
        except Exception:
            generations = [str(response)]

        llm_output = getattr(response, "llm_output", {}) or {}
        token_usage = llm_output.get("token_usage", {})

        self.ctx.record_event(
            "LLM_INVOCATION_COMPLETED",
            payload={
                "run_id": str(run_id),
                "generations": generations,
                "token_usage": token_usage,
            },
        )

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Record a failure during a language model call."""
        self.ctx.record_event(
            "LLM_INVOCATION_FAILED",
            payload={
                "run_id": str(run_id),
                "error_type": type(error).__name__,
                "error_message": str(error),
            },
        )

    def on_tool_start(
        self,
        serialized: Dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        inputs: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> None:
        """Record the start of a tool invocation.

        The tool name and parsed arguments are cached against the run id so the
        completion event can carry the same identity. Without this, a replay
        cannot tell which tool produced a given result or match outputs to the
        exact arguments that were used.
        """
        tool_name = (serialized or {}).get("name") or "tool"
        arguments = self._parse_tool_arguments(input_str, inputs)

        self._tool_runs[str(run_id)] = {
            "tool_name": tool_name,
            "arguments": arguments,
            "input": input_str,
        }

        self.ctx.record_event(
            "TOOL_CALL_STARTED",
            payload={
                "tool_name": tool_name,
                "arguments": arguments,
                "input": input_str,
                "run_id": str(run_id),
            },
        )

    def on_tool_end(
        self,
        output: Any,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Record the completion of a tool invocation.

        Large outputs (over 1 KB) are saved to the evidence store with the tool
        name and arguments in their metadata so deterministic replay can inject
        the recorded result instead of re-executing the tool.
        """
        run = self._tool_runs.pop(str(run_id), {})
        tool_name = run.get("tool_name") or "tool"
        arguments = run.get("arguments") or {}

        output_str = str(output)
        evidence_ids = []

        # If output is large (greater than 1 KB), save it in the evidence store
        if len(output_str.encode("utf-8")) > 1024:
            ev = self.ctx.record_evidence(
                evidence_type=f"tool_output_{tool_name}",
                content=output if isinstance(output, (dict, list, str)) else output_str,
                metadata={
                    "tool_name": tool_name,
                    "arguments": arguments,
                    "run_id": str(run_id),
                },
                role="tool_result",
            )
            evidence_ids.append(ev.id)
            result_payload = f"[Evidence stored in content-addressable store: {ev.content_hash[:16]}...]"
        else:
            result_payload = output if isinstance(output, (dict, list, str, int, float, bool)) else output_str

        self.ctx.record_event(
            "TOOL_CALL_COMPLETED",
            payload={
                "tool_name": tool_name,
                "arguments": arguments,
                "result": result_payload,
                "output": result_payload,
                "evidence_ids": [str(evidence_id) for evidence_id in evidence_ids],
                "run_id": str(run_id),
            },
            evidence_ids=evidence_ids,
        )

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Record a failure during a tool call."""
        run = self._tool_runs.pop(str(run_id), {})
        self.ctx.record_event(
            "TOOL_CALL_FAILED",
            payload={
                "tool_name": run.get("tool_name") or "tool",
                "arguments": run.get("arguments") or {},
                "run_id": str(run_id),
                "error_type": type(error).__name__,
                "error_message": str(error),
            },
        )

    @staticmethod
    def _parse_tool_arguments(
        input_str: str,
        inputs: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Coerce tool arguments into a JSON object for matching during replay."""
        if isinstance(inputs, dict) and inputs:
            return inputs
        if isinstance(input_str, dict):
            return input_str
        try:
            parsed = json.loads(input_str)
            if isinstance(parsed, dict):
                return parsed
            return {"input": parsed}
        except (TypeError, ValueError):
            return {"input": input_str}

    def on_chain_start(
        self,
        serialized: Dict[str, Any],
        inputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Record the start of a chain execution."""
        chain_name = (serialized or {}).get("name") or (serialized or {}).get("id", ["Chain"])[-1]
        self.ctx.record_event(
            "CHAIN_EXECUTION_STARTED",
            payload={
                "chain_name": str(chain_name),
                "run_id": str(run_id),
            },
        )

    def on_chain_end(
        self,
        outputs: Dict[str, Any],
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Record the successful completion of a chain."""
        self.ctx.record_event(
            "CHAIN_EXECUTION_COMPLETED",
            payload={
                "outputs": outputs,
                "run_id": str(run_id),
            },
        )

    def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: Optional[UUID] = None,
        **kwargs: Any,
    ) -> None:
        """Record a failure during chain execution."""
        self.ctx.record_event(
            "CHAIN_EXECUTION_FAILED",
            payload={
                "run_id": str(run_id),
                "error_type": type(error).__name__,
                "error_message": str(error),
            },
        )
