declare module '@timfish/forge-externals-plugin' {
	import type { PluginBase } from '@electron-forge/plugin-base';

	class ForgeExternalsPlugin extends PluginBase< { externals: string[] } > {
		name: string;
	}

	export = ForgeExternalsPlugin;
}

declare module 'wpcom' {
	class Request {
		/* eslint-disable @typescript-eslint/no-explicit-any */
		get( params: object | string, query?: object ): Promise< any >;
		post( params: object | string, query?: object, body?: object ): Promise< any >;
		del( params: object | string, query?: object ): Promise< any >;
		/* eslint-enable @typescript-eslint/no-explicit-any */
	}

	export default class WPCOM {
		constructor( token?: string );
		request: ( params: object, callback: unknown ) => unknown;
		req: Request;
	}
}
