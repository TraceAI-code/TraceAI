"""Sample Agent: Loan Underwriting & Risk Assessment.

Demonstrates how to use the TraceAI SDK to audit an agent workflow:
1. Plan the decision steps.
2. Call tools to gather evidence.
3. Evaluate policies against business rules.
4. Run model reasoning.
5. Take an action and verify the cryptographic audit chain.
"""

import argparse
import sys
import time
from traceai_sdk import DecisionContext, TraceAIClient, instrument_tool


# Tool definitions instrumented to automatically log inputs, run times, and outputs
@instrument_tool(name="fetch_credit_bureau_data", snapshot=True)
def fetch_credit_bureau_data(applicant: str, bureau: str = "Experian") -> dict:
    """Fetch simulated credit bureau records for an applicant."""
    time.sleep(0.15)
    return {
        "bureau": bureau,
        "applicant": applicant,
        "score": 760,
        "open_lines": 6,
        "delinquencies": 0,
        "oldest_account_years": 12,
        "monthly_debt_obligations": 1400,
    }


@instrument_tool(name="run_anti_fraud_check")
def run_anti_fraud_check(applicant: str, requested_amount: int) -> dict:
    """Run simulated fraud and identity checks for an applicant."""
    time.sleep(0.08)
    return {
        "applicant": applicant,
        "fraud_risk_score": 12,
        "identity_verified": True,
        "decision": "LOW_RISK",
    }


