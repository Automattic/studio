import { z } from 'zod';

const siteRuntimeSchema = z.enum( [ 'playground', 'native-php' ] );
export type SiteRuntime = z.infer< typeof siteRuntimeSchema >;

/**
 * CLI feature flags, read from runtime environment variables.
 *
 * Convention: `STUDIO_ENABLE_<FEATURE>=true` enables the feature. Any other
 * value (including unset) leaves it off. Defaults stay off so that the stable
 * CLI experience is unaffected for users who haven't opted in.
 */

export function isRemoteSessionEnabled(): boolean {
	return process.env.STUDIO_ENABLE_REMOTE_SESSION === 'true';
}

export function getSiteRuntime(): SiteRuntime {
	return siteRuntimeSchema.catch( 'playground' ).parse( process.env.STUDIO_RUNTIME );
}
