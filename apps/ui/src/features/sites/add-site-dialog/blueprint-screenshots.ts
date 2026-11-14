import coastalRituals from './assets/personal-blog/coastal-rituals.webp';
import home from './assets/personal-blog/home.webp';
import oliveTree from './assets/personal-blog/olive-tree.webp';
import type { LibraryBlueprint } from '@studio/blueprints';

export function getBlueprintScreenshots( blueprint: LibraryBlueprint ): string[] {
	return blueprint.slug === 'substrata' ? [ home, oliveTree, coastalRituals ] : [ blueprint.image ];
}

export function getBlueprintThumbnail(
	blueprint: Pick< LibraryBlueprint, 'slug' | 'image' >
): string {
	return blueprint.slug === 'substrata' ? home : blueprint.image;
}
