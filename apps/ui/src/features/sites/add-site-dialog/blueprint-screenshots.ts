import coastalRituals from './assets/personal-blog/coastal-rituals.webp';
import home from './assets/personal-blog/home.webp';
import oliveTree from './assets/personal-blog/olive-tree.webp';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';

export function getBlueprintScreenshots( blueprint: Blueprint ): string[] {
	return blueprint.slug === 'substrata' ? [ home, oliveTree, coastalRituals ] : [ blueprint.image ];
}

export function getBlueprintThumbnail( blueprint: Blueprint ): string {
	return blueprint.slug === 'substrata' ? home : blueprint.image;
}
