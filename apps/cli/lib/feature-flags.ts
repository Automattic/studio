import {
	SITE_RUNTIME_PLAYGROUND,
	siteRuntimeSchema,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';

export function getSiteRuntime(): SiteRuntime {
	return siteRuntimeSchema.catch( SITE_RUNTIME_PLAYGROUND ).parse( process.env.STUDIO_RUNTIME );
}
