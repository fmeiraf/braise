# AI Company Factory — Consolidated Architecture & Operating Model

Design recap · November 12, 2026 · Version 0.2

High-level operating model refined through founder review. Technical implementation proposals remain provisional.

## 1. Executive overview

We are designing an AI-powered company factory: a persistent system that helps a solo founder discover, validate, build, and operate scalable businesses with limited daily attention.

The factory is not simply an autonomous coding system or a collection of agents. It is an organization that maintains knowledge, makes plans, coordinates work, learns from outcomes, and deploys AI agents to execute.

The fundamental objective is:

Maximize meaningful business progress while minimizing the human attention required to achieve it.

The factory should be able to support multiple ventures, including early ideas that may be explored briefly and archived, without losing the knowledge accumulated through those attempts.

### Core principles

1. The founder provides direction and judgment. Agents should operate autonomously wherever possible, but important strategic decisions remain under human control.
2. Knowledge is persistent and independent of agents. Models, providers, and harnesses can change without losing organizational understanding.
3. Ventures own their knowledge. The factory manages the portfolio and selectively shares reusable insights.
4. Planning and execution are separate. Planning decides what matters and establishes priorities. Execution uses available resources to deliver results.
5. Business progress matters more than activity. Generating code, plans, reports, or tasks is not itself evidence of commercial progress.
6. Understanding must evolve alongside execution. The system maintains traceable, current views of what is known, built, changed, and decided.
7. Complexity should be proportional to maturity. An ephemeral idea should require little structure; an operating business can accumulate much more.

### First implementation scope

The first release should prove the complete feedback loop with one real, founder-supplied venture: knowledge, planning, authorized execution, verification, learning, and founder review.

The model should preserve support for multiple ventures, but automated portfolio comparison is not a prerequisite for validating the first release.

# Part I — Overall system architecture

## 2. The organizational hierarchy

We agreed on three conceptual levels:

Factory

Permanent umbrella organization, shared capabilities, portfolio planning

Venture A

Concept

Hypotheses, evidence, decisions, work, assets

Venture B

Building

Hypotheses, evidence, decisions, work, assets

Shared Execution Infrastructure

Workers, agent harnesses, subscription capacity, verification, scheduling

### 2.1 Factory

The factory is the permanent umbrella organization.

It is responsible for maintaining the venture portfolio, allocating resources, managing shared infrastructure, and accumulating reusable knowledge.

It should continue to exist even when individual ventures fail.

Its main responsibilities are:

- Maintain and compare ventures.
- Decide which ventures receive priority.
- Schedule factory-level portfolio reviews.
- Manage shared agent execution capabilities.
- Track available LLM provider subscriptions.
- Maintain shared organizational knowledge.
- Identify reusable lessons, methods, and technical assets.

### 2.2 Venture

A venture is the fundamental unit of business development.

We agreed not to create separate entity types for ideas, candidates, and companies.

An idea is simply an early-stage venture.

Every venture owns its knowledge, objectives, plans, work, assets, and decision history.

A venture might contain only an initial thesis and a handful of research tasks, or it might eventually represent a functioning business with customers, products, repositories, and production infrastructure.

Two independent dimensions describe a venture:

| Dimension | Values                                   | Purpose                                         |
| --------- | ---------------------------------------- | ----------------------------------------------- |
| Maturity  | Concept, Validating, Building, Operating | Describes its development                       |
| Activity  | Active, Paused, Archived                 | Describes whether resources are being committed |

Maturity is descriptive, not a rigid workflow.

A venture can move backward from building to validation or explore new markets while already operating.

Archiving preserves knowledge and history but stops ordinary autonomous work.

### 2.3 Shared execution infrastructure

The factory provides the machinery used by all ventures.

It includes agent harnesses, execution workers, tool integrations, task scheduling, checkpointing, verification, and provider-capacity management.

The execution infrastructure should not own the venture's strategic direction or long-term knowledge.

It performs authorized work and reports results.

# Part II — Knowledge and organizational intelligence

## 3. The venture knowledge model

The central design decision was to make knowledge and decisions—not agents or tasks—the foundation of the system.

Each venture maintains a durable representation of its current understanding.

We identified six primary knowledge concepts.

| Concept        | Meaning                                            | Example                                            |
| -------------- | -------------------------------------------------- | -------------------------------------------------- |
| Thesis         | The business proposition being investigated        | Financial insights without direct bank connections |
| Objective      | An outcome the venture is trying to achieve        | Obtain initial evidence of customer demand         |
| Hypothesis     | A belief that may be true or false                 | Users prefer statement uploads                     |
| Evidence       | Information relevant to evaluating a belief        | Results of observed onboarding tests               |
| Decision       | A choice and its rationale                         | Pursue PDF-first onboarding                        |
| Knowledge view | A maintained representation of part of the venture | Current product architecture                       |

