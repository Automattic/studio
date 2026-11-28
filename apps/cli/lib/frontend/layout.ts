import path from 'path';
import {
	HEADLESS_FRONTEND_SUBDIR,
	HEADLESS_WORDPRESS_SUBDIR,
} from '@studio/common/lib/site-frontend';

// A new headless site is a container folder holding both halves side by side.
// The site record's `path` points at `wordpress/`, so every existing site
// operation keeps seeing a plain WordPress install.
export function getHeadlessContainerLayout( containerPath: string ): {
	wordpressPath: string;
	frontendPath: string;
} {
	return {
		wordpressPath: path.join( containerPath, HEADLESS_WORDPRESS_SUBDIR ),
		frontendPath: path.join( containerPath, HEADLESS_FRONTEND_SUBDIR ),
	};
}
