import { sentryWebpackPlugin } from '@sentry/webpack-plugin';
import { getSentryReleaseInfo } from './src/lib/sentry-release';
import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import type { WebpackPluginInstance } from 'webpack';
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require( 'fork-ts-checker-webpack-plugin' );

const version = process.env.npm_package_version || '';
const { release: sentryRelease, environment } = getSentryReleaseInfo( version );
console.log( 'Sentry release version:', sentryRelease );
console.log( 'Sentry environment:', environment );

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
	environment !== 'development' &&
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
