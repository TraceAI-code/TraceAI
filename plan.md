# TraceAI — Full Roadmap to a Usable Audit Platform

> Goal: make TraceAI actually work end-to-end for AI decision traceability and audit:
> **Capture → Store → Replay → Review → Trust.**

This document is an implementation plan, not a description of existing behavior. It is ordered by
"what makes the product usable" rather than "what is architecturally nice".

---

## Current state (verified)

The cryptographic core works:

- SHA-256 hash chaining with DB-independent timestamps
- Tamper detection on event payload/hash/root-hash changes
- Content-addressable evidence storage with local and Supabase backends
- Decision lifecycle and audit timeline API
- SDK context manager, tool decorator, and LangChain callback
- Replay run persistence and diff schema
- `uv run pytest` passes (25 tests)

The product loop breaks at four places:

1. The human review UI sends actions the backend rejects.
2. A fresh database has no policies, so governance silently passes.
3. Replay copies recorded events instead of reconstructing or re-executing them.
4. The UI and README make trust claims the backend does not verify.

There are also production gaps: no auth, race-prone event appends, no real RLS policies, no
backend deployment config, and several frontend services that convert errors into empty pages.

---

## Guiding rules

1. **Every UI claim must map to a backend check.** No "intact" badge derived from
   `root_hash IS NOT NULL`.
2. **Hash changes are versioned**, never silent. Existing chains must keep verifying.
3. **Replay is trace reconstruction**, not LLM re-execution, until an adapter exists. Label it
   that way.
4. **Each milestone ships with contract tests** at the API boundary, not just unit tests.
5. **No hardcoded identities** (`auditor-ui`) in anything that claims to be an audit trail.

---

## Milestone 0 — Baseline & guardrails

**Size: S · No user-visible change**

- Add CI: `uv sync`, `pytest`, `npm ci`, `npm run build`, and `alembic upgrade head` against a
  clean Postgres service container.
- Add a `make` or script entrypoint for backend, frontend, tests, migrations, and seed.
- Add `detect-secrets` pre-commit. Document rotating the Supabase password currently in `.env`
  (confirmed never committed, but still plaintext on disk).
- Capture current API responses as fixtures so contract changes are visible in diffs.

**Done when:** CI is green on a clean clone and catches a deliberately broken review action.

---

## Milestone 1 — Make the core loop work (P0)

**Size: L · This is the milestone that makes the product usable**

### 1.1 Review contract

**Problem:** `frontend/src/types/review.ts` allows `OVERRIDDEN` and `REQUESTED_REVIEW`, and
`frontend/src/services/reviewService.ts` lowercases them to `overridden` / `requested_review`.
The backend regex in `backend/app/schemas/review.py` only allows
`approved|rejected|challenged|commented`, so two UI actions return HTTP 422.

**Backend**

- Replace the regex in `backend/app/schemas/review.py` with a `ReviewAction` enum:
  `approved`, `rejected`, `overridden`, `requested_review`, `commented`.
- Add an explicit status transition table in `backend/app/services/review_service.py`.
  `DECISION_COMPLETED` must not overwrite `reviewed_*`.
- Return `decision_id` in `ReviewResponse` (already present) and keep the action canonical
  lowercase.
- Record `HUMAN_REVIEW_<ACTION>` events with the canonical action name.

**Frontend**

- Align `ReviewActionKind` to the same five values; add a "Comment" option.
- Replace `reviewer_id: 'auditor-ui'` in `reviewService.ts` with `VITE_REVIEWER_ID` or a
  persisted reviewer name; pass it through `submitReview`.
- Require a comment for `rejected`, `overridden`, and `requested_review`.

**Tests**

- Parametrized POST for all five actions → 201, correct status, correct `HUMAN_REVIEW_*` event.
- Review-before-completion test proving status survives.

**Done when:** all five UI actions succeed against a live backend.

### 1.2 Policy correctness and seeding

**Problem:** `PolicyEngine.evaluate_decision` queries all policies, ignores effective dates, and
returns `passed: True` with `evaluated_policies: 0` when none exist, without recording an event.
A fresh database has no policies, so the sample agent reports success trivially.

**Engine (`backend/app/services/policy_engine.py`)**

- Filter to active policies using the same window as `list_policies`.
- Return `status: "not_evaluated"` with `evaluated_policies: 0` instead of `passed: true`.
- Always record a `POLICY_EVALUATION` event, including zero-policy evaluations.
- Evaluate `blocked_tools` against tool events, not only decision inputs. Add a separate
  `evaluate_tool_call` path or merge tool names into the evaluation payload.

**Schema**

- Add `status` (`active` / `scheduled` / `expired`) to `PolicyResponse`.
- Add `updated_at` (initially `created_at`).
- Add `UniqueConstraint(name, version)`.

**Seed**

- Idempotent `backend/app/seed.py` with three policies: PII filter,
  `requested_amount <= 50000`, and blocked `wire_transfer`.
- Expose as `uv run python -m app.seed`; call it from the demo script, not app startup.

**Sample agent**

- Print `evaluated_policies` count and fail loudly if zero.

