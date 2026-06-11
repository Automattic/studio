import { defineConfig, mergeConfig } from 'vite';
import { baseConfig, isNodeBuiltin, packageJsonDependencies } from './vite.config.base';

// For npm publishing, externalize ALL dependencies (they're installed by the end user).
export default mergeConfig(
	baseConfig,
	defineConfig( {
		build: {
			sourcemap: false,
			rolldownOptions: {
				external: ( id ) => {
					if ( id.includes( 'blueprint-schema-validator' ) ) {
						return false;
					}
					if ( isNodeBuiltin( id ) ) {
						return true;
					}
					// Externalize every dependency — the end user installs them.
					return packageJsonDependencies.some(
						( dep ) => id === dep || id.startsWith( dep + '/' )
					);
				},
			},
		},
		define: {
			__ENABLE_CLI_TELEMETRY__: true,
			__IS_PACKAGED_FOR_NPM__: true,
		},
	} )
);
