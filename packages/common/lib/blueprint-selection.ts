import { __ } from '@wordpress/i18n';
import { generateDefaultBlueprintDescription } from '@studio/common/lib/blueprint-settings';
import {
	validateBlueprintData,
	type BlueprintValidationResult,
} from '@studio/common/lib/blueprint-validation';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

export interface PreparedBlueprint {
	blueprint: BlueprintV1Declaration;
	title: string;
	excerpt: string;
}

export type PrepareBlueprintResult =
	| { valid: false; error: string }
	| ( { valid: true } & PreparedBlueprint );

interface PrepareBlueprintOptions {
	fallbackTitle: string;
	validate?: ( blueprint: unknown ) => Promise< BlueprintValidationResult >;
}

export function getBlueprintDisplayDetails(
	blueprint: BlueprintV1Declaration,
	fallbackTitle: string
): Pick< PreparedBlueprint, 'title' | 'excerpt' > {
	const meta = blueprint.meta as { title?: string; description?: string } | undefined;
	return {
		title: meta?.title || fallbackTitle,
		excerpt: meta?.description || generateDefaultBlueprintDescription( blueprint ),
	};
}

export async function prepareBlueprint(
	parsed: unknown,
	{ fallbackTitle, validate = validateBlueprintData }: PrepareBlueprintOptions
): Promise< PrepareBlueprintResult > {
	if ( parsed && typeof parsed === 'object' && ( parsed as { version?: number } ).version === 2 ) {
		return {
			valid: false,
			error: __( 'Blueprint v2 format is not supported yet. Please use Blueprint v1 format.' ),
		};
	}

	const validation = await validate( parsed );
	if ( ! validation.valid ) {
		return validation;
	}

	const blueprint = parsed as BlueprintV1Declaration;
	const details = getBlueprintDisplayDetails( blueprint, fallbackTitle );
	return {
		valid: true,
		blueprint,
		...details,
	};
}
