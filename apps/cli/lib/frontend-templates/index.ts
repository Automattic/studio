import { staticTemplate } from './static-template';
import type { FrontendTemplate } from './types';

export type { FrontendTemplate } from './types';

// The template used when none is specified. New templates are added to the registry below.
export const DEFAULT_FRONTEND_TEMPLATE = 'static';

export const FRONTEND_TEMPLATES: Record< string, FrontendTemplate > = {
	[ staticTemplate.id ]: staticTemplate,
};

/** Resolve a template by id, falling back to the default. */
export function getFrontendTemplate( id?: string ): FrontendTemplate {
	return (
		FRONTEND_TEMPLATES[ id ?? DEFAULT_FRONTEND_TEMPLATE ] ??
		FRONTEND_TEMPLATES[ DEFAULT_FRONTEND_TEMPLATE ]
	);
}
