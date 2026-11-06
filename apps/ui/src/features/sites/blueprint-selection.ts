import { prepareBlueprint } from '@studio/common/lib/blueprint-selection';
import type { Blueprint as CatalogBlueprint } from '@studio/common/lib/studio-blueprints-api';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

export interface SelectedBlueprint {
	slug?: string;
	title: string;
	excerpt: string;
	image?: string;
	blueprint: BlueprintV1Declaration;
	file: Pick< File, 'name' | 'size' >;
	filePath?: string;
	tempDir?: string;
	bundleUrl?: string;
}

export function toSelectedBlueprint( blueprint: CatalogBlueprint ): SelectedBlueprint {
	return {
		slug: blueprint.slug,
		title: blueprint.title,
		excerpt: blueprint.excerpt,
		image: blueprint.image,
		blueprint: blueprint.blueprint as BlueprintV1Declaration,
		file: { name: blueprint.title, size: 0 },
		filePath: blueprint.filePath,
		bundleUrl: blueprint.bundle_url ?? undefined,
	};
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
