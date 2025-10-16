declare module '*.png' {
	const dataUri: string;
	export default dataUri;
}

declare module '*.jpg' {
	const dataUri: string;
	export default dataUri;
}

declare module '*.jpeg' {
	const dataUri: string;
	export default dataUri;
}

declare module '*.gif' {
	const dataUri: string;
	export default dataUri;
}

declare module '*.svg' {
	const dataUri: string;
	export default dataUri;
}

declare module '*.riv' {
	const dataUri: string;
	export default dataUri;
}

declare module '*.riv?url' {
	const url: string;
	export default url;
}

declare module '*.wasm' {
	const dataUri: function;
	export default dataUri;
}

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
		get< TResponse = unknown >( params: object | string, query?: object ): Promise< TResponse >;
		get< TResponse = unknown >(
			params: object | string,
			callback?: ( error: Error, data: TResponse, headers: Record< string, string > ) => void
		);
		get< TResponse = unknown >(
			params: object | string,
			query?: object,
			callback?: ( error: Error, data: TResponse, headers: Record< string, string > ) => void
		);
		post< TResponse = unknown >(
			params: object | string,
			callback?: ( error: Error, data: TResponse, headers: Record< string, string > ) => void
		);
		post< TResponse = unknown >(
			params: object | string,
			query?: object,
			body?: object
		): Promise< TResponse >;
		post< TResponse = unknown >(
			params: object | string,
			query?: object,
			body?: object,
			callback?: ( error: Error, data: TResponse, headers: Record< string, string > ) => void
		);
		del< TResponse = unknown >( params: object | string, query?: object ): Promise< TResponse >;
		del< TResponse = unknown >(
			params: object | string,
			query?: object,
			callback?: ( error: Error, data: TResponse, headers: Record< string, string > ) => void
		);
		del< TResponse = unknown >(
			params: object | string,
			callback?: ( error: Error, data: TResponse, headers: Record< string, string > ) => void
		);
		/* eslint-enable @typescript-eslint/no-explicit-any */
	}

	/* eslint-disable @typescript-eslint/no-explicit-any */
	export interface WPCOMInstance {
		token?: string;
		request: ( params: Record< string, any >, callback: ( ...args: any[] ) => void ) => void;
		req: Request;
		pinghub: Pinghub;
		apiVersion: string;
	}

	export type WPCOMRequestHandler = ( ...args: any[] ) => any;

	export interface WPCOMConstructor {
		new ( token?: string | WPCOMRequestHandler, reqHandler?: WPCOMRequestHandler ): WPCOMInstance;

		( token?: string | WPCOMRequestHandler, reqHandler?: WPCOMRequestHandler ): WPCOMInstance;
	}

	const WPCOM: WPCOMConstructor;
	export default WPCOM;
	/* eslint-enable @typescript-eslint/no-explicit-any */
}

declare module 'wpcom-xhr-request';