These concepts are related, but they must remain distinct.

In particular:

A hypothesis is not evidence. A decision is not proof. A completed task is not proof of business viability.

### 3.1 Thesis

The thesis describes the opportunity being pursued.

It should be revisable as the venture develops.

Typical information:

- Target customers.
- Customer problem.
- Proposed solution.
- Differentiation.
- Commercial assumptions.
- Current uncertainties.

We have not settled on a complete formal thesis schema.

### 3.2 Objectives

Objectives describe desired outcomes rather than implementation instructions.

Examples:

- Validate that a particular problem exists.
- Obtain initial paying customers.
- Demonstrate a technically reliable prototype.
- Resolve a critical operational issue.

Objectives help the planning system determine what work is useful.

They should connect to evidence, decisions, and completed outcomes.

Each active venture should have an explicit near-term outcome and observable success criteria agreed with the founder. Planning evaluates progress against that outcome.

Reports should distinguish commercial evidence, learning, and delivered capabilities. Completing an investigation can produce useful learning without validating its hypothesis; delivering a capability does not itself demonstrate demand.

### 3.3 Hypotheses

Hypotheses represent uncertain beliefs.

Each hypothesis should retain:

- Its statement and scope.
- Supporting evidence.
- Contradicting evidence.
- Current assessment.
- Relationships to objectives and decisions.
- Conditions that would justify reconsideration.

We agreed not to require numerical probabilities or formal Bayesian estimates at this stage.

Assessments can be qualitative and evidence-based.

### 3.4 Evidence

Evidence represents observations from research, experiments, customers, external sources, or technical verification.

It must preserve provenance.

For example, an agent-generated interpretation of a customer interview should point to the original interview record.

Evidence can support or challenge multiple hypotheses.

Its quality and applicability matter more than simply counting observations.

### 3.5 Decisions

Important decisions should preserve:

- The question being resolved.
- Available alternatives.
- Relevant evidence and assumptions.
- The selected direction.
- Rationale.
- Consequences.
- Conditions for reconsideration.

An accepted decision should not be silently rewritten by an agent.

Agents may propose changes, but consequential changes require appropriate authorization.

### 3.6 Knowledge views

Views are structured representations of the venture maintained over time.

Examples include:

| View                     | Contents                                                |
| ------------------------ | ------------------------------------------------------- |
| Business understanding   | Customers, market, problem, differentiation             |
| Product understanding    | Features, user flows, capabilities, requirements        |
| Technical architecture   | Components, dependencies, interfaces, data flows        |
| Evidence and uncertainty | Supported beliefs, unresolved questions, contradictions |
| Decision history         | Important choices, rationale, and consequences          |
| Operational state        | Deployed services, health, risks, current capabilities  |

These views are derived representations, not replacements for their original sources.

A code architecture view should remain traceable to actual repositories and commits.

A market view should remain traceable to source documents and customer observations.

### 3.7 Maintaining evolving views

Views should be updated when relevant underlying information changes.

The proposed sequence is:

New event or evidence

Identify impacted knowledge

Generate proposed updates

Validate and version

Update venture understanding

The update process should preserve previous versions, source references, and uncertainty.

An agent should not silently turn an inference into a fact.

Material contradictions should remain visible alongside the evidence and conclusions they affect. Agents may revise evidence-based assessments and qualify uncertain conclusions, while continuing work whose rationale remains sound. They must not silently rewrite accepted strategic decisions.

## 4. Factory knowledge versus venture knowledge

We selected venture-owned knowledge with explicit sharing.

Each venture remains the authoritative owner of its evidence and business history.

The factory may identify and promote reusable insights.

Examples include:

- Customer discovery methods.
- Reusable technical components.
- Lessons from failed experiments.
- Market observations that may apply to another venture.
- Improved planning and evaluation practices.

Shared insights should retain their original source and context.

Knowledge from Venture A does not automatically become established truth for Venture B.

This creates two learning loops:

Within-venture learning: Is this particular business becoming more viable?

Across-venture learning: Is the factory becoming better at discovering, validating, and building businesses?

# Part III — Planning intelligence

## 5. Separate factory planning and venture planning

We agreed that planning should occur independently at both levels.

The two processes have different responsibilities.

Venture assessments

Evaluate current opportunities, constraints, and progress

Factory planning

Order ventures and determine resource precedence

Venture planning

Select and order work within each venture

Execution scheduling

Use available provider capacity for authorized work

### 5.1 Factory planning

Factory planning determines the relative importance of ventures.

It asks:

