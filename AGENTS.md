# Project Memory Guidelines

Use the documents in `memory_doc/` as the project's persistent memory and primary source of truth. Before starting any substantial task, read the relevant memory documents and keep them updated as the project evolves.

## Memory Documents

### `history.md`

Record completed implementation work in chronological order.

- Add one concise, timestamped line for each completed task.
- Record only actions that changed, created, tested, or analyzed project artifacts.
- Do not record ordinary questions, explanations, or conversational responses.

### `research.md`

Maintain the project's evolving research and problem definition.

- Record the user's ideas, requirements, open questions, and relevant Codex research or proposals.
- Revise outdated content when decisions change.
- Do not preserve superseded ideas merely for historical accumulation.
- Keep the document consistent with the project's current direction.

### `standards.md`

Maintain the project's authoritative rules and definitions.

This document may include:

- design rules
- behavioral rules
- system principles
- terminology and unit definitions
- component responsibilities
- constraints and invariants

Update existing rules when decisions change and add new rules when needed. Avoid duplicated or conflicting statements. Treat this document as the definitive project standard.

### `handoff/`

When the conversation context must be compressed or transferred, create a numbered handoff document:

```text
memory_doc/handoff/handoff_001.md
memory_doc/handoff/handoff_002.md
...
```

Each handoff must summarize the full working context required to continue the project, including decisions, completed work, current state, unresolved issues, and next steps.

### `plan.md`

Maintain the implementation plan separately from research.

The document must contain two main sections:

1. **Phases**  
   Define the major implementation stages as `Phase 0`, `Phase 1`, and so on. The user may request work by phase.

2. **Plans**  
   Define detailed tasks for each phase. Each task must be specific, verifiable, and treated as a required completion or acceptance criterion.

Update the plan when scope, priorities, or implementation decisions change.

## Working Rule

For every implementation task:

1. Read the relevant files in `memory_doc/`.
2. Follow `standards.md` and `plan.md` as primary constraints.
3. Perform the requested work.
4. Update the affected memory documents to reflect the resulting project state.
5. Record completed implementation work in `history.md`.

Do not update memory documents mechanically. Modify only the documents affected by the task, and keep all documents concise, current, and internally consistent.