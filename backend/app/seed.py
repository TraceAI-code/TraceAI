"""Idempotent seed data for TraceAI.

Run with::

    uv run python -m app.seed

The seed registers a small, realistic governance baseline so a fresh database
does not silently "pass" policy evaluation with zero policies. It is safe to
run repeatedly: existing (name, version) pairs are skipped.
"""

from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.db.models import Policy
from app.schemas.policy import PolicyCreate
from app.services.policy_service import create_policy


SEED_POLICIES: list[dict] = [
    {
        "name": "pii_guardrail",
        "version": "1.0.0",
        "description": "Blocks decision inputs that contain sensitive personal data.",
        "rules": {
            "rules": [
                {
                    "id": "no_pii_in_payload",
                    "type": "pii_filter",
                    "patterns": ["ssn", "credit_card", "email"],
                    "action": "block",
                    "message": "Sensitive personal data must not be processed by the agent.",
                }
            ]
        },
    },
    {
        "name": "lending_amount_limit",
        "version": "1.0.0",
        "description": "Caps the requested loan amount at 50,000.",
        "rules": {
            "rules": [
                {
                    "id": "max_requested_amount",
                    "type": "threshold",
                    "field": "requested_amount",
                    "operator": "<=",
                    "value": 50000,
                    "action": "block",
                    "message": "Requested amount exceeds the permissible lending threshold.",
                }
            ]
        },
    },
    {
        "name": "prohibited_tools",
        "version": "1.0.0",
        "description": "Blocks high-risk tools from being invoked by autonomous agents.",
        "rules": {
            "rules": [
                {
                    "id": "no_high_risk_tools",
                    "type": "blocked_tools",
                    "tools": ["wire_transfer", "bypass_kyc", "execute_shell", "delete_database"],
                    "action": "block",
                    "message": "Tool is prohibited by governance policy.",
                }
            ]
        },
    },
]


def seed_policies(db: Session) -> list[Policy]:
    """Create any missing seed policies and return the newly created records."""
    created: list[Policy] = []
    for spec in SEED_POLICIES:
        exists = (
            db.query(Policy)
            .filter(Policy.name == spec["name"], Policy.version == spec["version"])
            .first()
        )
        if exists:
            continue
        created.append(create_policy(db, PolicyCreate(**spec)))
    return created


def main() -> None:
    """Seed the configured database with the baseline policy set."""
    db = SessionLocal()
    try:
        created = seed_policies(db)
        if created:
            print(f"Seeded {len(created)} policies:")
            for policy in created:
                print(f"  - {policy.name} v{policy.version} ({policy.status})")
        else:
            print("Seed policies already present; nothing to do.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
