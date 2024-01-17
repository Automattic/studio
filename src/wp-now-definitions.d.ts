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
