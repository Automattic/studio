// Re-export the shared Blueprint type shims from @studio/common so the rest
// of the CLI can keep its short `cli/lib/blueprint-types` import path.
export {
	isStepDefinition,
	type Blueprint,
	type BlueprintMeta,
	type BlueprintV1Declaration,
	type Step,
	type StepDefinition,
} from '@studio/common/lib/blueprint-types';
