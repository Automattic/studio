/**
 * @vitest-environment node
 */
import os from 'os';
import { vi } from 'vitest';
import {
	hasWasmMemoryErrorMessage,
	isLikelyWindowsMemoryError,
	isWasmMemoryError,
} from 'src/lib/wasm-memory-error';
import { getRunningSiteCount } from 'src/site-server';

vi.mock( 'src/site-server', () => ( {
	getRunningSiteCount: vi.fn().mockReturnValue( 0 ),
} ) );

describe( 'hasWasmMemoryErrorMessage', () => {
	it.each( [
		'Cannot allocate Wasm memory for new instance',
		'could not allocate memory',
		'Allocation failed - process out of memory',
		'WebAssembly.Memory(): could not allocate memory',
	] )( 'should return true for error containing "%s"', ( errorString ) => {
		expect( hasWasmMemoryErrorMessage( new Error( errorString ) ) ).toBe( true );
	} );

	it( 'should return true when error string is part of a larger message', () => {
		expect(
			hasWasmMemoryErrorMessage(
				new Error( 'RuntimeError: Allocation failed because system ran out of memory' )
			)
		).toBe( true );
	} );

	it( 'should return false for unrelated errors', () => {
		expect( hasWasmMemoryErrorMessage( new Error( 'ENOENT: no such file' ) ) ).toBe( false );
	} );

	it( 'should return false for non-Error values', () => {
		expect( hasWasmMemoryErrorMessage( 'string error' ) ).toBe( false );
		expect( hasWasmMemoryErrorMessage( null ) ).toBe( false );
		expect( hasWasmMemoryErrorMessage( undefined ) ).toBe( false );
	} );
} );

describe( 'isLikelyWindowsMemoryError', () => {
	const originalPlatform = process.platform;

	afterEach( () => {
		Object.defineProperty( process, 'platform', { value: originalPlatform } );
		vi.restoreAllMocks();
	} );

	it( 'should return true on Windows with low memory, running sites, and matching error', () => {
		Object.defineProperty( process, 'platform', { value: 'win32' } );
		vi.spyOn( os, 'freemem' ).mockReturnValue( 500 * 1024 ** 2 ); // 500 MB
		vi.mocked( getRunningSiteCount ).mockReturnValue( 2 );

		expect(
			isLikelyWindowsMemoryError( new Error( 'WordPress server process exited unexpectedly' ) )
		).toBe( true );
	} );

	it( 'should return false on macOS', () => {
		Object.defineProperty( process, 'platform', { value: 'darwin' } );
		vi.spyOn( os, 'freemem' ).mockReturnValue( 500 * 1024 ** 2 );
		vi.mocked( getRunningSiteCount ).mockReturnValue( 2 );

		expect(
			isLikelyWindowsMemoryError( new Error( 'WordPress server process exited unexpectedly' ) )
		).toBe( false );
	} );

	it( 'should return false when no sites are running', () => {
		Object.defineProperty( process, 'platform', { value: 'win32' } );
		vi.spyOn( os, 'freemem' ).mockReturnValue( 500 * 1024 ** 2 );
		vi.mocked( getRunningSiteCount ).mockReturnValue( 0 );

		expect(
			isLikelyWindowsMemoryError( new Error( 'WordPress server process exited unexpectedly' ) )
		).toBe( false );
	} );

	it( 'should return false when free memory is above threshold', () => {
		Object.defineProperty( process, 'platform', { value: 'win32' } );
		vi.spyOn( os, 'freemem' ).mockReturnValue( 2 * 1024 ** 3 ); // 2 GB
		vi.mocked( getRunningSiteCount ).mockReturnValue( 2 );

		expect(
			isLikelyWindowsMemoryError( new Error( 'WordPress server process exited unexpectedly' ) )
		).toBe( false );
	} );

	it( 'should return false when error message does not match', () => {
		Object.defineProperty( process, 'platform', { value: 'win32' } );
		vi.spyOn( os, 'freemem' ).mockReturnValue( 500 * 1024 ** 2 );
		vi.mocked( getRunningSiteCount ).mockReturnValue( 2 );

		expect( isLikelyWindowsMemoryError( new Error( 'Some other error' ) ) ).toBe( false );
	} );
} );

describe( 'isWasmMemoryError', () => {
	const originalPlatform = process.platform;

	afterEach( () => {
		Object.defineProperty( process, 'platform', { value: originalPlatform } );
		vi.restoreAllMocks();
	} );

	it( 'should return true for explicit WASM memory errors', () => {
		expect( isWasmMemoryError( new Error( 'could not allocate memory' ) ) ).toBe( true );
	} );

	it( 'should return true for Windows heuristic match', () => {
		Object.defineProperty( process, 'platform', { value: 'win32' } );
		vi.spyOn( os, 'freemem' ).mockReturnValue( 500 * 1024 ** 2 );
		vi.mocked( getRunningSiteCount ).mockReturnValue( 2 );

		expect( isWasmMemoryError( new Error( 'WordPress server process exited unexpectedly' ) ) ).toBe(
			true
		);
	} );

	it( 'should return false for unrelated errors', () => {
		expect( isWasmMemoryError( new Error( 'ENOENT: no such file' ) ) ).toBe( false );
	} );
} );
