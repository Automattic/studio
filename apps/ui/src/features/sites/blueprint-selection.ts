import { inspectBlueprint, type Blueprint, type LibraryBlueprint } from '@studio/blueprints';
import { generateDefaultBlueprintDescription } from './blueprint-description';
import type { BlueprintSource } from '@/data/core';

export interface SelectedBlueprint {
	slug?: string;
	title: string;
	excerpt: string;
	image?: string;
	// What the form shows and pre-fills from.
	blueprint: Blueprint;
	// What the site is created from, which `createSite` opens again.
	source: BlueprintSource;
	file: Pick< File, 'name' | 'size' >;
}

export function toSelectedBlueprint( entry: LibraryBlueprint ): SelectedBlueprint {
	return {
		slug: entry.slug,
		title: entry.title,
		excerpt: entry.excerpt,
		image: entry.image,
		blueprint: entry.blueprint,
		source: entry.slug,
		file: { name: entry.title, size: 0 },
	};
}

export function createSelectedBlueprint(
	blueprint: Blueprint,
	file: Pick< File, 'name' | 'size' >,
	source: BlueprintSource = blueprint
): SelectedBlueprint {
	const { title, description } = inspectBlueprint( blueprint );
	return {
		title: title || file.name.replace( /\.(json|zip)$/i, '' ),
		excerpt: description || generateDefaultBlueprintDescription( blueprint ),
		blueprint,
		source,
		file,
	};
}
