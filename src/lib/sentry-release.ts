/**
 * Get the Sentry release information based on the version
 * @param version The version string from package.json or app.getVersion()
 */
export function getSentryReleaseInfo( version: string ) {
	// Handle both -dev.HASH and -devN formats for backward compatibility
	const baseVersionWithBeta = version.replace( /(-dev\..*|-dev\d+)$/, '' );
	const isDevEnvironment =
		/-dev\..*|-dev\d+/.test( version ) ||
		!! process.env.IS_DEV_BUILD ||
		process.env.NODE_ENV === 'development';
	const sentryRelease = `studio@${ baseVersionWithBeta }`;

	return {
		release: sentryRelease,
		environment: isDevEnvironment ? 'development' : 'production',
	};
}
