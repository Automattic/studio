import { buildJetpackFormParityCssImpl } from './jetpack-form-css-impl.js';

export interface JetpackFormParityCssInput {
  /** Source CSS text after local asset collection/localization; no filesystem or DOM access here. */
  sourceCss: string;
  /** Aggregate signal from the local compose stage. Zero means no Jetpack form was emitted. */
  formsConverted: number;
}

export interface JetpackFormParityCssResult {
  /** Deterministic CSS targeting Jetpack Forms frontend markup; empty when not applicable. */
  css: string;
}

/**
 * Pure contract for local form parity CSS.
 *
 * The implementation may parse `sourceCss`, but must not read files, hit the
 * network, inspect WordPress state, or render a live page. It returns an empty
 * stylesheet when no form was converted or no source form rules can be mapped.
 */
export function buildJetpackFormParityCss(input: JetpackFormParityCssInput): JetpackFormParityCssResult {
  return buildJetpackFormParityCssImpl(input);
}
