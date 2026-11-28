import { describe, expect, it } from 'vitest';
import { getPreviewThemeStyle } from './preview-theme';

const rgb = ( value: string ) => value.match( /\d+/g )!.map( Number );
const luminance = ( channels: number[] ) =>
	channels.reduce( ( sum, value, index ) => {
		const channel = value / 255;
		return (
			sum +
			( channel <= 0.04045 ? channel / 12.92 : ( ( channel + 0.055 ) / 1.055 ) ** 2.4 ) *
				[ 0.2126, 0.7152, 0.0722 ][ index ]
		);
	}, 0 );
const contrast = ( first: number[], second: number[] ) => {
	const a = luminance( first );
	const b = luminance( second );
	return ( Math.max( a, b ) + 0.05 ) / ( Math.min( a, b ) + 0.05 );
};

describe( 'preview theme colors', () => {
	it( 'uses the existing styling when there is no validated color', () => {
		expect( getPreviewThemeStyle( null ) ).toBeUndefined();
		expect( getPreviewThemeStyle( 'red' ) ).toBeUndefined();
		expect( getPreviewThemeStyle( '#fff; color: red' ) ).toBeUndefined();
	} );

	it( 'uses the existing styling for colors close to white or black', () => {
		for ( const hex of [
			'#ffffff',
			'#f5f8ff',
			'#ebebeb',
			'#000000',
			'#111111',
			'#1d2327',
			'#282828',
		] ) {
			expect( getPreviewThemeStyle( hex ), hex ).toBeUndefined();
		}
		for ( const hex of [ '#eaeaea', '#292929', '#f6e7cc', '#4a1018' ] ) {
			expect( getPreviewThemeStyle( hex ), hex ).toBeDefined();
		}
	} );

	it( 'chooses the color scheme from the site color and falls back when contrast is marginal', () => {
		expect( getPreviewThemeStyle( '#4a1018' )?.[ '--preview-theme-color-scheme' ] ).toBe( 'dark' );
		expect( getPreviewThemeStyle( '#f6e7cc' )?.[ '--preview-theme-color-scheme' ] ).toBe( 'light' );
		expect( getPreviewThemeStyle( '#bc0afe' ) ).toBeUndefined();
	} );

	it( 'keeps the suggestion panel close to the site color while allowing for contrast', () => {
		const saturation = ( channels: number[] ) => {
			const max = Math.max( ...channels );
			return ( max - Math.min( ...channels ) ) / max;
		};
		for ( const hex of [ '#4a1018', '#142b65', '#0e4c35' ] ) {
			const background = [ 1, 3, 5 ].map( ( index ) =>
				parseInt( hex.slice( index, index + 2 ), 16 )
			);
			const style = getPreviewThemeStyle( hex )!;
			const strength = hex === '#0e4c35' ? 0.65 : 0.95;
			expect( saturation( rgb( style[ '--preview-theme-popup' ] ) ), hex ).toBeGreaterThanOrEqual(
				saturation( background ) * strength
			);
		}
	} );

	it( 'uses stronger colors when contrast allows and keeps light panels light', () => {
		expect(
			getPreviewThemeStyle( '#4a1018' )?.[ '--preview-theme-interaction-chroma' ]
		).toBeGreaterThan( 1 );
		expect( getPreviewThemeStyle( '#6666ff' )?.[ '--preview-theme-interaction-chroma' ] ).toBe( 1 );
		const light = getPreviewThemeStyle( '#f6e7cc' )!;
		expect( luminance( rgb( light[ '--preview-theme-popup' ] ) ) ).toBeGreaterThan(
			luminance( [ 246, 231, 204 ] ) * 0.8
		);
	} );

	it( 'keeps text readable on the bar and suggestion panel across the color range', () => {
		for ( const r of [ 0, 51, 102, 153, 204, 255 ] ) {
			for ( const g of [ 0, 51, 102, 153, 204, 255 ] ) {
				for ( const b of [ 0, 51, 102, 153, 204, 255 ] ) {
					const hex = `#${ [ r, g, b ]
						.map( ( value ) => value.toString( 16 ).padStart( 2, '0' ) )
						.join( '' ) }`;
					const style = getPreviewThemeStyle( hex );
					if ( ! style ) continue;
					const foreground = rgb( style[ '--preview-theme-foreground' ] );
					const controls = rgb( style[ '--preview-theme-controls-foreground' ] );
					const popup = rgb( style[ '--preview-theme-popup' ] );
					const muted = rgb( style[ '--preview-theme-muted-foreground' ] );
					expect( contrast( foreground, [ r, g, b ] ), hex ).toBeGreaterThanOrEqual( 4.5 );
					expect( contrast( controls, [ r, g, b ] ), hex ).toBeGreaterThanOrEqual( 4.5 );
					expect( contrast( foreground, popup ), hex ).toBeGreaterThanOrEqual( 4.5 );
					expect( contrast( muted, popup ), hex ).toBeGreaterThanOrEqual( 4.5 );
				}
			}
		}
	} );
} );
