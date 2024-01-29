import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require( 'fork-ts-checker-webpack-plugin' ); // eslint-disable-line @typescript-eslint/no-var-requires

export const plugins = [
	new ForkTsCheckerWebpackPlugin( {
		logger: 'webpack-infrastructure',
	} ),
];
