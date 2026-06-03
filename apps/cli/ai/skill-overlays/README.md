# Skill overlays

A **skill body** (`skills/<name>/SKILL.md`) is authored harness-agnostically: it
describes a capability and **never names a Studio tool**, so the same skill can
back any agent surface (Studio Code / CLI / App / Web — and, longer term, a
shared cross-product skill library other harnesses like Telex consume).

The Studio-specific part — which concrete tool implements each capability —
lives here, in `skill-overlays/<name>.md`. At load time `loadSkills()` appends
the matching overlay to the skill body under an "In Studio" heading.

This keeps the portable knowledge and the harness binding separate: a skill body
can be lifted into a shared package untouched, and Studio's tool names stay in
Studio. A skill with no overlay file simply loads as-is.

Example: `verify-layout/SKILL.md` says "measure the rendered DOM's computed
`grid-template-columns`"; `verify-layout.md` here maps that to `measure_elements`.
