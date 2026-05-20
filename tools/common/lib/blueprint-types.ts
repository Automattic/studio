// Local stand-ins for the few Blueprint types and helpers we previously
// imported from `@wp-playground/blueprints`. The full library carries a
// transitive dependency on `@php-wasm/*` which Studio no longer bundles in
// this experimental build, so we re-declare just enough surface to keep the
// blueprint-handling code paths compiling.

export type StepDefinition = { step: string } & Record< string, unknown >;

// `Step` mirrors @wp-playground/blueprints' looser union — many helpers
// accept either a StepDefinition or a string/false/null/undefined sentinel.
export type Step = StepDefinition | string | false | null | undefined;

export interface BlueprintMeta {
	title?: string;
	description?: string;
	author?: string;
}

export interface BlueprintV1Declaration {
	meta?: BlueprintMeta;
	steps?: Step[];
	features?: unknown;
	preferredVersions?: { php?: string | 'latest'; wp?: string | 'latest' | false };
	landingPage?: string;
	login?: boolean | { username?: string; password?: string };
	constants?: Record< string, unknown >;
	extraLibraries?: unknown;
}

export type Blueprint = BlueprintV1Declaration;

export function isStepDefinition( step: unknown ): step is StepDefinition {
	return (
		typeof step === 'object' &&
		step !== null &&
		'step' in step &&
		typeof ( step as { step: unknown } ).step === 'string'
	);
}
