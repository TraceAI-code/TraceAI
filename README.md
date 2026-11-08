# TraceAI: AI Decision Traceability & Audit System

> **Capture $\rightarrow$ Store $\rightarrow$ Replay $\rightarrow$ Review $\rightarrow$ Trust**

TraceAI is a comprehensive, tamper-evident audit platform and observability system designed specifically for autonomous AI agents, multi-step LLM workflows, and algorithmic decision systems. It provides end-to-end cryptographic integrity verification, immutable content-addressable evidence storage, deterministic and what-if sandboxed replays, automated policy guardrail enforcement, and human-in-the-loop audit review workflows.

---

## 🌟 Key Capabilities

- **Tamper-Evident SHA-256 Audit Trails**: Deterministic cryptographic hash chaining links every event (`DECISION_CREATED`, `PLAN_GENERATED`, `TOOL_CALL`, `MODEL_INFERENCE`, `ACTION_TAKEN`) from genesis to root hash. Any unauthorized modification to historic events breaks the chain and is detected instantly.
- **Content-Addressable Evidence Snapshots**: Large raw prompts, tool inputs/outputs, documents, and external API responses are captured, SHA-256 hashed, and deduplicated using local storage or Supabase Cloud Object Storage.
- **Sandboxed Decision Replay & What-If Simulations**:
  - **Deterministic Replay**: Re-executes the execution graph using recorded evidence snapshots to mock tool outputs without contacting external services or causing side effects.
  - **What-If Simulation**: Test alternative inputs, modified tool returns, or simulated reasoning/actions to identify regressions or behavioral changes.
  - **Semantic & AST Differencing**: Calculates similarity scores, highlights state differences, and generates human-readable audit reports.
- **Governance Policy Engine**: Real-time evaluation of rule-based constraints (e.g., credit thresholds, required evidence, rate caps, prohibited fields) against agent inputs, outputs, and intermediate states.
- **Human-in-the-Loop Review & Governance**: Allows auditors, risk managers, and compliance teams to sign off on decisions, log formal audit notes, and track compliance status (`APPROVED`, `REJECTED`, `FLAGGED_FOR_REVIEW`).
- **Developer-Friendly Python SDK (`traceai-sdk`)**: Zero-overhead instrumentation for custom agents or frameworks like LangChain and LangGraph via context managers and `@instrument_tool` decorators.
- **Modern Audit UI**: Interactive React dashboard for visualizing execution graphs, inspecting evidence blobs, comparing replay diffs, managing policies, and tracking system-wide audit metrics.

---

## 🏗️ Architecture & System Design

```
+-----------------------------------------------------------------------------------+
|                            Autonomous AI Agent / Application                      |
|           (LangChain, LangGraph, AutoGen, CrewAI, Custom Python Service)          |
+-----------------------------------------------------------------------------------+
                                          |
                                          | Instruments & Streams Events
                                          v
+-----------------------------------------------------------------------------------+
|                              TraceAI Python SDK                                   |
|   * DecisionContext (Lifecycle & Hash Chain)   * @instrument_tool (Auto-snapshot)  |
|   * Local SHA-256 Chaining                     * LangChain Interceptor Handler    |
+-----------------------------------------------------------------------------------+
                                          |
                                          | REST API (HTTP / JSON)
                                          v
+-----------------------------------------------------------------------------------+
|                               TraceAI Backend (FastAPI)                           |
|  /api/v1/decisions  |  /api/v1/evidence  |  /api/v1/policies  |  /api/v1/replays  |
|-----------------------------------------------------------------------------------|
|  * Event Recorder & Integrity Verifier        * Policy Engine                     |
|  * Sandboxed Replay Engine & Comparator       * Audit Report Generator            |
+-----------------------------------------------------------------------------------+
             |                                                  |
             v                                                  v
+-----------------------------+               +-------------------------------------+
|      Relational Database    |               |         Evidence Storage            |
|   (PostgreSQL / Supabase)   |               | Local Disk (`./data/evidence`) or   |
|   * Decisions & Audit Events|               | Supabase S3 Object Storage Bucket   |
|   * Evidence Links & Replays|               +-------------------------------------+
|   * Policies & Reviews      |
+-----------------------------+
             ^
             | Consumes API
+-----------------------------------------------------------------------------------+
|                        TraceAI Management Dashboard (React + Vite)                |
|  * Real-time Metrics & Audit Graphs           * Detailed Step-by-Step Timelines   |
|  * Cryptographic Verification Inspector       * Replay Comparator & Diff Viewer   |
|  * Policy Definition & Compliance Status      * Human Sign-Off / Review Portal    |
+-----------------------------------------------------------------------------------+
```

