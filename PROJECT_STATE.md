# PROJECT_STATE.md

Canonical Architectural State – Voilà Automation

Last Updated: 2026-03-04

---

## 1. System Overview

Project: Voilà (voila.fit)

Purpose:
Deterministic speed-to-lead automation for real estate teams.

Design Philosophy:

- Deterministic over probabilistic
- Explicit contracts over assumptions
- State machine enforced
- No silent mutation
- Git-backed stabilization

---

## 2. Workspace Root

/home/yucky/.openclaw/workspace

All workspace-level commands should be invoked from repo root or with explicit paths.

---

## 3. Pipeline State Machine

IMPORTED  
READY_TO_DRAFT  
DRAFTED  
PENDING_SEND  
SENT  
REPLIED  
NO_REPLY

Invalid transitions must hard-fail.

---

## 4. Immutable Assets

Templates:
skills/voila/templates/

Format:
SUBJECT: ...
(blank line)
Body

Allowed placeholders:
[First Name]
[Team Name]
[Brokerage Name]

Templates must never be modified programmatically.

---

## 5. Command Responsibilities

draft.js

- Validates required placeholder values
- Stores subject + body_text
- Fails deterministically if placeholder missing

approve.js

- Only valid from DRAFTED
- Transitions → PENDING_SEND

send.js

- Requires PENDING_SEND
- Respects config.send_enabled
- Simulation allowed
- Live send only when gated true
- Must store message_id

mark_replied.js

- Requires SENT
- Requires --reply-message-id
- Requires --in-reply-to
- Stores reply_message_id + in_reply_to

---

## 6. Deterministic Guarantees

- No bulk sends
- No new dependencies without approval
- All commands return STRICT JSON
- send_enabled must revert to false after tests
- File modifications must be provable via git diff

---

## 7. Current Stabilization Status

Baseline Commits:

- stabilize draft/send gating
- trello helper refactor
- approve + mark_replied commands
- .gitignore hardened

Repo should show:
Clean working tree before new architectural changes.

---

## 8. Known Architectural Priorities

(Work one at a time)

1. Deterministic preflight gate
2. Standardized JSON failure contracts
3. Snapshot + diff assertions
4. Automated reply detection
5. Intake idempotency
6. Regression testing harness
7. SKILL.md architectural enforcement
8. Single source of truth expansion
9. Deterministic snapshot ingestion (external data → JSON)
10. CRM job ledger (task system for outreach operations)

---

## 9. Rules for New Work

Before any new feature:

- Inspect repo state
- Verify pipeline integrity
- Confirm config.send_enabled false
- Prove file diffs explicitly
- Stop after each atomic improvement

---

---

## 10. Planned Architecture: CRM Job Ledger

The Voilà automation system will introduce a deterministic job ledger to manage CRM operations.

Purpose:

Represent CRM work as explicit jobs rather than implicit actions.

Example job types:

- DRAFT_LEAD
- APPROVE_LEAD
- SEND_LEAD
- MARK_NO_REPLY
- SNAPSHOT_SYNC

Example lifecycle:

PLANNED  
READY  
EXECUTING  
COMPLETED  
FAILED

Important constraints:

- Jobs must be deterministic
- Time must be provided explicitly (--now)
- Jobs must produce STRICT JSON receipts
- Job execution must respect pipeline state invariants

Relationship to Pipeline:

The CRM pipeline (IMPORTED → SENT → REPLIED / NO_REPLY) represents lead state.

The job ledger represents **operations performed on leads**.

The ledger must never bypass pipeline transition rules.

Future automation (run_daily.js) will consume jobs from this ledger.

End of Canonical Project State
