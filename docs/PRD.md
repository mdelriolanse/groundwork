# Plant Operations Workspace PRD

## Problem Statement

The current application proves the core technical path—vibration detection, PMMCP diagnosis, local agent synthesis, cited work-order generation, Three.js asset focus, and OpenShell containment—but presents it as a single demo board with an Acaysia-derived editorial motif. That interface does not scale to a technician responsible for machinery across a large factory, does not establish incidents as durable operational cases, and does not give PMMCP/L1/L2 activity a coherent place in the product.

A technician needs an operations workspace that answers three questions immediately:

1. What needs attention now?
2. What should I do next?
3. Why should I trust this recommendation?

The interface must keep the existing machinery-scoped assistant, but redesign it as a contextual utility rather than a generic prompt box. It must also preserve the application's winning local-first proof: all inference runs on the GB10, every recommendation links to real evidence, and OpenShell containment remains visible and inspectable.

## Solution

Build a technician-first, desktop plant-operations workspace using the interaction grammar of Palantir Workshop Inbox, Object View, Object Table, and AIP Assist.

The default Incidents workspace presents a filterable object inbox for the technician's assigned area, ordered by operational priority and age. Selecting an incident opens a concise Object View preview; opening it fully reveals diagnosis, action, evidence, PMMCP/L1/L2 processing, current work order, and case history. A shared right utility rail switches between Object Preview, Maintenance Assist, and Evidence Viewer without stacking multiple sidebars.

Four top-level workspaces form the product:

1. **Incidents** — active triage and resolved history.
2. **Floor** — the existing 3D factory scene as spatial navigation.
3. **Assets** — searchable hierarchy and Asset 360 views.
4. **Intelligence** — cross-site processing, evidence, model/tool health, and containment.

The manufacturing and furniture datasets remain interchangeable scene fixtures. Both map geometry into one stable plant ontology: Site → Area → Line → Cell → Asset → Component. The operational domain does not change with the 3D dataset.

The visual system is enterprise-light, flat, dense, restrained, and accessible. It replaces the Acaysia ink/cream/full-bleed motif. Production integration begins only after five disconnected static screens are reviewed and approved.

## User Stories

