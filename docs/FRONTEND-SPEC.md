# Frontend product specification

**Summary:** Technician-first, desktop plant-operations application modeled on Palantir Workshop Inbox, Object View, and AIP Assist patterns.

**Status:** Specification draft; production UI implementation blocked until visual mockups are approved.

## 1. Product frame

### Primary user

Maintenance technician working a shift inside one large factory.

### Ten-second job

See which incidents in the technician's assigned area need attention, understand why each was raised, and begin the correct repair workflow.

### Product promise

An always-on local maintenance engineer detects a developing fault, grounds a recommendation in plant evidence, and gives the technician a short path from incident to verified action.

### Explicit non-goals

- Not a general factory-management suite.
- Not an OEE, staffing, production-planning, or inventory dashboard.
- Not a generic chatbot.
- Not a 3D scene with controls attached.
- Not a raw agent-debugging console.
- Not a pixel-for-pixel Palantir clone.

## 2. Reference product

Use one coherent product grammar:

1. [Palantir Workshop Inbox](https://palantir.com/docs/foundry/workshop/example-applications/) for metric cards, prominent-term filters, object tables, saved views, triage, and action.
2. [Palantir Object View](https://palantir.com/docs/foundry/workshop/widgets-object-view/) for a selected object's full and panel representations.
3. [Palantir AIP Assist](https://palantir.com/docs/foundry/assist/overview/) for a context-aware utility sidebar.
4. [Palantir Workshop layout guidance](https://palantir.com/docs/foundry/workshop/application-design-best-practices/) for persistent headers, standardized sections, and contextual drawers.
5. [Palantir Object Table](https://palantir.com/docs/foundry/workshop/widgets-object-table/) for dense, filterable object-set presentation.

The application should feel like a purpose-built Workshop operations module: quiet chrome, dense object views, restrained color, explicit state, and contextual actions. Copy interaction structure, not Palantir trademarks, logos, proprietary icons, or exact styling.

## 3. Domain model

### Plant hierarchy

```text
Site
└── Area
    └── Line
        └── Cell
            └── Asset
                └── Component
```

Both candidate 3D datasets are scene fixtures. They map geometry to this stable operational hierarchy and do not change the application schema.

### Operational objects

#### Incident

Persistent technician-facing case from detection to resolution.

Required fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable human-readable identifier |
| `title` | Fault + affected component in plain language |
| `asset_id` | Affected asset |
| `component_id` | Affected component, when known |
| `area_id`, `line_id`, `cell_id` | Physical context |
| `priority` | Operational impact: critical, high, medium, low |
| `status` | new, acknowledged, in_progress, resolved |
| `first_seen`, `last_seen` | Detection range |
| `detection_count` | Number of coalesced detections |
| `impact` | Safety/production consequence, separate from signal severity |
| `diagnosis` | Current PMMCP-grounded finding |
| `limitations` | Scope disclosures, including ISO context-only |
| `current_work_order_id` | Zero or one current cited work order |
| `prior_incident_id` | Previous resolved occurrence, if recurrent |
| `assignee` | Display-only in first slice |

Rules:

- Repeated detections for the same asset and fault append to an active incident.
- A post-resolution recurrence creates a new incident linked to the prior incident.
- Operational priority and signal severity remain separate.
- No fabricated model-confidence percentage.

#### Detection

Immutable sensor observation attached to an incident.

Fields: `id`, `incident_id`, `asset_id`, `component_id`, `source`, `window`, `rpm`, `rms`, `fault`, `observed_at`.

#### Analysis run

Technical execution linked to an incident; it never owns the business lifecycle.

Fields: `id`, `incident_id`, `workflow`, `state`, `started_at`, `finished_at`, `error`, `stages[]`.

Stage vocabulary:

- **L1 — PMMCP screening:** deterministic signal analysis and fault classification.
- **L2 — evidence synthesis:** local LLM correlation across PMMCP output, manual passages, and CMMS history; drafts work order.
- **Persist:** validates citations and writes incident/work-order artifacts.

Run states: queued, running, completed, failed, rejected.

An L2 failure after technician acknowledgment leaves the incident `acknowledged` or `in_progress`; failure appears on the run.

#### Work order

One current cited draft per incident in the first release. Revisions replace the draft while preserving activity history.

#### Evidence

| Type | Required locator |
| --- | --- |
| Signal | CWRU/live source + exact window |
| Manual | Document + exact page |
| History | CMMS work-order row |
| Run | Run + stage + event |
| Containment | OpenShell policy/log event |

Every diagnosis, recommendation, and answer exposes its supporting evidence.

#### Twin binding

Optional mapping from `asset_id` and `component_id` to scene object names. Operational objects remain valid when no geometry exists.

## 4. Information architecture

### Top-level routes

| Route | Purpose |
| --- | --- |
| `/incidents` | Default active incident inbox; resolved history is a view of the same registry |
| `/incidents/:id` | Complete technician case |
| `/floor` | Spatial factory view with incident overlays |
| `/assets` | Process-tag board: 24 station cards of cited L1 process/electrical tags |
| `/assets/:id` | Asset 360 view |
| `/condition` | Vibration diagnosis dashboard: 6 motor tiles (RMS hop historian, PMMCP label, cite) |
| `/intelligence` | Cross-site AI execution, evidence, model/tool health, and containment |
| `/intelligence/runs/:id` | Full processing trace |

Deep links preserve selected site/area, filters, object, and utility-rail mode in URL state where useful.

### Persistent application shell

#### Left navigation — 208 px

- Product mark and site name.
- Incidents, Floor, Assets, Condition, Intelligence; icon plus text. Assets opens `#/assets` (the 24-card board), not an Asset 360.
- Active route has both contrast and a left indicator.
- Bottom: system state and settings/help, not destructive actions.

#### Global header — 48 px

- Breadcrumb or current module name.
- Site/area scope selector.
- Global search.
- Persistent `Local · Contained` status with text and icon.

#### Main content

Single vertical page scroll. Avoid nested scrolling except the object table and utility rail when viewport height requires it.

#### Right utility rail — 400 px default, user-resizable

One contextual mode at a time:

1. Object Preview.
2. Maintenance Assist.
3. Evidence Viewer.

Opening one mode replaces the current mode; modes never stack. Rail can collapse to a 44 px trigger strip. This prevents an unusable four-column desktop layout. Default width 400 px (L2 report left rail 480 px); either overlay rail is user-resizable, with width kept in localStorage, not the URL.

### Desktop target

Primary design viewport: 1440 × 900. Minimum supported desktop width: 1180 px. At narrower widths, utility rail overlays content instead of compressing the object table.

## 5. Page schemas

### 5.1 Incidents — Workshop Inbox composition

#### Module header

- Title: `Incidents`.
- Tabs: `Active`, `Resolved`.
- Scope: `My area` default; `Entire site` available.
- Saved-filter control.
- Last refresh and live-state indicator.

#### Action summary

Four compact metric cards:

1. Critical.
2. Unacknowledged.
3. In progress.
4. Aging beyond target.

Cards filter the table; selected state is explicit.

#### Prominent-term filter rail — 224 px

- Priority.
- Status.
- Area/line.
- Asset class.
- AI run state.
- Time range for resolved view.
- Clear all.

Show counts beside terms. Filters use visible labels and keyboard-operable controls.

#### Incident object table

Default columns:

1. Priority.
2. Incident/title.
3. Asset.
4. Area / line.
5. Case status.
6. AI state.
7. Last seen.
8. Age.

Default ordering: operational priority, then age. Signal severity never silently determines operational priority.

Interaction:

- Single click selects a row and opens Object Preview.
- Enter or explicit `Open incident` navigates to full detail.
- Table state persists when returning from detail.
- No hover-only actions.

#### Object Preview utility rail

- Incident ID, title, priority, status.
- Asset and physical location.
- One-sentence diagnosis.
- Evidence-completeness summary.
- Current recommended action.
- L1/L2 state rail.
- Primary action: `Open incident`.
- Secondary: `View on floor`, `Ask Maintenance Assist`.

### 5.2 Incident detail

#### Header

- Breadcrumb: Incidents / incident ID.
- Title, priority, status, recurrence indicator.
- Asset and exact location.
- First/last seen and detection count.
- One state-appropriate primary action:
  - New → Acknowledge.
  - Acknowledged → Start work.
  - In progress → Resolve.
  - Resolved → no mutation; link recurrence if present.

#### Overview

Three questions, in order:

1. **What happened?** PMMCP diagnosis and signal facts.
2. **What should I do?** Current cited work-order action and parts.
3. **Why trust it?** Evidence completeness, citations, limitations.

#### Processing timeline

Horizontal summary or compact vertical rail:

- Detection received.
- L1 PMMCP completed/failed.
- Manual and history retrieved.
- L2 synthesis completed/failed.
- Cited work order persisted.

Each stage shows state, duration, timestamp, and short result. Expansion reveals structured inputs, outputs, tool calls, citations, and recoverable error; raw event JSON remains an advanced action.

#### Condition panel

- Current RMS/RPM and units.
- Compact trend line with accessible text summary/table.
- Exact signal window link.
- Scope disclosure: ISO context-only where applicable.

#### Work-order panel

- Action.
- Required part.
- Priority.
- Citation list.
- Draft/revision timestamp.
- No unimplemented approval or CMMS-writeback controls.

#### Activity

Chronological case events: detections, state transitions, analysis runs, work-order revisions, technician resolution note, recurrence links.

#### Utility rail

Defaults to Object Preview summary. Maintenance Assist and Evidence Viewer are explicit neighboring modes.

### 5.3 Floor

- Full-bleed embedded Three.js scene (`web/twin/?view=plan|top`) inside standard application chrome. The iframe persists across re-renders; it is never reloaded on a replay hop.
- **Bird's-eye, not first-person.** Orthographic camera; isometric by default, top-down via a header toggle (`view=top` in the URL). Angle is locked: wheel zoom and drag/two-finger pan only — no orbit. Click still selects a station (drag does not). `Fit line` and the iso/top toggle reset the camera. The line is turned to run left→right and fitted to the viewport minus the overlay inset.
- **Every station** from `scene.json` is rendered at its real placement; the warehouse shell is omitted. Stations carry researched L1 process/electrical tags from `data/sensors/catalog.json` and are labelled `process` (or `ok`/`flag` for RPP1). Never invent a second diagnosed vibration fault.
- Geometry uses one neutral material. State is never colour-only: selection = footprint outline + label highlight; incident = red label with icon and text (`flag`); process-only = monitored label; true geometry-only gaps (if any) = muted `no sensor`.
- Labels, incident markers, cell tree, legend, and toggles are drawn by the parent app from `twin:layout` screen anchors, so they share one style system. Dense views drop colliding unmonitored labels; monitored, selected, flagged, and hovered labels are always placed.
- Left overlay: line → cell → station tree from `scene.json` `cells`, with flag counts; cells collapse except those holding a monitored or selected station.
- Tree rows select: URL (`asset=`), selected asset, Object Preview, assistant context. Clicking a machine or its label **opens its Asset 360** — the floor is the way into a machine's profile. Selecting a monitored non-hero station shows process tags and scopes Assist to those L1 tags (never a vibration diagnosis). Geometry-only stations stay `unsupported`.
- Focus frames the selected station's **cell** and dims the rest; nothing is hidden in plan view. No `asset=` in the route or `Fit line` frames the whole line.
- Selected unhealthy asset offers `Open incident`.
- Incident detail offers `View on floor`, focusing the same asset/component.
- Floor is a spatial navigation aid, not the source of operational truth.

### 5.4 Assets

#### Process-tag board (`/assets`)

24 station cards from `catalog.json` / `asset-map.json`. Each card shows cited L1 process/electrical tags (busy/idle, torque, vac, current). Honesty: synthetic cites, never diagnosed. The six vibration-bound motors may show a small `Open Condition` affordance — not a second diagnosis. Grain is station-level existing catalog tags only. Drill target is `/assets/:id`.

#### Registry

Palantir Object Table pattern is not the v1 board; v1 is the 24-card process-tag board above.

#### Asset detail / Asset 360

Tabs:

1. `Overview`: current condition, open incident, latest trend, exact location.
2. `Maintenance`: current/past work orders and recurrence history.
3. `Evidence`: manuals, signal sources, and cited history.
4. `Activity`: chronological audit trail.

Header actions: `Close 3D render` (open by default), `View on floor`, `Ask Maintenance Assist`. No fake edit or CMMS actions.

#### 3D render (Asset 360)

- Open by default on every `/assets/:id`. `render=off` closes it. Portrait panel in a sticky left column (render on top, part facts below; the rest of Asset 360 flows beside it) with the same twin in `?view=part`: **only this station**, at the origin, on the same grid, same grayscale material as the Floor. Orbit is allowed here; it is a detail inspection, not navigation. The camera refits to the frame's aspect so the station is never cropped.
- Clicking a part highlights that sub-tree and shows part facts beside the render: for the sensor-bound part (`RPP1/URjoint1`) the source, window, RMS, speed, BPFI, current fault, `Open incident`, `Open exact signal`; for other monitored stations the cited process/electrical tags on the bound part; for every other part "No sensor on this part" — never an invented fault.
- When the asset carries a flag, the bound part is pre-highlighted on open so the fault is visible immediately.
- Works for all stations (geometry + tags where bound) and survives replay re-renders (persistent iframe).

### 5.5 Condition

Vibration diagnosis dashboard. Primary object is the asset: six motor tiles (RPP1, PP5, B1–B4). Each tile: RMS sparkline from the hop historian (~20 cited dots, same 1 Hz clock as process tags), PMMCP label (`inner_race` / `outer_race` / `none` / etc.), incident chip if open, `.mat` cite. Spectrum, envelope, and full L1 dump stay on Asset 360 / incident. No 12 kHz waveform thumbnails.

ISO: one page-level note only — all 6 << 15 kW (`iso20816.py:294`). Context only. No zone letter. No per-tile ISO.

Flags stay on RPP1, PP5. B1–B4 are healthy CWRU normals (`97.mat`–`100.mat`), one unique file each. FPR is a real number from those four true negatives plus existing healthy hops (Decision 11).

### 5.6 Intelligence

Cross-site trust and execution center, not a feature launcher. The Fleet accordion is a pointer into `/assets` and `/condition` — not the process-tag or vibration dashboard.

#### Summary

- Running.
- Failed/rejected.
- Median L1 duration.
- Median L2 duration.
- Evidence-complete runs.

#### Run inbox

Columns: run ID, incident, asset, workflow, current stage, state, started, duration.

#### System strip

- Local model and endpoint.
- PMMCP MCP health.
- OpenClaw gateway health.
- OpenShell containment state.
- Last denied egress event.

#### Run detail

Stage timeline, tool events, validated citations, errors, timings, model identity, and incident link. Prompts and raw payloads are collapsed advanced material.

## 6. Maintenance Assist sidebar

### Role

Contextual machinery copilot embedded in the shared utility rail. It answers bounded questions about selected asset, current incident, evidence, repair action, parts, manuals, and history.

It does not become the application's primary navigation or a general-purpose chat.

### Current integration boundary

The live assistant binds the selected asset's current-hop L1 evidence. `RPP1` / `URjoint1` has CWRU scalars and may discuss the flag. Other monitored stations answer from cited process / electrical tags only — never a fault, ISO zone, or work order. Geometry-only stations stay unavailable. Never generate convincing mock answers when the hop has no tags.

### Header

- `Maintenance Assist`.
- Current asset/component.
- Incident ID when present.
- Local model badge.
- Close/collapse button with accessible label.

### Context capsule

Always visible above conversation:

- Asset.
- Component.
- Current fault.
- Evidence available: signal, manual, history.
- `Change context` routes user to selection; it never silently changes asset.

### Conversation

- Suggested questions before first message.
- User messages and assistant answers use restrained neutral surfaces.
- Every factual answer places citation links directly beneath the relevant paragraph.
- Out-of-scope answer explains accepted scope and offers relevant suggestions.
- Streaming/running state shows current stage, not decorative typing dots alone.
- Errors state cause and recovery action.

### Composer

- Persistent visible label: `Ask about this incident or asset`.
- Multiline input.
- Send button; Cmd/Ctrl+Enter shortcut.
- Disabled with explanation when no supported context, gateway unavailable, or analysis is already running.
- Input remains when a recoverable request fails.

### Progressive run detail

Collapsed by default:

- PMMCP tool called.
- Manual/history retrieval.
- Local L2 synthesis.
- Citations validated.

`Open full run` routes to Intelligence without losing incident context.

### Sidebar states

| State | Required UI |
| --- | --- |
| Closed | 44 px labeled trigger with shortcut |
| No context | Explanation + choose incident/asset action |
| Supported context | Suggested questions + composer |
| Unsupported asset | Scope explanation; no composer masquerading as functional |
| Running | Stage/progress, disabled duplicate submit |
| Answered | Cited response + open evidence/run |
| Out of scope | Boundary explanation + valid suggestions |
| Failed | Cause, retained question, retry |
| Offline | Local gateway health and recovery guidance |

## 7. Visual design system

### Style

Enterprise-light, flat, data-dense, and operational. Palantir-inspired composition without cosplay.

Avoid:

- Glassmorphism, glow, gradients, and decorative blur.
- Floating rounded-card mosaics.
- Giant marketing typography.
- Emojis as icons.
- Dense monospace body copy.
- Red/green as the only state signal.
- Animation unrelated to spatial or state continuity.

### Color tokens

| Token | Value | Use |
| --- | --- | --- |
| `--surface-app` | `#F8FAFC` | Application background |
| `--surface-panel` | `#FFFFFF` | Tables, panels, utility rail |
| `--surface-selected` | `#F1F5F9` | Selected object/row |
| `--text-primary` | `#0F172A` | Main text |
| `--text-secondary` | `#475569` | Secondary text |
| `--border` | `#CBD5E1` | Dividers and input borders |
| `--primary` | `#000000` | Primary action and active navigation |
| `--critical` | `#B91C1C` | Critical/error |
| `--warning` | `#B45309` | Warning/aging |
| `--success` | `#047857` | Completed/contained |
| `--info` | `#000000` | Running/information |
| `--focus` | `#000000` | 2–3 px focus ring |

All text/background pairs must meet WCAG AA. Status always includes icon or text.

### Typography

- UI: local/system `Inter, ui-sans-serif, system-ui, sans-serif`.
- Data: `ui-monospace, SFMono-Regular, Menlo, monospace`.
- Base body: 14 px desktop, 20–22 px line height.
- Page title: 24 px / 600.
- Section title: 16 px / 600.
- Labels/table headers: 12 px / 600.
- Tabular numbers use `font-variant-numeric: tabular-nums`.
- No remote font request in the air-gapped runtime.

### Geometry and spacing

- 4 px base unit; primary rhythm 8, 12, 16, 24, 32.
- Corner radius: 0. Status, filters, and chrome are square — no pills.
- 1 px borders define hierarchy; one subtle elevation token only for overlays.
- Interactive target: minimum 44 × 44 px.
- Table rows: 48–56 px.
- Motion: 150–220 ms, transform/opacity only, reduced-motion respected.

### Iconography

One locally vendored SVG stroke set with consistent 16/20 px sizing. Every icon-only control has an accessible name.

## 8. Interaction contracts

### Case lifecycle

| Current | Primary action | Result |
| --- | --- | --- |
| New | Acknowledge | Status becomes acknowledged; activity appended |
| Acknowledged | Start work | Status becomes in progress; activity appended |
| In progress | Resolve | Resolution note required; status becomes resolved |
| Resolved | None | Read-only; recurrence links remain navigable |

### Selection/context

- Selected incident determines asset, component, floor focus, evidence scope, and assistant context.
- Selected asset alone scopes assistant only when that asset has supported evidence.
- Context is shown before any assistant question is sent.
- Route changes preserve assistant open/closed state but update its explicit context capsule.

### Evidence

Citation click opens Evidence Viewer in the utility rail. `Open full artifact` remains available. Closing viewer returns to prior rail mode and focus.

### Live updates

REST provides initial snapshots. Existing SSE run events update visible stage state. New incident/list events may use polling first, but UI exposes freshness and never implies realtime when disconnected.

## 9. API/view-model boundary

Target endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/site` | Site hierarchy, scope, system summary |
| GET | `/api/incidents` | Filtered active/resolved incident registry |
| GET | `/api/incidents/:id` | Incident, detections, work order, runs, activity |
| POST | `/api/incidents/:id/actions/acknowledge` | Lifecycle transition |
| POST | `/api/incidents/:id/actions/start` | Lifecycle transition |
| POST | `/api/incidents/:id/actions/resolve` | Lifecycle transition with note |
| GET | `/api/assets` | Filtered asset registry |
| GET | `/api/assets/:id` | Asset 360 view |
| GET | `/api/runs` | Cross-site run registry |
| GET | `/api/runs/:id` | Run summary and stages |
| GET | `/api/events?run=:id` | Existing SSE event stream |
| POST | `/api/questions` | Bounded contextual assistant question |

Assistant request:

```json
{
  "question": "What should I inspect before replacing this bearing?",
  "context": {
    "incident_id": "INC-0042",
    "asset_id": "RPP1",
    "component_id": "URjoint1"
  }
}
```

Server validates context against the selected incident and configured agent scope; client context is never trusted blindly.

## 10. Empty, loading, and error states

Every page must specify:

- Skeleton only when expected wait exceeds 300 ms.
- Empty result explains active filters and offers clear reset.
- No incidents in assigned area is a positive state, not a blank table.
- Unsupported assistant context is explicit.
- Offline state distinguishes HTTP server, gateway, PMMCP, and model failures.
- Failed lifecycle action keeps current view and presents retry.
- Evidence missing blocks unsupported claims and identifies the missing artifact.

## 11. Accessibility and quality gates

- Keyboard can reach navigation, filters, rows, lifecycle actions, utility-rail modes, citations, and composer.
- Route change moves focus to page heading.
- Utility rail traps focus only when presented as an overlay; Escape closes it and restores trigger focus.
- Inputs have visible labels; placeholders are examples only.
- Status is never color-only.
- Charts include units, exact values, and a table/text alternative.
- Focus rings remain visible.
- No horizontal page scroll at 1180 px.
- No content obscured by persistent header or rail.
- Reduced-motion mode removes nonessential transitions.
- No external runtime fonts, analytics, images, or APIs.

## 12. Visual-mockup gate

Before production integration, create a disconnected static prototype with realistic, fixed content for:

1. Incident Inbox with selected Object Preview.
2. Incident detail with Maintenance Assist open.
3. Floor with selected asset and active incident.
4. Asset 360.
5. Intelligence overview and one expanded L1/L2 run.

Approval checklist:

- Reads as one Palantir Workshop-style application, not five templates.
- Technician's next action is obvious within ten seconds.
- Incident table remains dominant on Inbox.
- Assistant knows and visibly states its machinery context.
- AI process is inspectable without overwhelming default view.
- 3D view links back to operational objects.
- Priority, signal severity, case status, and AI state are not conflated.
- Every recommendation visibly leads to evidence.
- No unsupported controls or fake confidence.
- 1440 × 900 screenshots have no clipping, accidental overflow, or empty dead zones.

Only after these five screens are reviewed should the prototype be integrated with SQLite, APIs, SSE, the Three.js twin, and the existing scoped assistant.
