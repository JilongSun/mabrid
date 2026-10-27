# Decision Governance

This is the owner-approved workflow for maintaining architecture decisions and reviewing coupled
changes. It governs review and record keeping, not permission to implement an unapproved product
design. The owner approved this lightweight process on 2026-10-26.

Start at the [decision log](decision-log.md). It contains the ADR index and the current change-set
review entries. This document defines the process; individual ADRs retain decision rationale;
change-set entries connect decisions to a specific delivery outcome. Do not create a second ADR
catalog or require the owner to reread every historical decision for each batch.

## Decision Lifecycle

Decision status describes authority, not implementation progress.

| State | Meaning |
| --- | --- |
| Proposed | A design under review; it does not replace accepted constraints |
| Accepted | The owner explicitly approved the decision within its stated scope |
| Rejected | The owner declined the proposal; retain its rationale and disposition |
| Withdrawn | A proposal was abandoned before acceptance; record why |
| Superseded | An explicitly identified accepted replacement fully replaces the decision |

Allowed transitions:

| Transition | Required evidence |
| --- | --- |
| Proposed -> Accepted | Explicit owner approval, reviewed scope, consequences, and resolved conflicts |
| Proposed -> Rejected | Owner disposition and reason |
| Proposed -> Withdrawn | Withdrawal and reason; do not treat inactivity as withdrawal |
| Accepted -> Accepted with amendment links | Explicitly approved, scoped amendment, with affected clauses and preserved requirements identified |
| Accepted -> Superseded | An accepted replacement and explicit confirmation that the old decision is fully replaced |

Rejected, Withdrawn, and Superseded records are not silently reactivated. A materially new proposal
gets a new record and links to the earlier rationale. Reverting an accepted design also requires
an explicit replacement or amendment, not a status reset.

An amended ADR remains Accepted for its surviving requirements. "Amended" is a relationship, not
a lifecycle state. Never mark a whole ADR Superseded when only its branding, release scope, or one
behavior has changed. A higher ADR number, newer timestamp, more implementation, or branch name
does not resolve a contradiction by itself. Unresolved contradictions block the affected design
change; unrelated delivery may proceed only when its independence is explicit.

## Delivery And Verification

Keep these facts separate in the decision log and change-set entries:

- **Decision lifecycle:** whether a design is authoritative.
- **Delivery state:** Pending, Partial, or Implemented, for a named scope and assessment date.
- **Verification evidence:** the command, artifact, inspection, or owner report supporting a claim,
  including what was not verified.
- **Release state:** a publication fact; neither acceptance nor test success establishes release.

Pending means no delivery of the assessed behavior; Partial means some behavior or required
verification is still missing; Implemented means the named scope has executable behavior and its
required focused evidence. Use "Not applicable" for a process-only decision rather than inventing
runtime work. Proposed is not an implementation state. Record blockers and deferred work as
explanations, not extra lifecycle states.

One ADR may cover several release scopes. "Implemented for v0.1 read-only management" does not
mean that later managed writes exist. Conversely, deferred writes do not make the released
read-only feature incomplete. Scope an assessment instead of converting every historical Pending
or Partial label into an independently authorized feature.

Historical implementation snapshots retain their dates. Later evidence or publication reports
may update the current log without rewriting what an old snapshot claimed. Label source inspection,
controlled tests, live deployment checks, and owner-reported publication distinctly. Do not claim
live acceptance from an image build or interpret missing evidence as proof of failure.

## Change-Set Review

The unit of review is a coherent change set, which may cross features, contexts, and ADRs. It is
not one ADR per branch, one ADR per feature, or one independent ticket per accepted decision.

A long-lived workstream may have several small change sets. Its record is an entry point, not a
single approval for all later work. Reuse the existing entry while the review remains small;
create a focused linked design note or ADR when the actual decision needs one. Do not copy the
entire ADR inventory into each entry or create an exhaustive feature-to-ADR matrix.

Each entry contains:

1. **Identity and outcome:** a stable local identifier, workstream, desired outcome, and scope
   exclusions. The identifier is a review handle, not another ADR numbering system.
2. **Review state and scope approval:** distinguish approval of the workstream's goals from approval
   of a detailed design or permission for a specific implementation batch.
3. **Relevant decision relationships:** a short table of retained constraints, dependencies,
   required amendments, and unresolved conflicts. Link to the specific affected sections.
4. **Review delta:** what changes, what stays true, and the compatibility or migration impact.
   Summarize only the clauses the owner must evaluate now.
5. **Owner questions and dispositions:** concrete alternatives or decisions, their effect on the
   coupled outcome, approval evidence, and any explicitly deferred or excluded items.
