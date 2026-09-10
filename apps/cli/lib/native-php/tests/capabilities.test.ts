import { describe, expect, it, vi } from 'vitest';
import { assertNativePhpZstdAvailable } from 'cli/lib/native-php/capabilities';

vi.mock( 'cli/lib/dependency-management/paths', () => ( {
	getPhpBinaryPath: vi.fn().mockReturnValue( '/test/php' ),
} ) );

describe( 'assertNativePhpZstdAvailable', () => {
	it( 'accepts a runtime that provides zstd_uncompress', () => {
		const runPhp = vi.fn();

		expect( () => assertNativePhpZstdAvailable( '8.4', runPhp ) ).not.toThrow();
		expect( runPhp ).toHaveBeenCalledWith( '/test/php', [
			'-r',
			'exit(function_exists("zstd_uncompress") ? 0 : 1);',
		] );
	} );

	it( 'explains the required package capability when zstd is unavailable', () => {
		const runPhp = vi.fn().mockImplementation( () => {
			throw new Error( 'missing extension' );
		} );

		expect( () => assertNativePhpZstdAvailable( '8.4', runPhp ) ).toThrow(
			'Native PHP package 8.4.25-studio-1 does not provide zstd_uncompress'
		);
	} );
} );
