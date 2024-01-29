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

	interface CliOptions {
		php?: string;
		path?: string;
		wp?: string;
		port?: number;
		blueprint?: string;
		reset?: boolean;
	}

	interface WPNowOptions {
		phpVersion?: SupportedPHPVersion;
		documentRoot?: string;
		absoluteUrl?: string;
		mode?: WPNowMode;
		port?: number;
		projectPath?: string;
		wpContentPath?: string;
		wordPressVersion?: string;
		numberOfPhpInstances?: number;
		blueprintObject?: Blueprint;
		reset?: boolean;
	}

	function getWpNowConfig( args: CliOptions ): Promise< WPNowOptions >;
	function startServer( args: WPNowOptions ): Promise< Server >;
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
