import { prepareBlueprint } from '@studio/common/lib/blueprint-selection';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

export interface SelectedBlueprint {
	title: string;
	excerpt: string;
	blueprint: BlueprintV1Declaration;
	file: Pick< File, 'name' | 'size' >;
	filePath?: string;
	tempDir?: string;
	bundleUrl?: string;
}

export async function createSelectedBlueprint(
	parsed: unknown,
	file: Pick< File, 'name' | 'size' >,
	options: { filePath?: string; tempDir?: string } = {}
): Promise< SelectedBlueprint > {
	const prepared = await prepareBlueprint( parsed, {
		fallbackTitle: file.name.replace( /\.(json|zip)$/i, '' ),
	} );
	if ( ! prepared.valid ) {
		throw new Error( prepared.error );
	}

	return {
		title: prepared.title,
		excerpt: prepared.excerpt,
		blueprint: prepared.blueprint,
		file,
		...options,
	};
}