6. **Next permitted batch and verification:** the smallest coherent delivery slice, prerequisites,
   acceptance checks, and the limits of existing evidence.

Review states are separate from ADR and delivery states:

| Transition | Condition |
| --- | --- |
| Draft -> Ready | The proposed delta, relationships, conflicts, alternatives, and owner questions are reviewable |
| Ready -> Draft | New evidence or feedback requires design changes |
| Ready -> Approved | The owner explicitly approves the identified design and bounded batch; unresolved items are excluded from that approval |
| Approved -> Draft | A material scope, contract, or migration change needs renewed approval; retain the earlier disposition |
| Approved -> Closed | The approved batch has its required delivery evidence, or the owner explicitly closes it without delivery and records the reason |
| Draft/Ready -> Closed | The owner cancels or defers the review with a reason; no implementation is implied |

Closing an entry does not supersede an ADR or claim a release. Cosmetic edits and additional
compatible evidence do not require a new approval cycle. A question, silence, branch creation,
or approval of this process is not acceptance of a product proposal.

### Before The Next Product Batch

1. Read the active entry and only the relevant ADR clauses and explicit amendment chain.
2. Classify the inputs as accepted decisions, verified evidence, proposals, or collaboration
   context. Exclude personal context from committed records.
3. Reconcile the coupled constraints together. Record contradictions and any required amendments
   before changing code; do not choose whichever ADR appears newest.
4. Present one short owner review: desired outcome, delta, unresolved questions, recommendation,
   excluded work, and the next testable batch. Group interdependent approvals together.
5. After explicit approval, record the disposition and reconcile the necessary ADR notices,
   current log, and detailed contract as one coherent documentation change set.
6. Implement only the approved batch; update delivery evidence and residual gaps afterward.

Routine fixes, tests, refactoring within accepted boundaries, and implementation details do not
need ceremonial new ADRs or repeated architectural approval. They still require normal task
authorization and focused verification. If a fix changes an accepted boundary, record the focused
decision delta, including during an urgent hotfix; urgency is not implicit architectural approval.

## Record Maintenance

- Preserve existing ADR identifiers, paths, context, and historical rationale. Do not renumber,
  merge, or bulk rewrite ADRs just to reduce the visible count.
- Use a new ADR for a durable decision with meaningful alternatives or cross-context consequences.
  A focused clarification may amend an existing ADR, with date, affected clauses, approval, and
  reciprocal notices in the related records and log.
- Distinguish "depends on", "clarifies", "amends", and "fully supersedes". List direct,
  review-relevant relationships, not every transitive reference.
- Update active entries when scope, owner dispositions, evidence, or next-batch eligibility
  changes. When closed, retain the entry below the active reviews with its disposition and links;
  do not discard the decision trail.
- Do not rewrite all existing metadata to adopt this process. Normalize an ADR only when the
  next change actually touches its governing clauses; use scoped current assessments in the log.
- Keep project instructions short: they point to this workflow, not a duplicated implementation
  ledger. Temporary reports and excluded local notes are evidence or discussion, not an authority
  that overrides accepted project decisions.

## Workstream And Integration Boundaries

The owner approved these delivery boundaries on 2026-10-26. The names identify intended long-lived
workstreams, not evidence that Git branches have been created or that product designs are approved.

| Workstream | Purpose | Integration boundary |
| --- | --- | --- |
| `explore/frontend-experience` | Explore Mabrid's interaction model, information architecture, and experience | Keep prototypes separate; deliver selected, reviewed outcomes in small feature branches, not a bulk merge of experimental code |
| `feat/managed-config-and-recovery` | Replace handwritten product YAML with managed configuration; deliver basic CI, automatic source-version handling, and tag-triggered releases | Topology, Agent Host/runtime, recovery, and old deferred work enter only as necessary support or through a separately approved scope expansion |
| Focused feature branches | Deliver a coherent user-facing outcome | Backend and supporting frontend behavior belong together; unrelated experience experiments do not |
| Focused fix/hotfix branches | Correct a bounded defect | Fix `main` normally; when a release cannot include newer `main` changes, patch from its release baseline and return the fix to `main` |

Long-lived workstreams do not require large integrations. Keep them synchronized with `main`,
integrate reviewed coherent slices, and preserve a usable mainline. Frequent integration is
acceptable; merging is not a release, and release remains an explicit version-tag operation.
When a supporting fix or CI slice lands separately, update the workstream's review entry rather
than duplicating or reimplementing it.

Exploration does not authorize changes to frozen product contracts. A feature's frontend work
prioritizes a complete usable feature, including necessary interaction and error states; it is
not an opportunity to introduce an unrelated product-wide redesign. Routine frontend fixes do
not need to pass through the exploration workstream.
