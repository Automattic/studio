import { generateDefaultBlueprintDescription } from '@studio/common/lib/blueprint-settings';
import { validateBlueprintData } from '@studio/common/lib/blueprint-validation';
import { __ } from '@wordpress/i18n';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

export interface SelectedBlueprint {
	title: string;
	excerpt: string;
	blueprint: BlueprintV1Declaration;
	file: Pick< File, 'name' | 'size' >;
	filePath?: string;
	tempDir?: string;
}

export async function createSelectedBlueprint(
	parsed: unknown,
	file: Pick< File, 'name' | 'size' >,
	options: { filePath?: string; tempDir?: string } = {}
): Promise< SelectedBlueprint > {
	if ( parsed && typeof parsed === 'object' && ( parsed as { version?: number } ).version === 2 ) {
		throw new Error(
			__( 'Blueprint v2 format is not supported yet. Please use Blueprint v1 format.' )
		);
	}

	const validation = await validateBlueprintData( parsed );
	if ( ! validation.valid ) {
		throw new Error( validation.error );
	}

	const blueprint = parsed as BlueprintV1Declaration;
	const meta = ( parsed as { meta?: { title?: string; description?: string } } ).meta;
	return {
		title: meta?.title || file.name.replace( /\.(json|zip)$/i, '' ),
		excerpt: meta?.description || generateDefaultBlueprintDescription( blueprint ),
		blueprint,
		file,
		...options,
	};
}