- Which venture deserves attention?
- Which ventures should remain active?
- Which should be paused or archived?
- Which have made meaningful progress?
- Which opportunities warrant further investigation?
- What reusable capabilities could benefit several ventures?

Its main output is venture ordering and resource precedence.

We explicitly decided not to introduce numerical return probabilities, expected-value optimization, or detailed cost modeling at this stage.

### 5.2 Venture planning

Each venture independently evaluates its own knowledge, objectives, constraints, and unfinished work.

Its output is an ordered set of useful commitments.

It does not decide how many tokens an agent should use or which provider should execute a task.

### 5.3 Planning cadence

Our proposed initial defaults were:

| Process                   | Initial cadence                                 |
| ------------------------- | ----------------------------------------------- |
| Factory portfolio review  | Approximately every four weeks                  |
| Active venture planning   | Weekly                                          |
| Paused venture assessment | On demand or periodically                       |
| Archived venture          | No automatic planning                           |
| Work execution            | As authorized work and provider capacity permit |

These cadences remain configurable and are not established optimal values.

A review cadence is not an execution deadline. A reasonably scoped set of authorized commitments may finish sooner or take longer than a week as execution capacity and implementation needs become clear.

Scheduled reviews assess unfinished commitments without automatically replacing them or adding another batch. Continue justified work, revise work whose rationale changed, and add commitments deliberately rather than accumulating a new weekly backlog.

Material new evidence, invalidated assumptions, or urgent operational problems may trigger reassessment between scheduled reviews. Affected work should be suspended when its justification or authorization no longer holds.

## 6. How a planning cycle works

We proposed six stages.

1. Capture state

   Assemble a consistent snapshot of the venture's objectives, hypotheses, evidence, decisions, existing work, assets, and relevant source versions.
2. Evaluate prior progress

   Determine what was completed, what failed, what was learned, and what remains unresolved.

   Reconsider unfinished work rather than automatically carrying everything forward.
3. Identify the important constraints

   Determine which problems or uncertainties are currently preventing meaningful progress.
4. Generate and evaluate candidate actions

   Consider alternative actions, their purpose, dependencies, consequences, and relevance to the venture's objectives.
5. Select and authorize commitments

   Choose an ordered set of work items. Validate permissions, scope, dependencies, and necessary human approvals.
6. Commit the plan

   Persist the approved plan revision and make eligible work available to the execution scheduler.

The planning cycle should operate from a reproducible snapshot rather than an unversioned, continuously changing context.

A new planning cycle may continue an existing plan unchanged if no material change is justified.

### 6.1 Commitment scope and review gates

Planning selects a coherent, reasonably scoped set of commitments. It does not need to forecast the execution effort or impose a human-style delivery duration.

Exploration commitments should identify:

- The question being investigated and its relationship to the desired outcome.
- The authorized scope of investigation.
- Expected evidence or deliverables and acceptance criteria.
- The findings or scope limits that require founder review before further investment.

Completion, a decisive finding, or exhausting the authorized scope triggers the agreed review. If execution finishes early, the result is parked for review immediately. Agents should not invent further work or expand scope while waiting.

An inconclusive investigation is a valid completed outcome when the agreed investigation was performed and verified. Its report should explain what remains unknown and recommend a next step. Additional investigation requires existing authorization or a new decision.

### 6.2 Delegated planning and execution feedback

The founder approves objectives and operating boundaries. Within that delegation, the system may select and revise routine work and commit plan revisions without requiring founder approval for every cycle. Strategic changes and actions outside those boundaries require appropriate authorization.

Execution owns the implementation steps needed to satisfy an authorized commitment. Material changes to scope, desired outcomes, or external commitments return to planning and, where required, founder review.

Execution timing and resource availability provide feedback to planning. Slow progress should prompt assessment of scope, approach, and capacity rather than automatically terminating otherwise authorized work. Resource increases remain founder decisions unless already delegated.

## 7. How the planner chooses the next action

This was one of our deeper research topics.

We agreed that the planner should not merely decompose objectives into implementation tasks.

It should first understand what problem or uncertainty currently limits the venture.

The proposed decision process is:

Desired business outcome

Current constraint or uncertainty

Candidate actions

Reason about relative importance

Ordered work commitments

### 7.1 Sources of action value

We identified four ways actions can be useful.

| Type            | Purpose                                 | Example                                   |
| --------------- | --------------------------------------- | ----------------------------------------- |
| Information     | Reduce uncertainty affecting a decision | Interview prospective customers           |
| Execution       | Deliver a desired capability or outcome | Fix a parser blocking customer use        |
| Option creation | Enable a valuable future possibility    | Build a lightweight integration prototype |
| Risk reduction  | Protect existing value or avoid failure | Resolve a data-integrity issue            |