**Tests**

- Empty policy set, active set, expired policy excluded, each rule type, zero-policy event.

**Done when:** the sample agent evaluates at least one policy and the dashboard count reflects it.

### 1.3 Honest replay

**Problem:** `backend/app/replay/engine.py` copies every original payload, so deterministic replay
almost always reports 100% match. `mock_tools` only sets `mocked_from_evidence: True`; setting it
to `False` changes nothing. What-if only rewrites `MODEL_INFERENCE.rationale` and replaces
`ACTION_TAKEN`; it does not re-run tools, propagate changed inputs, or recompute policies
downstream. LangChain stores evidence as `type="langchain_tool_output"`, `role="tool_result"`,
and its `TOOL_CALL_COMPLETED` payload has no `tool_name`, so replay looks for
`tool_output_{tool_name}` and defaults to `unknown_tool`.

**Engine refactor (`backend/app/replay/engine.py`)**

- Tag every replayed event with `source: "recorded" | "mocked_tool" | "simulated"`.
- Build the tool cache keyed by `(tool_name, args_hash)` and by evidence id, not just role/type.
- `mock_tools=True`: substitute cached results.
- `mock_tools=False`: mark `tool_result_available: false`; never silently copy.
- Deterministic mode: verify original event hashes/order and report `trace_verified` separately
  from `execution_match`.
- What-if: apply overrides, re-evaluate policies, and mark tool outputs as `stale` unless a rule
  maps changed inputs to new snapshots. Do not rewrite arbitrary payloads beyond documented
  fields.

**Comparator (`backend/app/replay/comparator.py`)**

- Distinguish "match", "missing snapshot", and "different result".
- Never report 100% when tools are unmatched or snapshots are absent.

**LangChain interceptor (`sdk/traceai_sdk/interceptors/langchain.py`)**

- Add `tool_name` and `arguments` to `on_tool_end`.
- Use `evidence_type=f"tool_output_{tool_name}"` to match the decorator, or teach replay both
  conventions.

**Frontend**

- Add `simulated_action` and `simulated_reasoning` inputs to `ReplayPage`.
- Show source badges and an explicit "reconstructed from recorded trace" label.

**Tests**

- Snapshot substitution, `mock_tools=False`, what-if policy divergence, LangChain tool-name
  recovery, comparator mismatch cases.

**Done when:** changing `requested_amount` in what-if changes the policy outcome in the replay
diff, and unmatched tools no longer produce a false 100%.

### 1.4 Frontend error contract

**Problem:** `decisionDetailService`, `evidenceService`, `policyService`, `replayService`, and
`integrityService` catch all errors and return `null` / `[]`, so network and 500 errors render as
empty pages or 404 states. `ApiError.detail` can be a FastAPI 422 array, which renders as
`[object Object]`.

- `frontend/src/services/apiClient.ts`: normalize FastAPI 422 arrays into readable text; add
  `isNotFound`.
- Remove catch-all `catch { return null }` from the services above.
- Add consistent page-level error banners and retry actions.

**Done when:** stopping the backend shows an error, not an empty page.

### 1.5 Visible audit surfaces

- Evidence download button on `EvidenceDetailPage` using
  `GET /api/v1/evidence/{id}/content`; show `content_verified`.
- Dashboard: batch-verify the most recent N decisions; add `verified_chain_count` /
  `verification_failure_count` to `DashboardStatsResponse`; relabel the metric.
- Audit report JSON/Markdown download buttons on `AuditReportDetailPage`.

**Done when:** tampering with an event turns the dashboard metric red.

---

## Milestone 2 — Integrity hardening (P1)

**Size: L**

### 2.1 Concurrency

**Problem:** `EventRecorder.record` reads the last event then inserts. Concurrent writers can
produce duplicate sequence numbers and forked chains, and `root_hash` becomes last-writer-wins.
`event_hash` is globally unique, which is conceptually wrong because `decision_id` is not part of
the hash material.

- Migration: `UNIQUE(decision_id, sequence_number)`, drop `unique=True` on `event_hash`, add a
  plain index, make `evidence.content_hash` unique.
- `EventRecorder`: `SELECT ... FOR UPDATE` on the decision row (Postgres) or an advisory lock;
  retry on unique violation; assert sequence continuity.
- Tests: threaded/process appends produce exactly `1..N` with one root hash.

### 2.2 Hash v2

- Add `hash_version` to `audit_events`.
- v2 material includes `decision_id`, `sequence_number`, `hash_version`, plus existing fields.
- `verify_decision_integrity` supports v1 and v2; checks `sequence_number == index + 1`.
- Align `sdk/traceai_sdk/hashing.py`; remove the unused client-side hash path or use it for
  preflight only.
- Fix README wording to match the actual material (the README currently claims `sequence` is
  included; it is not).

### 2.3 Signed checkpoints

**Problem:** an attacker with DB write access can edit events, recompute every hash, and update
`root_hash`. The chain detects accidental edits, not a determined insider.

- New `checkpoints` table: `decision_id`, `sequence_number`, `root_hash`, `created_at`,
  `key_id`, `signature`.
