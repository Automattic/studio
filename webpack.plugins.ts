import { sentryWebpackPlugin } from '@sentry/webpack-plugin';
import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import type { WebpackPluginInstance } from 'webpack';
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require( 'fork-ts-checker-webpack-plugin' );

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
	! process.env.IS_DEV_BUILD &&
		!! process.env.SENTRY_AUTH_TOKEN &&
		sentryWebpackPlugin( {
			authToken: process.env.SENTRY_AUTH_TOKEN,
			org: 'a8c',
			project: 'studio',
		} ),
];