1. As a maintenance technician, I want the application to open on active incidents in my assigned area, so that I can begin triage immediately.
2. As a maintenance technician, I want to switch from my area to the whole site, so that I can help elsewhere when needed.
3. As a maintenance technician, I want incidents ordered by operational priority and age, so that the most consequential work appears first.
4. As a maintenance technician, I want critical, unacknowledged, in-progress, and aging counts above the inbox, so that I can assess workload at a glance.
5. As a maintenance technician, I want a metric card to filter the incident inbox, so that summary and detail remain connected.
6. As a maintenance technician, I want to filter incidents by priority, status, area, line, asset class, AI state, and time, so that I can isolate relevant cases.
7. As a maintenance technician, I want filter counts visible, so that I understand the effect of each filter before applying it.
8. As a maintenance technician, I want active and resolved incidents to remain views of one registry, so that history is not siloed.
9. As a maintenance technician, I want inbox filters and scroll position preserved after opening a case, so that I can continue triage without rebuilding context.
10. As a maintenance technician, I want selecting an incident to open a compact preview, so that I can inspect it without leaving the inbox.
11. As a maintenance technician, I want an explicit action to open the full incident, so that row selection and navigation are not confused.
12. As a maintenance technician, I want each incident to show its asset and exact plant location, so that I know where to go.
13. As a maintenance technician, I want operational priority separate from vibration severity, so that machine risk is not misrepresented.
14. As a maintenance technician, I want case status separate from AI run status, so that a failed reanalysis does not erase repair progress.
15. As a maintenance technician, I want repeated detections for the same active fault grouped into one incident, so that the inbox does not flood.
16. As a maintenance technician, I want first-seen, last-seen, and detection count displayed, so that I can distinguish persistent drift from a one-off signal.
17. As a maintenance technician, I want a recurrence after resolution to create a linked new incident, so that separate repair episodes remain auditable.
18. As a maintenance technician, I want recurrence links in both current and prior incidents, so that I can review repeated failures.
19. As a maintenance technician, I want to acknowledge a new incident, so that the team knows it has been seen.
20. As a maintenance technician, I want to start work on an acknowledged incident, so that active repair is visible.
21. As a maintenance technician, I want to resolve an in-progress incident with a note, so that closure records what was done.
22. As a maintenance technician, I want invalid lifecycle transitions blocked with an explanation, so that case history remains valid.
23. As a maintenance technician, I want the incident header to expose only the next valid primary action, so that the workflow is unambiguous.
24. As a maintenance technician, I want the incident overview to answer what happened, what to do, and why to trust it, so that I can act without decoding agent internals.
25. As a maintenance technician, I want PMMCP findings and scope limitations shown together, so that deterministic output is not overclaimed.
26. As a maintenance technician, I want ISO context-only limitations visible wherever severity appears, so that benchtop and dataset claims remain honest.
27. As a maintenance technician, I want a compact sensor trend with units and exact values, so that I can inspect condition change.
28. As a maintenance technician, I want direct access to the exact signal window, so that I can verify the triggering observation.
29. As a maintenance technician, I want one current cited work order attached to the incident, so that recommended action is easy to find.
30. As a maintenance technician, I want work-order revisions preserved in case activity, so that changed recommendations remain auditable.
31. As a maintenance technician, I want every action and part recommendation linked to evidence, so that I can verify it before repair.
32. As a maintenance technician, I want manual citations to open at the exact page, so that I do not search a long document.
33. As a maintenance technician, I want history citations to open the exact CMMS row, so that prior repairs are traceable.
34. As a maintenance technician, I want evidence to open in a context-preserving utility rail, so that I do not lose the incident.
35. As a maintenance technician, I want a full-artifact option from the evidence rail, so that detailed inspection remains possible.
36. As a maintenance technician, I want a concise L1/L2 processing timeline, so that I can see how the recommendation was produced.
37. As a maintenance technician, I want each processing stage to show state, time, duration, and result, so that failures and latency are understandable.
38. As a maintenance technician, I want stage details expandable, so that normal operation stays simple while deeper inspection remains available.
39. As a maintenance technician, I want PMMCP tool calls, retrieved evidence, and citation validation visible on demand, so that the pipeline is auditable.
40. As a maintenance technician, I want raw event payloads hidden behind an advanced control, so that technical noise does not dominate the workflow.
41. As a maintenance technician, I want the machinery assistant available from any object workspace, so that help remains near the current task.
42. As a maintenance technician, I want the assistant to state its selected asset, component, fault, and incident, so that I know exactly what it is answering about.
43. As a maintenance technician, I want the assistant context to change only through an explicit selection, so that it never answers about the wrong machine.
44. As a maintenance technician, I want suggested questions before the first message, so that the supported scope is discoverable.
45. As a maintenance technician, I want assistant answers cited inline, so that guidance and proof remain adjacent.
46. As a maintenance technician, I want an out-of-scope response to explain supported questions, so that failure is recoverable.
47. As a maintenance technician, I want unsupported machinery to show an honest unavailable state, so that mocked assets do not produce invented guidance.
48. As a maintenance technician, I want my draft question retained when a request fails, so that I can retry without retyping.
49. As a maintenance technician, I want current processing stage shown while the assistant runs, so that progress is meaningful.
50. As a maintenance technician, I want duplicate submission disabled while an answer is running, so that I do not start redundant agent runs.
51. As a maintenance technician, I want to open the full assistant run in Intelligence, so that I can inspect technical detail without crowding the conversation.
52. As a maintenance technician, I want to collapse the utility rail, so that I can maximize table or 3D space.
53. As a maintenance technician, I want the utility rail to restore my prior mode after closing evidence, so that navigation remains predictable.
54. As a maintenance technician, I want the Floor workspace to highlight assets with active incidents, so that I can understand spatial context.
55. As a maintenance technician, I want floor markers to include text or icons as well as color, so that state remains accessible.
56. As a maintenance technician, I want selecting a 3D machine to select the corresponding operational asset, so that scene and records stay synchronized.
57. As a maintenance technician, I want an incident to focus its asset and component in 3D, so that I can locate the affected machinery.
58. As a maintenance technician, I want the Floor workspace to link back to the incident, so that 3D never becomes a dead-end view.
59. As a maintenance technician, I want operational records to work without a 3D binding, so that incomplete scene data does not hide real incidents.
60. As a maintenance technician, I want an Assets registry with hierarchy, condition, open incidents, and last scan, so that I can find equipment directly.
61. As a maintenance technician, I want an Asset 360 overview, so that current condition and maintenance context appear together.
62. As a maintenance technician, I want asset maintenance history and recurrence visible, so that repeated failures inform repair.
63. As a maintenance technician, I want manuals and signal sources organized by asset, so that evidence remains reusable outside one incident.
64. As a maintenance technician, I want asset activity shown chronologically, so that changes and prior work are auditable.
65. As a maintenance technician, I want to ask Maintenance Assist from an asset page, so that questions need not begin from an incident.
66. As a maintenance technician, I want unsupported asset questions blocked before submission, so that assistant scope is honest.
67. As a reliability lead, I want Intelligence to show running, failed, rejected, and evidence-complete runs, so that I can assess agent health.
68. As a reliability lead, I want L1 and L2 durations summarized separately, so that deterministic DSP and model synthesis performance are distinguishable.
69. As a reliability lead, I want a cross-site run inbox linked to incidents and assets, so that technical failures can be connected to operational impact.
70. As a reliability lead, I want model, PMMCP, Gateway, and OpenShell health shown independently, so that outages are diagnosable.
71. As a reliability lead, I want the last denied egress event visible, so that containment proof remains operational rather than theatrical.
72. As a reliability lead, I want a full run trace with stages, tools, evidence, errors, and timings, so that agent behavior is auditable.
73. As a reliability lead, I want prompts and raw payloads collapsed by default, so that sensitive or noisy details do not overwhelm the page.
74. As a judge, I want the interface to show work already completed in the background, so that the product reads as autonomous rather than conversational.
75. As a judge, I want local inference and containment visible in persistent chrome, so that local-first design is evident before the demo closer.
76. As a judge, I want every on-screen recommendation to lead to a real signal, manual page, or history row, so that claims are verifiable.
77. As a judge, I want the containment-denial event inspectable, so that the proof is not a fake UI state.
78. As a keyboard user, I want to navigate routes, filters, rows, actions, utility-rail modes, citations, and the composer without a mouse, so that the application is operable.
79. As a screen-reader user, I want route changes and utility-rail state announced correctly, so that context changes are understandable.
80. As a color-vision-deficient user, I want every status represented with text or iconography in addition to color, so that state is not lost.
81. As a technician, I want visible focus indicators and labeled form controls, so that dense screens remain usable.
82. As a technician, I want loading, empty, offline, unsupported, and failed states to explain recovery, so that the application never appears silently broken.
83. As a technician, I want the interface to avoid external fonts, analytics, images, and APIs, so that it remains valid inside the air-gapped deployment.
84. As a technician, I want the interface optimized for a 1440 × 900 desktop without accidental horizontal scroll, so that the demo and workstation experience are stable.
85. As a product reviewer, I want five disconnected static screens approved before integration, so that visual quality is decided before implementation constraints harden weak layouts.

