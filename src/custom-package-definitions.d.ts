declare module '@timfish/forge-externals-plugin' {
	import type { PluginBase } from '@electron-forge/plugin-base';

	class ForgeExternalsPlugin extends PluginBase< { externals: string[] } > {
		name: string;
	}

	export = ForgeExternalsPlugin;
}

declare module 'wpcom' {
	import WPCOM from 'wpcom';
	const wpcom: WPCOM;
	export default wpcom;
}