These are reasoning lenses rather than numerical scoring categories.

### 7.2 Decision problems

We proposed introducing a Decision Problem as a durable object.

A decision problem connects:

- The decision question.
- Objectives.
- Relevant hypotheses and evidence.
- Current constraints.
- Candidate actions.
- The eventual resolution and its rationale.

For example:

Decision problem: What should be done next to determine whether the finance product deserves further investment?

Candidate actions might be customer interviews, a demonstration prototype, competitive research, or additional product development.

The planner compares their usefulness in context.

### 7.3 Qualitative prioritization

We explicitly simplified the earlier decision-theory approach.

For now, the planner should produce:

- A clear ordering.
- Reasons for that ordering.
- Dependencies.
- Expected outcomes.
- Acceptance criteria.
- Conditions for reconsideration.

We are not requiring probability estimates, financial forecasts, token estimates, or a universal task-scoring formula.

The ordering should be explainable, not an unexplained LLM-generated number.

### 7.4 Founder authority

The planning intelligence may challenge a venture's thesis, identify conflicting evidence, or recommend changing objectives.

However, it should not unilaterally redefine the venture's fundamental economic purpose.

Consequential strategic changes remain founder decisions.

# Part IV — Work management

## 8. Work is a durable, first-class object

We distinguished between work and execution.

A work item represents something the venture wants accomplished.

A work run represents one attempt to accomplish that work.

One work item may have multiple runs, retries, or execution strategies.

This prevents the business objective from becoming tied to a particular agent, model, or failed execution attempt.

### 8.1 Where work comes from

We identified five main origins:

| Origin                 | Example                                         |
| ---------------------- | ----------------------------------------------- |
| Objective              | Prepare a customer onboarding experiment        |
| Hypothesis             | Test whether customers accept statement uploads |
| Decision               | Implement the selected onboarding approach      |
| Observation or event   | Investigate an unexpected parsing failure       |
| Maintenance obligation | Resolve a production security issue             |

Not every observation should automatically become a task.

The planning system evaluates whether action is warranted.

### 8.2 Proposed work lifecycle

Proposed

Ready

Running

In Review

Completed

Blocked

Other terminal states include cancelled or superseded. This is a state vocabulary, not a complete transition diagram.

The implementation should enforce permitted state transitions.

A task becoming `completed` should mean its acceptance criteria have been satisfied, not merely that an agent process exited successfully.

Routine work may be accepted automatically when suitable verification satisfies its agreed criteria. Verified completion may release already authorized dependencies, but cannot grant permission to cross a founder review gate. Unsupported agent claims remain unverified.

### 8.3 Work item contents

A work item should contain, at minimum:

```
type WorkItem = {
  id: string;
  ventureId: string;

  title: string;
  desiredOutcome: string;
  acceptanceCriteria: string[];

  status: WorkStatus;

  dependencies: string[];
  authorizationPolicyId: string;
};
```

Priority ordering should live in the versioned plan or queue entries, rather than necessarily being a permanent intrinsic property of the work item.

This allows priorities to change between planning cycles without rewriting the work's identity or history.

### 8.4 Relationships

Work can be linked to several objectives, hypotheses, decisions, and artifacts.

We agreed not to force a single origin relationship in the final data model.

Candidate relationship types include:

`derived_from`, `supports`, `challenges`, `implements`, `depends_on`, `produced`, `supersedes`, and `affects`.

The conceptual structure is a graph, but we do not need a graph database initially.

Ordinary Postgres relationship tables should be sufficient.

## 9. Work authorization

We separated three operations:

1. Work is proposed.
2. Work is authorized.
3. Work is executed.

Agents can propose activities without automatically receiving permission to perform them.

Standing authorization policies can permit low-risk work.

Examples include public research, isolated code modifications, test execution, and preparation of internal documents.

Consequential actions should require explicit approval, including external customer contact, significant production changes, unauthorized spending, or sensitive data transfers.

Authorization should be enforced by the execution system, not merely described in agent prompts.

Execution duration does not expand permission. Spending money, adding paid capacity, and making external commitments require standing permission or explicit approval regardless of how long authorized work takes. Founder silence never counts as approval.

## 10. Work dependencies and eligibility

Priority and eligibility are separate concepts.

Priority expresses importance.

Eligibility determines whether work can execute now.

A high-priority item may be blocked by a dependency, an approval, missing information, or incompatible execution capacity.

The scheduler can then proceed to the next eligible item.

Example:

| Order | Work                         | Eligibility               |
| ----- | ---------------------------- | ------------------------- |
| 1     | Run customer usability study | Blocked: requires founder |
| 2     | Fix parsing failures         | Ready                     |
| 3     | Prepare interview materials  | Ready                     |
| 4     | Improve dashboard styling    | Ready                     |

