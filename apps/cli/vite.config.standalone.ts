import { defineConfig, mergeConfig } from 'vite';
import prodConfig from './vite.config.prod.ts';

// Identical to the production build (the desktop-embedded CLI), but stamps
// `__IS_PACKAGED_FOR_STANDALONE__` so the curl-installed bundle can identify itself at
// runtime — it drives the update notifier and the launch stats. Built via the
// `package:standalone` script, which `create-standalone-bundle.ts` runs in place of `package`.
export default mergeConfig(
	prodConfig,
	defineConfig( {
		define: {
			__IS_PACKAGED_FOR_STANDALONE__: true,
		},
	} )
);
