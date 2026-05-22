import { useMemo } from 'react';
import { getPageToneDitherFilterId, PAGE_TONE_COLORS } from './tone';
import type { PageTone } from './types';

let cachedDotTileUri: string | null = null;

function getDotTileUri(): string {
	if ( cachedDotTileUri !== null ) {
		return cachedDotTileUri;
	}
	if ( typeof document === 'undefined' ) {
		return '';
	}

	const size = 8;
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext( '2d' );
	if ( ! context ) {
		return '';
	}

	context.fillStyle = '#000';
	context.fillRect( 0, 0, size, size );
	const gradient = context.createRadialGradient(
		size / 2,
		size / 2,
		0,
		size / 2,
		size / 2,
		size / 2
	);
	gradient.addColorStop( 0, '#fff' );
	gradient.addColorStop( 1, '#000' );
	context.fillStyle = gradient;
	context.fillRect( 0, 0, size, size );
	cachedDotTileUri = canvas.toDataURL( 'image/png' );
	return cachedDotTileUri;
}

const DITHER_TONES = Object.keys( PAGE_TONE_COLORS ).filter(
	( tone ): tone is Exclude< PageTone, 'neutral' > => tone !== 'neutral'
);
const INK_LIGHTEN = 0.25;

export function PageDitherFilters() {
	const tileUri = useMemo( () => getDotTileUri(), [] );

	return (
		<svg
			width="0"
			height="0"
			style={ { position: 'absolute', pointerEvents: 'none' } }
			aria-hidden="true"
			focusable="false"
		>
			<defs>
				{ DITHER_TONES.map( ( tone ) => {
					const rgb = hexToRgbUnit( PAGE_TONE_COLORS[ tone ] );
					const ink = lighten( rgb );
					return (
						<filter
							key={ tone }
							id={ getPageToneDitherFilterId( tone ) ?? undefined }
							x="0"
							y="0"
							width="1"
							height="1"
							filterUnits="objectBoundingBox"
							primitiveUnits="objectBoundingBox"
							colorInterpolationFilters="sRGB"
						>
							<feColorMatrix
								in="SourceGraphic"
								type="matrix"
								values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"
								result="gray"
							/>
							<feImage
								href={ tileUri }
								x="0"
								y="0"
								width="0.018"
								height="0.036"
								result="ditherTile"
							/>
							<feTile in="ditherTile" result="tile" />
							<feComposite
								in="gray"
								in2="tile"
								operator="arithmetic"
								k1="0"
								k2="1"
								k3="-1"
								k4="0.55"
								result="halftone"
							/>
							<feComponentTransfer in="halftone">
								<feFuncR type="discrete" tableValues={ `${ ink[ 0 ] } 1` } />
								<feFuncG type="discrete" tableValues={ `${ ink[ 1 ] } 1` } />
								<feFuncB type="discrete" tableValues={ `${ ink[ 2 ] } 1` } />
							</feComponentTransfer>
						</filter>
					);
				} ) }
			</defs>
		</svg>
	);
}

function hexToRgbUnit( hex: string ): [ number, number, number ] {
	const value = hex.replace( '#', '' );
	return [
		parseInt( value.slice( 0, 2 ), 16 ) / 255,
		parseInt( value.slice( 2, 4 ), 16 ) / 255,
		parseInt( value.slice( 4, 6 ), 16 ) / 255,
	];
}

function lighten( rgb: [ number, number, number ] ): [ number, number, number ] {
	return rgb.map( ( channel ) => channel * ( 1 - INK_LIGHTEN ) + INK_LIGHTEN ) as [
		number,
		number,
		number,
	];
}