---

## 📁 Repository Structure

```
TraceAI/
├── backend/                       # Core FastAPI application
│   ├── app/
│   │   ├── api/                   # REST API routes (decisions, evidence, policies, replay)
│   │   ├── core/                  # Configurations and SHA-256 canonical hashing engine
│   │   ├── db/                    # SQLAlchemy database engine and ORM models
│   │   ├── replay/                # Sandboxed ReplayEngine, ExecutionComparator, Reporter
│   │   ├── schemas/               # Pydantic validation schemas
│   │   ├── services/              # Decision, event, evidence, policy, and review services
│   │   ├── storage/               # Evidence storage abstraction (Local File & Supabase)
│   │   └── main.py                # FastAPI application entry point & CORS configuration
│   └── tests/                     # Backend test suite (integrity, storage, replay, policies)
│
├── frontend/                      # React SPA Dashboard (Vite + TypeScript + Tailwind CSS)
│   ├── src/
│   │   ├── components/            # Reusable UI widgets, badges, diff viewers, charts
│   │   ├── layouts/               # Dashboard layout shell and navigation sidebar
│   │   ├── pages/                 # Full views: Dashboard, Decisions, Evidence, Policies, Replay
│   │   ├── services/              # API clients for backend communication
│   │   ├── types/                 # TypeScript interfaces for API models
│   │   ├── App.tsx                # Client routing configuration
│   │   └── main.tsx               # UI entry point
│   ├── package.json               # Frontend dependencies (React 18, Vite 6, Tailwind 4)
│   └── vite.config.ts             # Vite configuration
│
├── sdk/                           # TraceAI Python SDK (`traceai-sdk`)
│   ├── traceai_sdk/
│   │   ├── client.py              # Synchronous HTTP API client (`TraceAIClient`)
│   │   ├── context.py             # Context manager (`DecisionContext`) for automated tracing
│   │   ├── hashing.py             # Client-side canonical JSON & SHA-256 chain calculation
│   │   ├── models.py              # SDK domain and response models
│   │   ├── interceptors/          # Tool decorators & LangChain callback handlers
│   │   └── exceptions.py          # SDK specific error types
│   ├── tests/                     # SDK unit and integration tests
│   ├── pyproject.toml             # SDK package metadata
│   └── README.md                  # Dedicated SDK documentation
│
├── alembic/                       # Database schema migrations
│   ├── versions/                  # Migration versions (decisions, evidence, policies, RLS)
│   └── env.py                     # Alembic configuration
│
├── data/evidence/                 # Local directory for content-addressable evidence blobs
├── examples/                      # Runnable agent workflows and demonstrations
│   └── sample_agent/              # End-to-end loan underwriting risk agent
├── .env.example                   # Environment configuration template
├── alembic.ini                    # Alembic settings file
├── pyproject.toml                 # Root workspace dependencies managed with uv
└── README.md                      # Primary project documentation
```

---

## ⚡ Quickstart Guide

### 1. Prerequisites

