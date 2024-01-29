declare module '@wp-now/wp-now' {
	type Server = {
		php: import('@php-wasm/node').UniversalPHP;
		url: string;
		options: {
			port: number;
			wpContentPath: string;
		};
		stopServer: () => Promise< void >;
	};

	function getWpNowConfig( ...args: any[] ): Promise< any >;
	function startServer( ...args: any[] ): Promise< Server >;
}

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
