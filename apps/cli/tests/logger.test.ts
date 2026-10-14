import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from 'cli/logger';

describe( 'Logger', () => {
	afterEach( () => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	} );

	it( 'writes plain progress in CI instead of rendering spinner frames', () => {
		vi.stubEnv( 'CI', '1' );
		const connected = Object.getOwnPropertyDescriptor( process, 'connected' );
		Object.defineProperty( process, 'connected', { configurable: true, value: false } );
		const stderr = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		const logger = new Logger< string >();
		const spinnerStart = vi.spyOn( logger.spinner, 'start' );

		logger.reportStart( 'import', 'Preparing source website' );
		logger.reportProgress( 'Preparing source route 1 of 2' );
		logger.reportSuccess( 'Website artifact created' );

		expect( stderr ).toHaveBeenNthCalledWith( 1, 'Preparing source website' );
		expect( stderr ).toHaveBeenNthCalledWith( 2, 'Preparing source route 1 of 2' );
		expect( stderr ).toHaveBeenNthCalledWith( 3, 'Website artifact created' );
		expect( spinnerStart ).not.toHaveBeenCalled();
		if ( connected ) {
			Object.defineProperty( process, 'connected', connected );
		}
	} );
} );