## Implementation Decisions

### Product and interaction decisions

- Primary persona is a maintenance technician at one large site.
- Default workspace is the active Incidents inbox scoped to the technician's assigned area.
- Resolved history is a filter/view of the same incident registry, not a separate product silo.
- Top-level workspaces are Incidents, Floor, Assets, and Intelligence.
- The digital twin is a dedicated Floor workspace and a contextual deep link, not the home screen.
- Palantir Workshop Inbox, Object View, Object Table, and AIP Assist form the single reference grammar.
- The Acaysia ink/cream/full-bleed motif is superseded and must not remain an acceptance requirement.
- The visual system is enterprise-light, flat, restrained, and data-dense.
- A shared right utility rail has mutually exclusive Object Preview, Maintenance Assist, and Evidence Viewer modes.
- The interface targets desktop first at 1440 × 900, with an overlay rail below the minimum content width.

### Domain decisions

- Stable hierarchy is Site → Area → Line → Cell → Asset → Component.
- Dataset choice affects scene geometry and twin bindings only.
- Incident is a durable case, not a synonym for detection, analysis run, or work order.
- Incident lifecycle is New → Acknowledged → In progress → Resolved.
- Analysis-run lifecycle remains technically independent from incident lifecycle.
- Repeated active detections coalesce into one incident; recurrence after resolution creates a linked new incident.
- One current cited work order belongs to an incident in the first release.
- Operational priority, signal severity, incident status, and AI state are separate concepts.
- L1 means deterministic PMMCP screening.
- L2 means local-model evidence synthesis and work-order drafting.
- Diagnostic certainty is communicated through findings, evidence completeness, and limitations, not an uncalibrated percentage.

