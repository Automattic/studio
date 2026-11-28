import type { CSSProperties } from 'react';

function luminance( rgb: number[] ) {
	return rgb.reduce( ( total, value, index ) => {
		const channel = value / 255;
		const linear = channel <= 0.04045 ? channel / 12.92 : ( ( channel + 0.055 ) / 1.055 ) ** 2.4;
		return total + linear * [ 0.2126, 0.7152, 0.0722 ][ index ];
	}, 0 );
}

function contrast( first: number[], second: number[] ) {
	const a = luminance( first );
	const b = luminance( second );
	return ( Math.max( a, b ) + 0.05 ) / ( Math.min( a, b ) + 0.05 );
}

const cssColor = ( color: number[] ) => `rgb(${ color.map( Math.round ).join( ' ' ) })`;
const mix = ( from: number[], to: number[], amount: number ) =>
	from.map( ( channel, index ) => Math.round( channel * ( 1 - amount ) + to[ index ] * amount ) );

export type PreviewThemeStyle = CSSProperties & {
	'--preview-theme-background': string;
	'--preview-theme-color-scheme': 'light' | 'dark';
	'--preview-theme-interaction-chroma': number;
	'--preview-theme-foreground': string;
	'--preview-theme-controls-foreground': string;
	'--preview-theme-divider': string;
	'--preview-theme-popup': string;
	'--preview-theme-muted-foreground': string;
};

export function getPreviewThemeStyle( color: string | null ): PreviewThemeStyle | undefined {
	if ( ! color || ! /^#[\da-f]{6}$/i.test( color ) ) return undefined;
	const background = [ 1, 3, 5 ].map( ( index ) =>
		parseInt( color.slice( index, index + 2 ), 16 )
	);
	if (
		background.every( ( channel ) => channel >= 235 ) ||
		background.every( ( channel ) => channel <= 40 )
	) {
		return undefined;
	}
	const black = [ 0, 0, 0 ];
	const white = [ 255, 255, 255 ];
	const darkContrast = contrast( background, black );
	const lightContrast = contrast( background, white );
	if ( Math.max( darkContrast, lightContrast ) < 4.7 ) return undefined;
	const darkText = darkContrast >= lightContrast;
	const extreme = darkText ? black : white;
	const preferred = darkText ? [ 28, 28, 28 ] : [ 245, 245, 245 ];
	const saturation = Math.max(
		0,
		Math.min( 1, ( Math.max( darkContrast, lightContrast ) - 9 ) / 5 )
	);
	const shade = ( color: number[], amount: number ) => {
		const brightest = Math.max( ...color );
		const brighterValue = Math.min(
			255,
			brightest + Math.max( brightest * amount * 2, 255 * amount * 0.6 )
		);
		const brighter =
			brightest === 255
				? mix( color, white, amount )
				: brightest
				? color.map( ( channel ) => Math.round( ( channel * brighterValue ) / brightest ) )
				: white.map( () => Math.round( brighterValue ) );
		const darker = mix( color, black, amount );
		const toward = darkText ? darker : brighter;
		return contrast( toward, extreme ) >= 4.5 ? toward : darkText ? brighter : darker;
	};
	const originalPopup = mix( background, preferred, 0.115 );
	const safePopup =
		contrast( originalPopup, extreme ) >= 4.5
			? originalPopup
			: mix( background, darkText ? white : black, 0.115 );
	const popup = mix( safePopup, shade( background, darkText ? 0.07 : 0.2 ), saturation );
	const divider = shade( background, 0.08 );
	const foreground = extreme;
	const softenedControls = mix( foreground, background, 0.35 );
	const controls = contrast( softenedControls, background ) >= 7.5 ? softenedControls : foreground;
	const softenedMuted = mix( foreground, popup, 0.2 );
	const muted = contrast( softenedMuted, popup ) >= 7.5 ? softenedMuted : foreground;
	return {
		'--preview-theme-background': color,
		'--preview-theme-color-scheme': darkText ? 'light' : 'dark',
		'--preview-theme-interaction-chroma': 1 + saturation * 0.35,
		'--preview-theme-foreground': cssColor( foreground ),
		'--preview-theme-controls-foreground': cssColor( controls ),
		'--preview-theme-divider': cssColor( divider ),
		'--preview-theme-popup': cssColor( popup ),
		'--preview-theme-muted-foreground': cssColor( muted ),
	};
}
