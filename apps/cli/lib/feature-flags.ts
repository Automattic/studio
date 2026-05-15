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