### Deep modules

1. **Incident Lifecycle**
   - Owns detection coalescing, valid status transitions, recurrence linking, current work-order association, and activity generation.
   - Exposes a small command/query interface independent of HTTP and DOM.
   - Prevents run failures from mutating technician workflow state.

2. **Operations Read Model**
   - Produces stable site, incident inbox, incident detail, asset registry, Asset 360, intelligence summary, and run-detail view models.
   - Centralizes ordering, filtering, counts, evidence completeness, and display-safe limitations.
   - Shields frontend components from database and agent-event shapes.

3. **Workspace Context**
   - Owns route, selected incident/asset/component, area scope, saved filters, and utility-rail mode.
   - Derives explicit assistant and twin context from selected operational objects.
   - Serializes shareable context to URLs and restores list position/filter state.

4. **Object Workspace**
   - Implements the reusable Workshop-style composition: module header, metric cards, prominent-term filters, object table, and Object Preview.
   - Powers both Incidents and Assets with configuration rather than duplicated layouts.
   - Keeps all row actions explicit and keyboard-accessible.

5. **Utility Rail**
   - Provides one container for Object Preview, Maintenance Assist, and Evidence Viewer.
   - Owns open/close/mode transitions, overlay behavior, focus management, and restoration.
   - Prevents panel stacking and inconsistent sidebars.

6. **Maintenance Assist Adapter**
   - Validates selected context, submits bounded questions, streams run state, renders citations, and exposes unsupported/offline/out-of-scope states.
   - Diagnosis and work orders stay RPP1/URjoint1. Assist on other monitored assets binds L1 process tags only.
   - Never trusts client-supplied context without server validation.

7. **Twin Bridge**
   - Maps asset/component identifiers to scene objects.
   - Synchronizes route selection, object selection, focus, part lighting, and frozen interaction state.
   - Treats missing geometry as a supported condition.

8. **Run Observatory**
   - Normalizes PMMCP, retrieval, model, persistence, and error events into stage summaries and expandable details.
   - Feeds incident timelines, assistant progress, and Intelligence without duplicating interpretation logic.

9. **Design System**
   - Owns semantic color, type, spacing, geometry, icon, focus, elevation, and motion tokens.
   - Prohibits external runtime assets and decorative patterns inconsistent with the Workshop reference.
   - Supplies accessible primitives for buttons, fields, tabs, statuses, tables, drawers, and empty/error states.

### API decisions

- Initial snapshots use REST; existing run events continue over SSE.
- APIs expose domain-oriented incident, asset, site, run, and evidence view models rather than the current monolithic board payload.
- Lifecycle mutations are action endpoints that enforce transitions server-side.
- Assistant questions include incident, asset, and component context; server cross-checks that context against configured scope.
- Existing artifact endpoints remain the source for exact manual pages, CMMS rows, and signal files.
- Freshness is displayed explicitly; polling must not be presented as realtime.

### Prototype and rollout decisions

- First deliverable is a disconnected static prototype with realistic fixed content, not production integration.
- Required prototype screens: Incident Inbox, Incident Detail with Assist open, Floor, Asset 360, and Intelligence with an expanded run.
- One visual review gate precedes API/database integration.
- First integrated vertical slice makes Incidents and Incident Detail deep; Floor is reused; Assets and Intelligence are functional but narrower.
- Unsupported controls are omitted instead of shown as nonfunctional decoration.

## Testing Decisions

### Test philosophy

- Test observable domain and user behavior, not implementation details or exact internal function structure.
- Every production behavior begins with a failing test.
- Do not test visual quality through brittle string checks for raw hex values or motif names.
- Use semantic selectors, roles, state transitions, URL outcomes, API contracts, and screenshot comparisons.
- Keep deterministic domain tests separate from browser, model, and Three.js integration tests.
- Never require live cloud services; the complete suite must run on the GB10 offline.