def run_loan_agent(
    applicant_name: str = "Sarah Connor",
    credit_score: int = 760,
    requested_amount: int = 45000,
    annual_income: int = 110000,
    endpoint: str = "http://127.0.0.1:8000",
):
    """Run the loan underwriting agent workflow."""
    print("=" * 60)
    print(f"[*] Starting Loan Underwriting Agent for {applicant_name}")
    print(f"[*] Connecting to TraceAI Audit System at: {endpoint}")
    print("=" * 60)

    input_payload = {
        "applicant": applicant_name,
        "credit_score": credit_score,
        "requested_amount": requested_amount,
        "annual_income": annual_income,
    }

    # Start a traced decision session
    with DecisionContext(
        agent_id="loan_underwriter_agent",
        agent_version="1.3.0",
        input_data=input_payload,
        endpoint=endpoint,
        flush_mode="immediate",
        verify_on_exit=True,
    ) as ctx:
        print(f"\n[+] Decision session created. ID: {ctx.decision_id}")

        # Step 1: Record the execution plan
        print("\n--- [Step 1: Planning Execution] ---")
        plan_data = {
            "steps": [
                "fetch_credit_report",
                "run_fraud_check",
                "evaluate_governance_policy",
                "calculate_debt_to_income",
                "generate_recommendation",
            ],
            "max_risk_tolerance": "moderate",
        }
        ctx.record_event("PLAN_GENERATED", plan_data)
        print("  -> Plan recorded in audit chain.")

        # Step 2: Retrieve evidence using instrumented tools
        print("\n--- [Step 2: Retrieving Evidence via @instrument_tool] ---")
        bureau_report = fetch_credit_bureau_data(applicant=applicant_name)
        print("  -> fetch_credit_bureau_data completed & automatically stored in Evidence Store.")

        fraud_check = run_anti_fraud_check(applicant=applicant_name, requested_amount=requested_amount)
        print(f"  -> run_anti_fraud_check completed (Risk Score: {fraud_check['fraud_risk_score']}).")

        # Step 3: Evaluate governance policies
        print("\n--- [Step 3: Governance Policy Evaluation] ---")
        policy_evaluated = False
        evaluated_policy_count = 0
        try:
            policy_eval = ctx.evaluate_policies(
                target_payload={"requested_amount": requested_amount, "credit_score": credit_score}
            )
            policy_evaluated = True
            evaluated_policy_count = policy_eval.get("evaluated_policy_count", 0)
            evaluated_count = evaluated_policy_count
            status = policy_eval.get("status", "unknown")
            print(f"  -> Policy status: {status} ({evaluated_count} active policy/policies evaluated)")
            if evaluated_count == 0:
                print(
                    "  -> WARNING: No active policies were registered. "
                    "This decision was NOT policy-checked. Seed policies with: "
                    "uv run python -m app.seed"
                )
            for policy_name in policy_eval.get("evaluated_policies", []):
                print(f"     - {policy_name}")
            if policy_eval.get("violations"):
                print(f"  -> Warning: {len(policy_eval['violations'])} policy violation(s) detected!")
        except Exception as e:
            print(f"  -> Policy evaluation note: {e}")

        if not policy_evaluated:
            print(
                "  -> WARNING: Policy evaluation failed. This decision has no "
                "trustworthy governance result."
            )

        # Step 4: Record model reasoning and risk analysis
        print("\n--- [Step 4: Reasoning & Analysis] ---")
        monthly_income = annual_income / 12
        monthly_debt = bureau_report["monthly_debt_obligations"]
        dti_ratio = round((monthly_debt / monthly_income) * 100, 2)

        reasoning_payload = {
            "model": "claude-3-5-sonnet",
            "calculated_dti_percent": dti_ratio,
            "dti_threshold": 43.0,
            "credit_score_threshold": 680,
            "rationale": (
                f"Applicant credit score {credit_score} is well above threshold (680). "
                f"DTI ratio is {dti_ratio}%, below maximum allowable 43.0%. "
                f"Requested amount ${requested_amount:,} is within income parameters."
            ),
            "confidence_score": 0.98,
        }
        ctx.record_event("MODEL_INFERENCE", reasoning_payload)
        print(f"  -> Reasoning logged: DTI={dti_ratio}%, Confidence={reasoning_payload['confidence_score']}")

        # Step 5: Execute final action
        print("\n--- [Step 5: Executing Final Action] ---")
        action_payload = {
            "action": "APPROVE_LOAN",
            "approved_amount": requested_amount,
            "interest_rate_percent": 6.25,
            "amortization_months": 36,
            "stipulations": ["Submit proof of employment prior to disbursement"],
        }
        ctx.record_event("ACTION_TAKEN", action_payload)
        print(f"  -> Action taken: {action_payload['action']} (${action_payload['approved_amount']:,})")

    # Verify the cryptographic integrity of the decision chain
    print("\n" + "=" * 60)
    print("[*] Verifying Decision Cryptographic Audit Trail...")
    client = TraceAIClient(endpoint=endpoint)
    try:
        integrity = client.verify_integrity(ctx.decision_id)
        print(f"  -> Audit Chain Valid: {integrity.valid}")
        print(f"  -> Total Events Chained: {integrity.event_count}")
        print(f"  -> Final Decision Root Hash: {integrity.root_hash}")
        print("=" * 60)
        print("[SUCCESS] Agent decision fully captured, hashed, and verified!")
        if evaluated_policy_count == 0:
            print(
                "[FAIL] No governance policy was evaluated for this decision. "
                "The audit chain is intact, but the decision was not policy-checked. "
                "Run: uv run python -m app.seed"
            )
            raise SystemExit(1)
    finally:
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run TraceAI Sample Underwriting Agent")
    parser.add_argument("--endpoint", default="http://127.0.0.1:8000", help="TraceAI API endpoint")
    parser.add_argument("--applicant", default="Sarah Connor", help="Applicant name")
    parser.add_argument("--score", type=int, default=760, help="Credit score")
    parser.add_argument("--amount", type=int, default=45000, help="Requested loan amount")
    parser.add_argument("--income", type=int, default=110000, help="Annual income")
    args = parser.parse_args()

    try:
        run_loan_agent(
            applicant_name=args.applicant,
            credit_score=args.score,
            requested_amount=args.amount,
            annual_income=args.income,
            endpoint=args.endpoint,
        )
    except Exception as e:
        if "actively refused" in str(e) or "ConnectError" in type(e).__name__:
            print(f"\n[!] Error: Unable to connect to TraceAI backend at {args.endpoint}.")
            print("    Please ensure the backend is running. Run:")
            print("    uvicorn app.main:app --host 127.0.0.1 --port 8000")
            sys.exit(1)
        raise
