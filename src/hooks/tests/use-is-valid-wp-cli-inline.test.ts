import { renderHook } from '@testing-library/react';
import { useIsValidWpCliInline } from '../../hooks/use-is-valid-wp-cli-inline';

describe( 'useIsValidWpCliInline', () => {
	it( 'returns true for a valid wp-cli command', () => {
		const command = 'wp plugin update --all';
		const { result } = renderHook( () => useIsValidWpCliInline( command ) );

		expect( result.current ).toBe( true );
	} );

	it( 'returns false for a command without wp', () => {
		const command = 'plugin install';
		const { result } = renderHook( () => useIsValidWpCliInline( command ) );

		expect( result.current ).toBe( false );
	} );

	it( 'returns false for multiple wp commands', () => {
		const command = 'wp plugin install && wp theme install';
		const { result } = renderHook( () => useIsValidWpCliInline( command ) );

		expect( result.current ).toBe( false );
	} );

	it( 'returns false for multiple wp commands multiline', () => {
		const command = `wp plugin install
						 wp theme install`;
		const { result } = renderHook( () => useIsValidWpCliInline( command ) );

		expect( result.current ).toBe( false );
	} );

	it( 'returns false for commands with angle brackets', () => {
		const command = 'wp plugin install <plugin-name>';
		const { result } = renderHook( () => useIsValidWpCliInline( command ) );

		expect( result.current ).toBe( false );
	} );

	it( 'returns false for commands with square brackets', () => {
		const command = 'wp plugin install [plugin-name]';
		const { result } = renderHook( () => useIsValidWpCliInline( command ) );

		expect( result.current ).toBe( false );
	} );

	it( 'returns false for commands with paths', () => {
		const command = 'wp plugin install /path/to/plugin';
		const { result } = renderHook( () => useIsValidWpCliInline( command ) );

		expect( result.current ).toBe( false );
	} );
} );