The scheduler should execute item 2 rather than wait indefinitely for item 1.

However, priorities shouldn't be permanently rearranged simply because a higher-priority item is blocked.

An unanswered founder decision blocks only the work that depends on it. Other useful authorized work may continue. When no justified eligible work remains, the system should become idle rather than create marginal work merely to consume capacity.

# Part V — Execution infrastructure

## 11. LLM subscription capacity as the operational resource

One of our most recent decisions was to simplify resource management.

You expect to use one or more LLM provider subscriptions, potentially with usage allowances that renew approximately every five hours.

We agreed that:

The planning system should not manage tokens, subscription windows, or detailed execution costs.

That responsibility belongs to the execution layer.

The execution system should consume available provider capacity while prioritizing the most important eligible work.

### 11.1 Provider model

Each provider or subscription may have:

- Available models.
- Supported capabilities.
- Current capacity status.
- Known usage restrictions.
- Next known reset or replenishment time.
- Maximum concurrency, where applicable.

Some services may expose precise remaining usage; others may expose only limit or reset signals.

The system should not assume every provider supplies accurate token counts or exact reset information.

It must also respect the provider's permitted automation and usage rules.

### 11.2 Global scheduler

The factory owns the global execution scheduler.

It receives the ordering of ventures from factory planning and the ordering of tasks from venture planning.

The scheduler then selects the highest-priority eligible work that can run with the available provider capacity.

Venture A

Work: A1 → A2 → A3

Venture B

Work: B1 → B2 → B3

Factory scheduler

Venture precedence · Work priority · Dependencies · Eligibility

Provider A

Capacity window

Provider B

Capacity window

### 11.3 Initial scheduling strategy

Our initial preference was strict priority with eligibility-aware fallback.

The scheduler should:

1. Select the highest-priority eligible work.
2. Choose a compatible provider or model.
3. Execute within available capacity.
4. Preserve progress when execution is interrupted.
5. Resume unfinished work when capacity returns.
6. Proceed to lower-priority work when higher-priority work cannot currently advance.

We identified starvation as a possible concern.

If the highest-priority venture constantly creates new tasks, lower-priority ventures might receive no execution capacity.

We haven't decided whether to introduce reserved capacity, fairness policies, or exploration quotas.

Those remain future scheduling choices.

### 11.4 Long-running work

A complex task may span several subscription windows.

The execution layer should support:

- Durable checkpoints.
- Safe interruption.
- Resumption without unnecessary repetition.
- Idempotent actions where possible.
- Recovery from partial failures.
- Reconciliation with external systems.
- Verification before work acceptance.

We have not yet designed the detailed resumable execution protocol.

# Part VI — Assets and storage

## 12. The venture database should not store everything

We agreed on a centralized registry with decentralized ownership of underlying assets.

The venture database records what exists, what it means, where it is located, and how it relates to the venture.

It should not try to replace every external system.

### 12.1 Storage responsibilities

| State or asset                            | Proposed authoritative system         |
| ----------------------------------------- | ------------------------------------- |
| Ventures and organizational state         | Postgres                              |
| Objectives, hypotheses, evidence metadata | Postgres                              |
| Decisions and work items                  | Postgres                              |
| Planning cycles and revisions             | Postgres                              |
| Work-run state and checkpoints            | Durable execution store               |
| Source code                               | Git                                   |
| Documents and generated files             | Git or object storage                 |
| Research source materials                 | Object storage or original source     |
| Production application data               | Venture-specific application database |
| Deployment state                          | Hosting/deployment platform           |
| Runtime logs and traces                   | Observability infrastructure          |

The factory maintains references and synchronized observations where needed.

### 12.2 Asset registry

Each venture has an asset registry.

An asset might represent:

- A Git repository.
- A website.
- A production service.
- A database.
- A domain.
- A research collection.
- A document.
- A dataset.
- An externally managed integration.

An artifact represents a specific output or version of an asset.

For example:

```
Asset:
  statement-parser repository

Artifact:
  commit a8c91f2

Produced by:
  work item W-208

Authorized by:
  planning cycle P-012

Related to:
  product capability C-014
  decision D-031
```

The registry lets the knowledge system connect business rationale to actual implementation.

### 12.3 Source-of-truth principle

The factory should distinguish authoritative records from derived representations.

For example:

- Git is authoritative for source code.
- The product database is authoritative for product data.
- Recorded interview materials are authoritative for what participants said.
- The venture knowledge model is authoritative for the venture's documented assessments and decisions.

An AI-generated architecture summary is not more authoritative than the code it describes.

