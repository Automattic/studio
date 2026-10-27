import { describe, expect, it } from 'vitest';
import { getNativePhpWorkerPoolSize } from 'cli/lib/native-php/php-server-child-worker-pool';

describe( 'getNativePhpWorkerPoolSize', () => {
	it( 'parses a positive integer', () => {
		expect( getNativePhpWorkerPoolSize( { STUDIO_PHP_WORKER_POOL_SIZE: '8' } ) ).toBe( 8 );
		expect( getNativePhpWorkerPoolSize( { STUDIO_PHP_WORKER_POOL_SIZE: '1' } ) ).toBe( 1 );
	} );

	it( 'falls back to the default for values that are not positive integers', () => {
		expect( getNativePhpWorkerPoolSize( { STUDIO_PHP_WORKER_POOL_SIZE: '0' } ) ).toBe( 4 );
		expect( getNativePhpWorkerPoolSize( { STUDIO_PHP_WORKER_POOL_SIZE: '-2' } ) ).toBe( 4 );
		expect( getNativePhpWorkerPoolSize( { STUDIO_PHP_WORKER_POOL_SIZE: 'abc' } ) ).toBe( 4 );
		expect( getNativePhpWorkerPoolSize( { STUDIO_PHP_WORKER_POOL_SIZE: '4.5' } ) ).toBe( 4 );
		expect( getNativePhpWorkerPoolSize( { STUDIO_PHP_WORKER_POOL_SIZE: '' } ) ).toBe( 4 );
		expect( getNativePhpWorkerPoolSize( {} ) ).toBe( 4 );
	} );

	it( 'reads process.env by default', () => {
		const previous = process.env.STUDIO_PHP_WORKER_POOL_SIZE;
		process.env.STUDIO_PHP_WORKER_POOL_SIZE = '12';
		try {
			expect( getNativePhpWorkerPoolSize() ).toBe( 12 );
		} finally {
			if ( previous === undefined ) {
				delete process.env.STUDIO_PHP_WORKER_POOL_SIZE;
			} else {
				process.env.STUDIO_PHP_WORKER_POOL_SIZE = previous;
			}
		}
	} );
} );
