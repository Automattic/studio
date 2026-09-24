import { describe, expect, it } from 'vitest';
import { getJspiExecArgv, JSPI_FLAG } from '@studio/common/lib/jspi';

describe( 'getJspiExecArgv', () => {
	it( 'passes the flag on Node 24, where JSPI is behind it', () => {
		expect(
			getJspiExecArgv( { execArgv: [], nodeVersion: '24.14.0', isJspiAvailable: false } )
		).toEqual( [ JSPI_FLAG ] );
	} );

	it( 'omits the flag when JSPI is available unflagged, as on Node 26', () => {
		expect(
			getJspiExecArgv( { execArgv: [], nodeVersion: '26.5.0', isJspiAvailable: true } )
		).toEqual( [] );
	} );

	it( 'omits the flag before Node 24', () => {
		expect(
			getJspiExecArgv( { execArgv: [], nodeVersion: '22.20.0', isJspiAvailable: false } )
		).toEqual( [] );
	} );

	it( 'forwards the flag when this process was started with it', () => {
		expect(
			getJspiExecArgv( { execArgv: [ JSPI_FLAG ], nodeVersion: '24.14.0', isJspiAvailable: true } )
		).toEqual( [ JSPI_FLAG ] );
	} );
} );