If the underlying source changes, the summary may need to be updated or marked stale.

## 13. Events and state evolution

We proposed a lightweight event-history approach rather than full event sourcing initially.

Important transitions generate durable events.

Examples:

```
venture_created
objective_created
hypothesis_added
evidence_recorded
decision_approved

planning_started
plan_proposed
plan_approved

work_authorized
run_started
run_interrupted
artifact_created
verification_completed
work_accepted

view_updated
venture_archived
```

We separated three forms of state:

| State category | Meaning                                                    |
| -------------- | ---------------------------------------------------------- |
| Business state | The venture's current knowledge, decisions, and objectives |
| Work state     | Tasks, runs, dependencies, approvals, and checkpoints      |
| External state | Actual repositories, deployments, documents, and services  |

A process failure should not cause these states to become permanently inconsistent.

For example, an agent may successfully push a commit before the worker crashes.

The system should detect that outcome rather than blindly repeat the action.

### Proposed implementation

Start with:

- Normal relational tables for current state.
- An append-only event history for meaningful changes.
- Versioned records and immutable artifact references.
- Derived knowledge views.
- Reconciliation processes for external state.

Full event sourcing can be considered later if demonstrated requirements justify it.

# Part VII — The founder interface

## 14. The human-attention constraint

A foundational requirement throughout our discussion was that you may have only one or two hours a day, often when mentally fatigued.

The factory should not generate more review work than you can reasonably absorb.

We therefore agreed that the interface should be organized around meaningful changes and necessary decisions, not raw agent activity.

### 14.1 Progressive understanding

Each important outcome should be understandable at four depths.

| Level       | Question            | Information shown                      |
| ----------- | ------------------- | -------------------------------------- |
| Outcome     | What happened?      | Concise result and verification status |
| Implication | Why does it matter? | Effect on the venture                  |
| Explanation | How did it happen?  | Major decisions, components, risks     |
| Inspection  | Can I verify it?    | Source artifacts, tests, diffs, logs   |

Raw details remain available, but aren't the default presentation.

### 14.2 Founder briefing

An illustrative briefing might be:

## Factory briefing

Illustrative

# 2

Active ventures

# 5

Verified results

# 1

Decision needed

What changed

Venture A completed its authorized parsing improvements.

Venture B completed an initial competitor analysis.

Your decision

Should Venture B receive additional investigation priority, or should execution capacity remain focused on Venture A?

Fictional example. No real work, review, or approval has occurred.

### 14.3 Human authority

Your attention should primarily go toward:

- Choosing business direction.
- Evaluating evidence.
- Resolving important trade-offs.
- Approving consequential changes.
- Interacting with customers.
- Examining unexpected results.

Routine research, bounded code changes, tests, artifact preparation, and status maintenance should require minimal intervention.

### 14.4 Throughput feedback

The factory should expose stalled progress, its apparent cause, and a recommended intervention. Distinguish waiting for founder review, unavailable execution capacity, repeated failed attempts, external dependencies, and scope discovered during implementation.

Present observable progress and blockers without treating uncertain completion forecasts as reliable. Recommend whether to wait, narrow scope, change approach, or increase capacity so the founder can address the actual constraint.

# Part VIII — How the system operates together

## 15. Complete lifecycle example

Consider a hypothetical financial-analysis venture.

1. A venture is created.

   It starts with a thesis that consumers may want financial insights without connecting bank accounts. It requires no repository or complex initial structure.
2. The venture assessment identifies uncertainty.

   The system identifies willingness to upload statements as a critical unresolved hypothesis.
3. The factory allocates priority.

   It decides this venture deserves investigation ahead of other active candidates.
4. Venture planning selects work.

   The planner prioritizes a lightweight demonstration and a customer-test protocol over additional dashboard features.
5. The plan is authorized.

   Safe preparatory work is approved. Real customer outreach remains subject to your approval.
6. Execution begins.

   The scheduler uses available LLM subscription capacity to run the highest-priority eligible tasks.
7. Agents create artifacts.

   Code is committed to Git. Research documents and testing materials are stored appropriately. The asset registry records their versions and relationships.
8. Verification occurs.

   Tests validate technical behaviour. Reports preserve original source references. Unverified claims remain explicitly uncertain.
9. Knowledge is updated.

   Product views reflect verified capabilities. Hypotheses receive new evidence when actual customer observations occur.
10. You receive a briefing.

    The system presents relevant outcomes, unresolved uncertainties, and any necessary founder decisions.
11. The next planning cycle reassesses the venture.

    It determines whether to continue, change direction, request more evidence, or recommend pausing the venture.

The central feedback loop is:

Knowledge → Planning → Authorized work → Execution → Verification → Evidence → Updated knowledge.

