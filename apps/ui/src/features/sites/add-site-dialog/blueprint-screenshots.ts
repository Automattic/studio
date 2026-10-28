import coastalRituals from './assets/personal-blog/coastal-rituals.jpg';
import home from './assets/personal-blog/home.jpg';
import oliveTree from './assets/personal-blog/olive-tree.jpg';
import thumbnail from './assets/personal-blog/thumbnail.jpg';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';

export function getBlueprintScreenshots( blueprint: Blueprint ): string[] {
	return blueprint.slug === 'personal-blog-2'
		? [ home, oliveTree, coastalRituals ]
		: [ blueprint.image ];
}

export function getBlueprintThumbnail( blueprint: Blueprint ): string {
	return blueprint.slug === 'personal-blog-2' ? thumbnail : blueprint.image;
}
