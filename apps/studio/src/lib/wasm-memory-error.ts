import os from 'os';
import { errorMessageContains } from '@studio/common/lib/cli-error';
import { getRunningSiteCount } from 'src/site-server';

/**
 * Checks if the error message contains a known WASM memory allocation failure string.
 */
function hasWasmMemoryErrorMessage( error: unknown ): boolean {
	return (
		errorMessageContains( error, 'Cannot allocate Wasm memory for new instance' ) ||
		errorMessageContains( error, 'could not allocate memory' ) ||
		errorMessageContains( error, 'Allocation failed' ) ||
		errorMessageContains( error, 'WebAssembly.Memory()' )
	);
}

/**
 * Heuristic for Windows where the server process may exit unexpectedly without
 * a clear WASM error when memory is low. Windows doesn't overcommit memory like
 * macOS, so WASM allocation can fail silently, crashing the child process.
 */
function isLikelyWindowsMemoryError( error: unknown ): boolean {
	const MINIMUM_FREE_MEMORY_BYTES = 600 * 1024 ** 2; // 600 MB
	return (
		process.platform === 'win32' &&
		errorMessageContains( error, 'process exited unexpectedly' ) &&
		getRunningSiteCount() > 0 &&
		os.freemem() < MINIMUM_FREE_MEMORY_BYTES
	);
}

/**
 * Detects if an error is likely caused by insufficient memory for WASM allocation.
 */
export function isWasmMemoryError( error: unknown ): boolean {
	return hasWasmMemoryErrorMessage( error ) || isLikelyWindowsMemoryError( error );
}