At the factory level, venture assessments feed a second loop:

Portfolio knowledge → Venture ordering → Resource allocation → Venture outcomes → Updated portfolio knowledge.

# Part IX — Proposed implementation structure

## 16. Technical stack

Based on the technologies we've discussed, this was the initial implementation direction.

| Component         | Proposed technology                                       |
| ----------------- | --------------------------------------------------------- |
| Database          | Postgres / Supabase                                       |
| Backend APIs      | FastAPI                                                   |
| Founder interface | Next.js                                                   |
| Execution workers | Python                                                    |
| AI agents         | Pluggable harnesses and providers                         |
| Source control    | Git                                                       |
| Artifacts         | Git and object storage                                    |
| History           | Append-only Postgres events                               |
| Planning          | Scheduled durable workflows                               |
| Search            | Postgres full-text initially; semantic search when useful |
| Observability     | Execution logs, traces, verification results              |

This is a proposed stack, not a finalized technology decision.

### 16.1 Logical modules

Factory Core

Ventures · Portfolio priorities · Shared knowledge · Policies

Venture Knowledge

Theses · Objectives · Hypotheses · Evidence · Decisions · Views

Planning

Schedules · Assessments · Decision problems · Plan revisions

Work Management

Work items · Dependencies · Approvals · Status

Execution

Runs · Workers · Provider capacity · Checkpoints · Verification

Assets & History

Asset registry · Artifact versions · Events · Provenance

### 16.2 Logical data model

```
Factory
├── ventures
├── portfolio_reviews
├── venture_priorities
├── shared_knowledge
├── provider_connections
└── authorization_policies

Venture Knowledge
├── venture_theses
├── objectives
├── hypotheses
├── evidence
├── decisions
├── decision_problems
├── knowledge_links
└── knowledge_views

Planning
├── planning_schedules
├── planning_cycles
├── venture_assessments
├── plan_revisions
└── plan_work_items

Work
├── work_items
├── work_dependencies
├── approvals
├── work_runs
└── verification_results

Assets
├── assets
├── artifact_versions
└── artifact_links

History
├── events
└── view_versions
```

This is a logical organization. We haven't settled exact physical tables, indexes, constraints, or schemas.

Some concepts may be combined during implementation.

The design should avoid forcing every ephemeral venture to instantiate unnecessary records.

# Part X — Decisions, proposals, and unresolved questions

## 17. What we've decided

These are the strongest architectural agreements so far.

One permanent umbrella factory supporting many ventures

Ideas are ventures, not separate entity types

Ventures own their knowledge, with explicit sharing

Knowledge and decisions are independent of agent implementations

Factory and venture planning are separate

Scheduled planning is the preferred approach

Planning produces an explained ordering of work

Execution independently manages LLM subscription capacity

Work and execution runs are different objects

Important assets remain in their appropriate authoritative systems

Founder attention is treated as a scarce resource


First release proves the complete loop with one founder-supplied venture

Progress is evaluated against explicit outcomes and observable criteria

Planning cadence is separate from execution duration

Routine planning and verified work acceptance operate within delegated authority

Exploration scope and review gates bound further investment

Material changes trigger reassessment; unfinished work is reviewed without automatic backlog growth

Throughput constraints inform founder decisions about scope, approach, and resources

Founder silence grants no approval; idle capacity is acceptable when no justified work is eligible

## 18. What remains a proposal rather than a firm decision

Some implementation choices have been suggested but not explicitly finalized.

| Proposal                            | Current status                        |
| ----------------------------------- | ------------------------------------- |
| Weekly venture planning             | Suggested default                     |
| Monthly factory review              | Suggested default                     |
| One central Postgres database       | Suggested initial architecture        |
| Append-only event history           | Suggested approach                    |
| Strict-priority execution           | Preferred initial scheduler           |
| Decision Problem as its own entity  | Proposed                              |
| Structured evolving knowledge views | Agreed concept; detailed design open  |
| Specific agent role definitions     | Not designed                          |
| Full work state machine             | Not finalized                         |
| Execution checkpoint protocol       | Not designed                          |
| Knowledge promotion rules           | Not designed                          |
| Automated planning evaluation       | Concept explored; implementation open |

## 19. Questions we still need to resolve

I'd group the unresolved work into six areas.

A. Knowledge model and retrieval

How should the system represent knowledge relationships, select relevant context for agents, evaluate contradictions, and maintain evolving views without allowing inaccuracies to compound?

B. Planning intelligence

What precise inputs, intermediate representations, agent roles, evaluation steps, and output contracts should each planning cycle use?

C. Priority management

How does the factory compare ventures? How do individual ventures order work? How do we reconcile new plans with unfinished work and prevent low-priority ventures from starving?