- Python 3.11+
- [uv](https://github.com/astral-sh/uv) (recommended Python package manager)
- Node.js 18+ & npm
- PostgreSQL database (or [Supabase](https://supabase.com))

### 2. Environment Setup

Clone the repository and copy the environment template:

```bash
git clone https://github.com/your-org/TraceAI.git
cd TraceAI
cp .env.example .env
```

Edit `.env` to configure your database and storage:

```env
DATABASE_URL=postgresql+psycopg://username:password@localhost:5432/traceai

# Optional: Supabase Storage for Evidence Blobs (falls back to ./data/evidence if omitted)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-key
SUPABASE_STORAGE_BUCKET=traceai-evidence

# Browser origins allowed to call the API (comma-separated). Use "*" to allow any,
# which disables credentialed requests as required by the CORS spec.
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

### 3. Backend Setup

Install dependencies and run database migrations:

```bash
# Install Python dependencies using uv
uv sync

# Run database migrations
uv run alembic upgrade head

# Start the FastAPI development server
uv run uvicorn app.main:app --app-dir backend --reload --port 8000
```

The backend API will be running at [http://127.0.0.1:8000](http://127.0.0.1:8000). Interactive Swagger documentation is available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

### 4. Frontend Setup

In a new terminal window:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) to view the TraceAI Management Dashboard.

---

## 📦 Using the Python SDK

Install the SDK in your project or agent repository:

```bash
pip install -e sdk/
```

### Basic Context Manager Tracing

```python
from traceai_sdk import DecisionContext, TraceAIClient

with DecisionContext(
    agent_id="credit_risk_agent",
    agent_version="1.0.0",
    input_data={"applicant_id": "app_1001", "requested_amount": 50000},
    endpoint="http://localhost:8000",
    verify_on_exit=True,
) as ctx:
    # 1. Record planning step
    ctx.record_event("PLAN_GENERATED", {"steps": ["check_credit", "run_policy", "decide"]})

    # 2. Store evidence snapshot
    ev = ctx.record_evidence(
        evidence_type="credit_report",
        content={"bureau": "Experian", "score": 750, "delinquencies": 0},
    )
    ctx.record_event("EVIDENCE_RETRIEVED", {"source": "Experian"}, evidence_ids=[ev.id])

    # 3. Model inference / reasoning
    ctx.record_event(
        "MODEL_INFERENCE",
        {"model": "gpt-4o", "rationale": "Credit score 750 meets minimum risk parameters."},
    )

    # 4. Take final action
    ctx.record_event("ACTION_TAKEN", {"action": "APPROVE_LOAN", "amount": 50000})

# Verify the cryptographic integrity of the decision chain
client = TraceAIClient(endpoint="http://localhost:8000")
verification = client.verify_integrity(ctx.decision_id)
print(f"Chain Valid: {verification.valid} | Root Hash: {verification.root_hash}")
```

### Auto-Instrumenting Agent Tools

Use the `@instrument_tool` decorator to automatically trace tool executions, measure latency, and capture large return payloads into content-addressable storage:

```python
from traceai_sdk import instrument_tool

@instrument_tool(name="fetch_bureau_records", snapshot=True)
def fetch_bureau_records(applicant_id: str) -> dict:
    # Heavy external API call or document fetch
    return {"applicant_id": applicant_id, "score": 760, "open_lines": 5}
```

---

## 🧪 Running the Sample Agent

TraceAI includes a complete reference agent demonstrating loan underwriting, tool instrumentation, policy evaluation, and cryptographic verification:

```bash
uv run python examples/sample_agent/agent.py --endpoint http://127.0.0.1:8000
```

---

## 🔬 Testing

TraceAI uses `pytest` across both backend and SDK components:

```bash
# Run pure unit tests (hashing, local algorithms)
uv run pytest backend/tests/test_hashing.py sdk/tests/test_hashing.py

# Run all integration tests (requires active DATABASE_URL)
uv run pytest
```

---

## 🔒 Security & Data Integrity

- **Canonical Event Serializing**: Event hashing handles JSON serialization deterministically (sorted keys, compact delimiters, UTC ISO timestamps) to guarantee reproducibility across different platforms.
- **Cryptographic Audit Linking**: Each event stores `previous_hash` and `event_hash = SHA256(previous_hash + sequence + event_type + payload_hash)`.
- **Database Row Level Security (RLS)**: PostgreSQL migrations include Row Level Security policies to prevent unauthorized data tampering at the storage layer.

---

## 📄 License

TraceAI is distributed under the Apache-2.0 License.
