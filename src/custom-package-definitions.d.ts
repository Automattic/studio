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
		token: string;
	}
}

declare global {
	interface Window {
		wp: {
			element: {
				Component: React.ComponentType;
				createElement: React.ReactElement;
			};
		};
		LLMModel: {
			GPT_4_TURBO: string;
			GPT_4O: string;
			LLAMA3_70B_8192: string;
			LLAMA3_70B_8192_WPCOM: string;
			GEMMA_7b_INSTRUCT: string;
			PHI_3_MEDIUM: string;
			MISTRAL_03: string;
			HERMES_2_PRO_MISTRAL: string;
			isMultimodal: ( model: string ) => boolean;
			supportsToolMessages: ( model: string ) => boolean;
			getAvailable: ( service: string ) => string[];
			getDefault( service?: string | null ): string;
		};
	}
}
