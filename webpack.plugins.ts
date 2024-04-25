import { sentryWebpackPlugin } from '@sentry/webpack-plugin';
import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import type { WebpackPluginInstance } from 'webpack';
import 'dotenv/config';
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require( 'fork-ts-checker-webpack-plugin' ); // eslint-disable-line @typescript-eslint/no-var-requires

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
	sentryWebpackPlugin( {
		authToken: process.env.SENTRY_AUTH_TOKEN,
		org: 'a8c',
		project: 'studio',
	} ),
];
