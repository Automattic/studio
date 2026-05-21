import {
	SITE_RUNTIME_NATIVE_PHP,
	siteRuntimeSchema,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';

export function getSiteRuntime(): SiteRuntime {
	return siteRuntimeSchema.catch( SITE_RUNTIME_NATIVE_PHP ).parse( process.env.STUDIO_RUNTIME );
}
