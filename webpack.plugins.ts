import { sentryWebpackPlugin } from '@sentry/webpack-plugin';
import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import type { WebpackPluginInstance } from 'webpack';
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require( 'fork-ts-checker-webpack-plugin' );

// For dev builds, we want to use a consistent release name
const version = process.env.npm_package_version || '';
const baseVersion = version.split( '-' )[ 0 ]; // Get the version without the dev suffix
const isDevBuild = version.includes( '-dev.' ) || process.env.IS_DEV_BUILD;
const sentryRelease = `studio@${ baseVersion }`;
console.log( 'Sentry release version would be:', sentryRelease );
console.log( 'Sentry environment would be:', isDevBuild ? 'development' : 'production' );

export const plugins: WebpackPluginInstance[] = [
	new ForkTsCheckerWebpackPlugin( {
		logger: 'webpack-infrastructure',
		issue: {
			exclude: {
				file: 'vendor/**/*',
			},
		},
	} ),
	// Sentry must be the last plugin
	! isDevBuild &&
		!! process.env.SENTRY_AUTH_TOKEN &&
		sentryWebpackPlugin( {
			authToken: process.env.SENTRY_AUTH_TOKEN,
			org: 'a8c',
			project: 'studio',
			release: {
				name: sentryRelease,
			},
		} ),
];
