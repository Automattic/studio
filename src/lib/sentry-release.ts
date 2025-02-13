import { isDevRelease } from './version-utils';

/**
 * Get the Sentry release info for the current version
 * @param version The version string from package.json or app.getVersion()
 */
export function getSentryReleaseInfo( version: string ) {
	// Handle both -dev.HASH and -devN formats for backward compatibility
	const baseVersionWithBeta = version.replace( /(-dev\..*|-dev\d+)$/, '' );
	const isDevEnvironment =
		isDevRelease( version ) ||
		!! process.env.IS_DEV_BUILD ||
		process.env.NODE_ENV === 'development';
	const sentryRelease = `studio@${ baseVersionWithBeta }`;

	return { sentryRelease, isDevEnvironment };
}
