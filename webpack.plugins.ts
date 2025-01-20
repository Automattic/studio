import { sentryWebpackPlugin } from '@sentry/webpack-plugin';
import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import type { WebpackPluginInstance } from 'webpack';
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require( 'fork-ts-checker-webpack-plugin' ); // eslint-disable-line @typescript-eslint/no-var-requires

// @ts-expect-error - This is injected by webpack.DefinePlugin
const COMMIT_HASH: string = process.env.COMMIT_HASH;

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
	console.log( 'Webpack Sentry Plugin - IS_DEV_BUILD:', process.env.IS_DEV_BUILD ),
	console.log( 'Webpack Sentry Plugin - Should run:', ! process.env.IS_DEV_BUILD ),
	! process.env.IS_DEV_BUILD &&
		!! process.env.SENTRY_AUTH_TOKEN &&
		!! COMMIT_HASH &&
		sentryWebpackPlugin( {
			authToken: process.env.SENTRY_AUTH_TOKEN,
			org: 'a8c',
			project: 'studio',
			release: {
				name: `webpack-${ COMMIT_HASH }-${ process.platform }-${
					process.env.BUILDKITE_STEP_KEY || 'unknown_step'
				}-${ process.env.BUILDKITE_BUILD_NUMBER || 'local' }`,
			},
		} ),
];
