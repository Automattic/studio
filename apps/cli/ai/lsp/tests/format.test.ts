import { describe, expect, it } from 'vitest';
import {
	describeLocation,
	formatCallHierarchy,
	formatDiagnosticLine,
	formatDiagnostics,
	formatHover,
	formatLocations,
	formatSymbols,
} from '../format';
import type { LspLocation, LspRange } from '../protocol';

const range = ( line: number ): LspRange => ( {
	start: { line, character: 0 },
	end: { line, character: 10 },
} );

const location = ( uri: string, line: number ): LspLocation => ( { uri, range: range( line ) } );

describe( 'describeLocation', () => {
	it( 'renders a site-relative path with a 1-based line', () => {
		expect(
			describeLocation(
				'file:///home/user/Studio/my-site/wp-content/plugins/a/a.php',
				4,
				'/home/user/Studio/my-site'
			)
		).toBe( 'wp-content/plugins/a/a.php:5' );
	} );

	it( 'falls back to the absolute path outside the base directory', () => {
		expect( describeLocation( 'file:///elsewhere/core.php', 0, '/home/user/Studio/my-site' ) ).toBe(
			'/elsewhere/core.php:1'
		);
	} );
} );

describe( 'formatLocations', () => {
	it( 'handles null, single, array, and location-link results', () => {
		expect( formatLocations( null, '/site' ) ).toBe( 'No results.' );
		expect( formatLocations( [], '/site' ) ).toBe( 'No results.' );
		expect( formatLocations( location( 'file:///site/f.php', 2 ), '/site' ) ).toBe( 'f.php:3' );
		expect(
			formatLocations( [ { targetUri: 'file:///site/g.php', targetRange: range( 9 ) } ], '/site' )
		).toBe( 'g.php:10' );
	} );
} );

describe( 'formatHover', () => {
	it( 'handles markup content, marked strings, and arrays', () => {
		expect( formatHover( null ) ).toBe( 'No hover information.' );
		expect( formatHover( { contents: { kind: 'markdown', value: '**init** hook' } } ) ).toBe(
			'**init** hook'
		);
		expect( formatHover( { contents: 'plain' } ) ).toBe( 'plain' );
		expect(
			formatHover( { contents: [ 'first', { language: 'php', value: 'function x()' } ] } )
		).toBe( 'first\n\nfunction x()' );
	} );
} );

describe( 'formatSymbols', () => {
	it( 'nests document symbols and flattens symbol information', () => {
		expect( formatSymbols( null, '/site' ) ).toBe( 'No symbols found.' );
		expect(
			formatSymbols(
				[
					{
						name: 'My_Class',
						kind: 5,
						range: range( 0 ),
						selectionRange: range( 0 ),
						children: [
							{ name: 'render', kind: 6, range: range( 3 ), selectionRange: range( 3 ) },
						],
					},
				],
				'/site'
			)
		).toBe( 'My_Class (class) — line 1\n  render (method) — line 4' );
		expect(
			formatSymbols(
				[ { name: 'my_func', kind: 12, location: location( 'file:///site/i.php', 6 ) } ],
				'/site'
			)
		).toBe( 'my_func (function) — i.php:7' );
	} );
} );

describe( 'formatCallHierarchy', () => {
	it( 'labels empty results by direction and lists callers', () => {
		expect( formatCallHierarchy( null, 'incoming', '/site' ) ).toBe( 'No incoming calls.' );
		expect( formatCallHierarchy( [], 'outgoing', '/site' ) ).toBe( 'No outgoing calls.' );
		expect(
			formatCallHierarchy(
				[
					{
						from: {
							name: 'do_action(init)',
							kind: 24,
							uri: 'file:///site/hooks.php',
							range: range( 11 ),
							selectionRange: range( 11 ),
						},
						fromRanges: [ range( 11 ) ],
					},
				],
				'incoming',
				'/site'
			)
		).toBe( 'do_action(init) (event) — hooks.php:12' );
	} );
} );

describe( 'formatDiagnostics', () => {
	it( 'renders severity, 1-based line, message, and code', () => {
		expect(
			formatDiagnosticLine( {
				range: range( 4 ),
				severity: 2,
				code: 'unknown-hook',
				message: "Unknown hook 'ini'. Did you mean 'init'?",
			} )
		).toBe( "Warning line 5: Unknown hook 'ini'. Did you mean 'init'? [unknown-hook]" );
		expect( formatDiagnostics( [] ) ).toBe( 'No problems reported.' );
	} );
} );