- HMAC-SHA256 over canonical `(decision_id, sequence_number, root_hash, created_at)` using
  `TRACEAI_CHECKPOINT_KEY` stored outside the DB.
- Create on completion and on review; add a verify endpoint and UI badge.
- Document the threat model: hash chains detect edits by someone who cannot recompute;
  checkpoints catch recomputation; neither prevents deletion without external anchoring.

### 2.4 Auth and RLS

**Problem:** the SDK sends a Bearer token, but the backend never reads `Authorization`. Reviewer
identity is hardcoded. RLS is enabled without policies and includes `alembic_version`.

- Phase A: env-based API key middleware (`TRACEAI_API_KEY`), scopes `ingest` / `read` / `review` /
  `admin`; reviewer identity from token or `X-Reviewer-Id`; frontend sends the key.
- Phase B: `api_keys` table with hashed keys and scopes.
- Replace the no-op RLS migration: real policies, remove `alembic_version`, and document that the
  Supabase pooler's `postgres` role bypasses RLS.
- Tests: 401/403, review with principal, SDK Bearer token accepted.

**Done when:** an unauthenticated write is rejected and a review event carries a real principal.

---

## Milestone 3 — Product completeness (P2)

**Size: L**

### 3.1 Policy authoring

- `PUT /policies/{id}` for metadata and effective dates; versioning via `POST` with a new version
  and a `supersedes` link.
- `PoliciesPage` create modal and `PolicyDetailPage` edit/disable.

### 3.2 Pagination and search

- Return `{items, total}` from list endpoints, or keep arrays and add `X-Total-Count` to avoid
  breaking the frontend.
- Add pagination to decisions, evidence, policies, and replays; server-side search by agent and
  status.

### 3.3 Deployment

- Backend `Dockerfile`, compose file, healthcheck, and a migration-on-start entrypoint.
- Document `CORS_ORIGINS`, `VITE_API_URL`, `TRACEAI_API_KEY`, and `TRACEAI_CHECKPOINT_KEY`.
- GitHub Actions deploy workflow.
- Vercel config: keep the SPA rewrite, add environment variable documentation.

### 3.4 Demo and docs

- `scripts/demo.py`: seed policies → run sample agent → print decision, replay, and review URLs.
- README rewrite: separate "what is cryptographically guaranteed" from "what is operationally
  guaranteed".
- Add a security and limitations section.

### 3.5 SDK robustness

- Retries with backoff, idempotency key per event, async client, explicit close, configurable
  timeout.
- Surface integrity failures without masking the original exception.

### 3.6 UX polish

- Consistent status chips across dashboard/decisions/reports.
- Empty states, loading skeletons, error banners, keyboard-accessible review form.

---

## Cross-cutting design decisions to settle before M2

1. **Policy scope.** Policies are global today. Real deployments need `agent_id` / `tenant_id`
   scoping. Decide whether to add `scope` now or defer.
2. **Multi-tenancy.** No `tenant_id` anywhere. If this is single-org, fine. If SaaS, it must be
   added before auth.
3. **Auth default.** Recommend `AUTH_ENABLED=true` outside local development, with a seeded demo
   key.
4. **Hash v2 rollout.** Dual verification is mandatory; do not invalidate existing chains.
5. **Replay promise.** Commit to "trace reconstruction + optional adapter" in the UI and docs. A
   true re-execution adapter is a separate project.

---

## PR sequence

| PR | Contents | Depends on |
|----|----------|------------|
| 1 | CI, scripts, secret scan, fixtures | — |
| 2 | Review contract (backend + frontend + tests) | 1 |
| 3 | Policy engine correctness + response fields + tests | 1 |
| 4 | Policy seed + sample agent + demo script | 3 |
| 5 | Replay engine refactor + LangChain tool name + tests | 1 |
| 6 | Replay UI simulation inputs + source badges | 5 |
| 7 | Frontend error handling + evidence download + dashboard verification | 2 |
| 8 | Concurrency migration + EventRecorder locking + tests | 3 |
| 9 | Hash v2 + dual verification + README | 8 |
| 10 | Signed checkpoints | 9 |
| 11 | Auth phase A + reviewer identity | 2 |
| 12 | RLS real policies + auth phase B | 11 |
| 13 | Policy CRUD UI | 3 |
| 14 | Pagination/search | 2, 13 |
| 15 | Docker/CI deploy + demo docs | 4, 10 |
| 16 | SDK robustness + UX polish | 11 |

Each PR should leave `pytest` and `npm run build` green and include at least one new contract test.

---

## Definition of done

- Fresh clone → `.env.example` → migrate → seed → demo script works in under 5 minutes.
- A reviewer can approve/reject/override/request-review from the UI and see it in the chain.
- The sample agent produces at least one real policy evaluation.
- Deterministic replay truthfully reports trace verification; what-if replay shows a real policy
  diff.
- Tampering with an event is detected on the detail page **and** the dashboard.
- No write endpoint accepts unauthenticated requests outside dev.
- README claims match implemented behavior.
