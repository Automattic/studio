/**
 * Get the Sentry release information based on the version
 * @param version The version string from package.json or app.getVersion()
 */
export function getSentryReleaseInfo( version: string ) {
	const [ baseVersionWithBeta ] = version.split( '-dev.' );
	const isDevEnvironment =
		version.includes( '-dev.' ) ||
		!! process.env.IS_DEV_BUILD ||
		process.env.NODE_ENV === 'development';
	const sentryRelease = `studio@${ baseVersionWithBeta }`;

	return {
		release: sentryRelease,
		environment: isDevEnvironment ? 'development' : 'production',
	};
}
