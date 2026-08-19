---
name: site-creator
description: Create or continue an AI-led WordPress site project with multiple HTML design directions, gallery selection and refinement, explicit acceptance, and deterministic materialization into editable WordPress. Use for Create with AI sessions and when a user asks to continue, refine, accept, or build a design-gallery project.
user-invokable: true
---

# Site Creator

Coordinate the persisted design project; do not infer its state from chat history.
This skill contains the complete workflow. Do not search the site or filesystem for skill or reference files.

## Start or Resume

1. Call `site_info`, then `design_project_status` for the active site.
2. Use the persisted brief and phase. Do not create another site or project when one exists.
3. Load `visual-design` before generating or revising directions.

## Artifact Files

Artifact entry files live at:

```text
<site>/.studio/design/artifacts/directions/<unique-revision>/index.html
```

Pass only the path below `.studio/design/` to `design_artifact_finalize`, for example:

```text
artifacts/directions/warm-editorial-r1/index.html
```

Keep each file below the agent write limit. Prefer embedded CSS, CSS gradients, inline SVG, and deliberate image placeholders. Do not use scripts, remote URLs, Google Fonts, forms that submit, PHP, or paths outside the artifact directory. Use logical CSS properties such as `margin-inline`, `padding-inline`, and `text-align: start` so the concept behaves sensibly in RTL locales.

The finalization tool removes scripts, injects the gallery resource policy, computes the digest, and advances the manifest atomically. Never edit a file after finalization. Create another revision instead.

## Generate Directions

Create three meaningfully distinct responsive homepage concepts. Vary composition, typography, density, palette, imagery treatment, and tone—not only accent color.

### Parallel design workers

When the launch prompt identifies the session as one numbered design worker, it overrides the three-direction count for that worker: create exactly one direction, use only the assigned worker directory, call `design_artifact_finalize` exactly once, and stop. Other workers own the other directions. Never edit `project.json`; finalization holds the shared manifest lock. A coordinator session must not create designs while workers are active; it uses `design_project_wait` and only recovers missing work after a timeout.

For each direction:

1. Create a new immutable directory under `<site>/.studio/design/artifacts/directions/`.
2. Write a self-contained `index.html` with embedded CSS and no JavaScript, remote fonts, or remote assets.
3. Use semantic landmarks, one `h1`, logical headings, visible focus states, and responsive behavior.
4. Use visible placeholders for facts the user did not provide. Never invent addresses, hours, prices, testimonials, or credentials.
5. Give the direction a concise, distinctive name that communicates its visual idea and stands on its own in the gallery (for example, `VHS Terminal` or `Quiet Editorial`). Never use generic sequence labels such as `Option 1`, `Direction A`, or `Concept 2`.
6. Call `design_artifact_finalize` with the path relative to `<site>/.studio/design/`, that standalone name as the label, and a one-sentence rationale.

Finalize each direction as soon as it is ready so it streams into the gallery. Stop after all three appear. Do not create WordPress content or a theme yet.

## Refine

Treat the selected artifact as the reference. Create a new directory and artifact revision; never overwrite a registered artifact. Preserve requested traits and change only what the user asked to change. Call `design_artifact_finalize` with the selected artifact's exact ID as `parentArtifactId`. Keep the direction's existing label instead of adding `v2`, `revised`, or another version suffix; Studio groups and labels its revisions. Finalize the new revision and tell the user it is available from that direction's version menu.

## Accept and Build

Only after explicit acceptance:

1. Call `design_artifact_accept` for the selected artifact.
2. Call `materialize_design_artifact` for that exact artifact.
3. If materialization fails, report the concrete diagnostic and preserve the accepted artifact. Do not hand-convert the HTML or silently patch WordPress around a transformer failure.
4. After success, load `visual-polish`, inspect the live site at desktop and mobile widths, and report any remaining fidelity difference.

WordPress is authoritative after successful materialization. A later redesign creates a new artifact lineage and requires another explicit acceptance.
