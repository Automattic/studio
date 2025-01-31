import { sentryWebpackPlugin } from '@sentry/webpack-plugin';
import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import type { WebpackPluginInstance } from 'webpack';
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require( 'fork-ts-checker-webpack-plugin' );

const version = process.env.npm_package_version || '';
const [ baseVersionWithBeta ] = version.split( '-dev.' );
const isDevBuild =
	version.includes( '-dev.' ) || process.env.IS_DEV_BUILD || process.env.NODE_ENV === 'development';
const sentryRelease = `studio@${ baseVersionWithBeta }`;
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