D. Execution orchestration

How do agents execute across providers, five-hour subscription windows, worker failures, long-running tasks, code branches, and checkpoints?

E. Verification and authority

How should different types of work be verified? How are authorization boundaries enforced? What requires founder approval, and how does the system prevent misleading AI conclusions from becoming institutional knowledge?

F. Founder experience

How should the system present business understanding, evolving product views, results, exceptions, and decisions so you can remain in control with minimal cognitive effort?

# Part XI — Research foundation

## 20. Literature informing the design

These are the major sources we've discussed, grouped by what they contribute.

| Reference                                                                                                                             | Main contribution to our design                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Walsh & Ungson (1991), Organizational Memory](https://doi.org/10.5465/amr.1991.4278992?utm_source=chatgpt.com)                       | Organizational knowledge should be retained and retrievable beyond individual actors |
| [March (1991), Exploration and Exploitation](https://doi.org/10.1287/orsc.2.1.71?utm_source=chatgpt.com)                              | Balance discovering opportunities with executing established directions              |
| [Nickerson & Zenger (2004), Problem-Solving Perspective](https://doi.org/10.1287/orsc.1040.0093?utm_source=chatgpt.com)               | Organize action around important problems rather than arbitrary activities           |
| [Kerr, Nanda & Rhodes-Kropf (2014), Entrepreneurship as Experimentation](https://doi.org/10.1257/jep.28.3.25?utm_source=chatgpt.com)  | Manage entrepreneurial uncertainty through experiments                               |
| [McGrath (1999), Real Options](https://doi.org/10.5465/amr.1999.1580438?utm_source=chatgpt.com)                                       | Make staged commitments and preserve the ability to abandon unsuccessful directions  |
| [Sarasvathy (2001), Effectuation](https://doi.org/10.5465/AMR.2001.4378020?utm_source=chatgpt.com)                                    | Work from available means, affordable commitments, and stakeholder relationships     |
| [Feldman & Pentland (2003), Organizational Routines](https://doi.org/10.2307/3556620?utm_source=chatgpt.com)                          | Routines can improve and evolve through repeated performance                         |
| [Bainbridge (1983), Ironies of Automation](https://www.sciencedirect.com/science/article/pii/0005109883900468?utm_source=chatgpt.com) | Automation can increase the difficulty of remaining human oversight                  |
| [Endsley (1995), Situation Awareness](https://doi.org/10.1518/001872095779049543?utm_source=chatgpt.com)                              | Maintain awareness of what exists, what it means, and what may happen next           |
| [Amershi et al. (2019), Human-AI Interaction](https://doi.org/10.1145/3290605.3300233?utm_source=chatgpt.com)                         | Make AI systems understandable, controllable, and correctable                        |
| [Fowler, Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html?utm_source=chatgpt.com)                                   | Preserve meaningful state changes and support reconstruction                         |
| [DORA (2025), AI-Assisted Software Development](https://dora.dev/research/2025/dora-report/?utm_source=chatgpt.com)                   | Strong engineering practices remain important as AI increases production capacity    |

These references provide foundations and analogies. They do not collectively prove that this exact AI factory design will succeed commercially.

We will need to validate the architecture through actual use.

## 21. The complete design in one diagram

Founder

Economic intent · Judgment · Strategic decisions

Factory

Portfolio planning · Venture priority · Shared intelligence

Venture A

Own knowledge

Planning cycle

Ordered work

Venture B

Own knowledge

Planning cycle

Ordered work

Shared Work Scheduler

Priority · Eligibility · Dependencies · Provider capacity

Agent execution and verification

Research · Code · Experiments · Documents · Tests

Persistent assets and outcomes

Git · Object storage · Services · Evidence · Events

Verified outcomes update venture knowledge and inform subsequent planning.

## 22. The central philosophy

I think the most important outcome of our discussions is that we've separated three things that are frequently conflated in autonomous-agent systems:

Intelligence: Understanding the venture, identifying the problems worth solving, and deciding what should be done.

Execution: Using AI and available resources to perform authorized work.

Organizational memory: Preserving what was learned, why decisions were made, and what actually exists.

That separation is what allows the factory to become more capable over time without becoming increasingly difficult for you to understand.

It also gives you a way to change the execution technology as models, subscriptions, and harnesses improve, while retaining the valuable organizational knowledge accumulated through your business attempts.

Most importantly, it establishes a system that is explicitly designed around your real constraint: limited human attention.

The long-term aspiration is not a factory that endlessly produces software.

It is a persistent entrepreneurial organization that gets progressively better at discovering, validating, creating, and growing valuable businesses—with you directing it rather than continuously operating it.