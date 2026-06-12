/* eslint-disable no-control-regex */
import chalk from '@studio/common/lib/chalk';
import { renderBannerBox } from 'cli/lib/banner-box';

const strip = ( s: string ) => s.replace( /\u001B\[[0-9;]*m/g, '' );

// Studio's chalk emits no ANSI codes when stdout is not a TTY (as in tests),
// so colored lines are built manually to exercise the ANSI-stripping path.
const green = ( s: string ) => `\u001B[32m${ s }\u001B[39m`;

describe( 'renderBannerBox', () => {
	it( 'wraps lines in a rounded box', () => {
		const plain = strip( renderBannerBox( [ 'hello', 'world' ], chalk.yellow ) );
		expect( plain ).toContain( '╭' );
		expect( plain ).toContain( '╰' );
		expect( plain ).toContain( '│' );
		expect( plain ).toContain( 'hello' );
		expect( plain ).toContain( 'world' );
	} );

	it( 'pads all rows to the same visible width', () => {
		const plain = strip( renderBannerBox( [ 'a', 'longer line' ], chalk.yellow ) );
		const rows = plain.split( '\n' ).filter( ( l ) => l.length > 0 );
		const widths = new Set( rows.map( ( r ) => [ ...r ].length ) );
		expect( widths.size ).toBe( 1 );
	} );

	it( 'pads colored lines to the same width as plain lines', () => {
		const plain = strip( renderBannerBox( [ green( 'colored' ), 'plain..' ], chalk.yellow ) );
		const rows = plain.split( '\n' ).filter( ( l ) => l.length > 0 );
		const widths = new Set( rows.map( ( r ) => [ ...r ].length ) );
		expect( widths.size ).toBe( 1 );
	} );

	it( 'applies borderColor to the border but not the content', () => {
		const marker = ( s: string ) => `<${ s }>`;
		const out = renderBannerBox( [ 'hello' ], marker );
		expect( out ).toContain( '<│>' );
		expect( out ).toMatch( /<╭─+╮>/ );
		expect( out ).not.toContain( '<hello>' );
	} );
} );
