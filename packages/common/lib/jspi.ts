/**
 * Checks whether the WebAssembly JavaScript Promise Integration (JSPI) API
 * is available in the current runtime.
 *
 * JSPI is required for Redis and memcached PHP extensions in WordPress
 * Playground. It's currently gated behind Node's `--experimental-wasm-jspi`
 * flag. Once it ships unflagged, this helper will return `true`
 * automatically — no code changes needed.
 */
export const IS_JSPI_AVAILABLE = 'Suspending' in WebAssembly;

export const JSPI_FLAG = '--experimental-wasm-jspi';

type JspiRuntime = {
	execArgv: readonly string[];
	nodeVersion: string;
	isJspiAvailable: boolean;
};

/**
 * Node flags enabling JSPI in a child spawned with this process's Node binary.
 * Node 24 needs the flag; Node 26+ ships JSPI unflagged and rejects it.
 */
export function getJspiExecArgv(
	runtime: JspiRuntime = {
		execArgv: process.execArgv,
		nodeVersion: process.versions.node,
		isJspiAvailable: IS_JSPI_AVAILABLE,
	}
): string[] {
	if ( runtime.execArgv.includes( JSPI_FLAG ) ) {
		return [ JSPI_FLAG ];
	}
	if ( runtime.isJspiAvailable ) {
		return [];
	}
	const major = Number( runtime.nodeVersion.split( '.' )[ 0 ] );
	return major >= 24 ? [ JSPI_FLAG ] : [];
}
