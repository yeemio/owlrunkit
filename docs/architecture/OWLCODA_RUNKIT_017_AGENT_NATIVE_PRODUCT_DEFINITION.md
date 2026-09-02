# OwlRunKit 0.17 Agent-Native Product Definition

Status: released in `owlrunkit@0.17.2` and integrated into the private mainline.

## Product purpose

OwlRunKit exists so a software objective can outlive one chat, one Agent, and
one execution attempt. Its public value is not the number of receipts it can
produce. Its value is that a user can give a large objective to an Agent team,
see who owns each part, recover the work after interruption, make decisions at
the right point, and inspect the evidence behind the result.

The 0.17 product sentence is:

> A persistent project truth coordinates multiple Agents while RunKit proves
> the work, handoffs, decisions, and delivery state behind that truth.

0.17 is an upgrade of the 0.16 trustworthy-execution kernel, not a replacement.
Executions, exact leases, SourceCandidate, verification receipts, closeouts,
recovery, and authority boundaries remain the enforcement foundation.

## Primary user experience

The product is Agent-native. Users do not need to learn the internal command
graph. Natural requests map to durable actions:

| User intent | Agent action | Durable truth |
| --- | --- | --- |
| "Break this large task up and run it in parallel" | Define workstreams and work items, then assign Agents | Project definition and assignment events |
| "What is everyone doing?" | Read the project projection | Per-Agent active, waiting, completed, and failed work |
| "What is blocking us?" | Read dependencies, decisions, and critical work | Blockers, open decisions, ready queue, integration gates |
| "I have decided" | Resolve the named decision with rationale and evidence | Append-only decision history |
| "Hand this to another Agent" | Record a handoff, then create a successor assignment | Preserved assignment and handoff history |
| "Continue this work" | Build a blank-session takeover packet | Goal, owned work, evidence, blocker, and next action |
| "Verify and finish it" | Run the appropriate assurance lane and bind its result | Execution, lease, verification, closeout, and gate truth |
| "Keep this as training data" | Record a provenance-bound candidate | Candidate only; never automatic dataset admission |

The Agent may use CLI commands internally, but the user-facing interaction
remains goal, progress, decision, and outcome oriented.

## Persistent project model

The minimum project truth consists of:

- Project objective;
- Milestones and workstreams;
- WorkItems with dependency edges and non-overlapping owned paths;
- AgentAssignment history, including optional exact RunKit execution and lease
  binding;
- Checkpoints with state, evidence, blockers, decision references, and the next
  action;
- DecisionNodes with an explicit Owner and append-only resolution;
- IntegrationGates that cannot pass before their work and decision
  prerequisites;
- EvidenceLineage and data candidates with source, rights, input, output,
  decision, verification, outcome, and version references.

The WorkItem is persistent. An Agent is its current assignee. Reassigning an
item does not replace its history or create a new project identity.

## Honest progress contract

RunKit does not accept self-reported completion percentages. Progress is one of:

- a typed state: planned, active, waiting for a dependency, waiting for a
  decision, verifying, ready to integrate, completed, or failed;
- measured units against a total declared before work starts.

A completed checkpoint requires evidence. If an assignment is bound to a
RunKit execution, completion additionally requires a trusted accepted closeout
and a released or preserved-inactive lease. A blocked or rejected execution is
projected as failed even if an Agent claims success.

Project status is derived from immutable definition and append-only events. It
shows:

- each Agent's active, waiting, completed, and failed work;
- milestone and workstream completion counts;
- unresolved dependencies and decisions;
- critical work and the ready queue;
- integration-gate readiness;
- the exact project-truth hash and evidence references.

## Cross-Agent continuity

A blank-session Agent must be able to recover its part without reading an old
chat. A takeover packet contains the project objective, its assigned work,
current state, dependency and decision blockers, evidence, assignment history,
and next action. Reading status or building a takeover packet is read-only.

A handoff is two explicit events:

1. the old Agent records what was done, the evidence, and the next action;
2. a successor assignment names the new Agent and supersedes the old
   assignment.

This preserves responsibility history and prevents a chat summary from becoming
the project system of record.

## Verification Envelope

Formal Delivery may execute a real project command only inside a
Verification Envelope that declares and enforces:

- exact executable, argv, working directory, lockfiles, environment allowlist,
  and timeout;
- immutable source, declared output, disposable scratch, and forbidden paths;
- denied or loopback-only network;
- subprocess policy and cleanup;
- bounded setup, check, and teardown phases.

The enforcement backend must prove these constraints. If it cannot, RunKit may
capture an observation but cannot produce Formal-eligible evidence. The 0.17
public package provides the enforced macOS backend; Linux remains fail-closed
until equivalent process, filesystem, credential, network, and cleanup
enforcement is available.

## Data boundary

Execution evidence can become a high-quality data candidate, but not a dataset
member by implication. A candidate remains incomplete until its rights,
decision, verification, and outcome references are present. Dataset selection,
deduplication, adjudication, quality measurement, retention, and domain meaning
remain separate responsibilities.

## Authority boundary

Project actions and Verification Envelopes never grant Git, release, publish,
deploy, credential, destructive, production, or business authority. Existing
RunKit authority checks remain mandatory. A status projection describes truth;
it does not authorize the next side effect.

## 0.17 acceptance standard

The release is acceptable only when all of these are mechanically demonstrated:

1. one project can project several Agents working in parallel;
2. dependencies, decisions, handoffs, integration gates, and ready work are
   derived from append-only artifacts;
3. a fresh Agent can recover a bounded next action without old chat context;
4. an execution-bound WorkItem cannot claim completion before accepted closeout
   and lease release;
5. concurrent assignments with overlapping owned paths are rejected;
6. data candidates are not silently promoted into a dataset;
7. real verification commands can enter Formal only under an enforced
   Verification Envelope;
8. source writes, undeclared outputs, forbidden credential reads, unauthorized
   network, leaked processes, receipt drift, and unavailable enforcement all
   fail closed;
9. existing 0.16 execution, migration, fleet, deployment, and release contracts
   remain compatible;
10. the standalone npm artifact is reproducible, scrubbed, identity-bound, and
   independently verified after publication.