### Modules to test

1. **Incident Lifecycle**
   - Active detection coalescing.
   - Valid and invalid transitions.
   - Resolution-note requirement.
   - Linked recurrence after resolution.
   - Independent incident/run state.
   - Current work-order replacement and activity history.

2. **Operations Read Model**
   - Assigned-area defaults.
   - Active/resolved filtering.
   - Priority-then-age ordering.
   - Metric counts.
   - Separation of operational priority and signal severity.
   - Evidence completeness and limitations.

3. **Workspace Context**
   - Deep-link parsing and serialization.
   - Selected object propagation.
   - Filter and scroll restoration.
   - Explicit assistant context changes.
   - Utility-rail mode replacement rather than stacking.

4. **HTTP/SSE contracts**
   - Incident list/detail shapes.
   - Lifecycle action status codes and results.
   - Assistant context validation.
   - Unsupported-asset and out-of-scope behavior.
   - Run-event ordering and reconnection semantics.
   - Artifact citation resolution.

5. **Object Workspace and Utility Rail**
   - Keyboard selection/open behavior.
   - Filter application/reset.
   - Preview, assistant, and evidence mode transitions.
   - Overlay focus trap, Escape close, and focus restoration.
   - Empty/loading/error recovery.

6. **Maintenance Assist Adapter**
   - Context capsule accuracy.
   - Disabled unsupported state.
   - Duplicate-submit prevention.
   - Draft retention after failure.
   - Cited answer rendering.
   - Full-run deep link.

7. **Twin Bridge**
   - Asset/component mapping.
   - Bidirectional selection.
   - Incident-to-floor focus.
   - Missing-binding behavior.
   - Interaction freeze during a scoped run.

8. **Accessibility and visual regression**
   - Automated role/name/focus checks on all five screens.
   - No color-only state.
   - No horizontal overflow at target desktop widths.
   - Reduced-motion behavior.
   - Approved 1440 × 900 screenshot baselines for each prototype screen.

### Existing test prior art

- Current tests already exercise citation-gated work orders, one-open-work-order idempotency, retrieval/page resolution, Gateway tool-history extraction, bounded questions, and twin control exports.
- The current frontend motif test is obsolete because it asserts Acaysia implementation tokens rather than user-visible behavior. Replace it only when the approved static prototype establishes the new semantic and visual baselines.
- Existing replay verification remains valuable for the integrated vertical slice: detect, diagnose, retrieve, synthesize, persist, ask a bounded question, open exact evidence, and prove out-of-scope handling.

## Out of Scope

- Multi-site enterprise tenancy.
- Production planning, OEE, staffing, quality, throughput, and inventory management.
- Full CMMS replacement or external CMMS writeback.
- Technician assignment/reassignment and role-based authorization.
- Work-order approval chains.
- Mobile-first or rugged-tablet-first redesign.
- Generic assistant conversations.
- Assistant support for assets without configured evidence and agent scope.
- New DSP, vibration algorithms, fault classifiers, or ISO claims.
- Rebuilding PMMCP.
- Vision, ASR, TTS, or multimodal models.
- A second incident/work-order system for the alternate 3D dataset.
- Simultaneous stacked Object Preview, Assist, and Evidence sidebars.
- Pixel-copying Palantir branding or proprietary assets.
- Production UI integration before static visual approval.

## Further Notes

- The local-first requirement is part of the interface: persistent containment status, local model identity, independent service health, and inspectable deny logs are product features.
- “Not a chatbot” remains an invariant. The assistant supports the selected operational object; autonomous incidents and work orders remain primary.
- Diagnosis stays RPP1/URjoint1. Assist on other monitored assets binds that hop's L1 process/electrical tags and must say it is not diagnosed. Unmonitored stations stay unavailable.
- Palantir's reference patterns are particularly suitable because Workshop is object/ontology-first, Inbox is designed for triage/review/action, Object View supports panel and full representations, and AIP Assist is context-aware across the active application.
- The detailed visual tokens, page anatomy, assistant states, interaction contracts, API targets, and prototype acceptance checklist are maintained in the companion frontend product specification.
