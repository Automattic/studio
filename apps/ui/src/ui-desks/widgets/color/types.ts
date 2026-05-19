import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { DeskWidgetBase } from '@studio/common/types/desk';

export const COLOR_WIDGET_TYPE = 'color';
export const COLOR_WIDGET_DRAG_MIME_TYPE = 'application/x-studio-desk-color';
export const COLOR_WIDGET_DRAG_TITLE_MIME_TYPE = 'application/x-studio-desk-color-title';

export type ColorFormat = 'hex' | 'rgb' | 'hsl';

export type ColorWidgetProps = {
	color: string;
	title?: string;
	format?: ColorFormat;
};

export type ColorWidget = DeskWidgetBase<
	typeof COLOR_WIDGET_TYPE,
	RectangleWidgetShapeProps,
	ColorWidgetProps
>;

export function isColorWidgetProps( value: unknown ): value is ColorWidgetProps {
	const candidate = value as Partial< ColorWidgetProps >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		isHexColor( candidate.color ) &&
		( candidate.title === undefined || typeof candidate.title === 'string' ) &&
		( candidate.format === undefined ||
			candidate.format === 'hex' ||
			candidate.format === 'rgb' ||
			candidate.format === 'hsl' )
	);
}

export function isHexColor( value: unknown ): value is string {
	return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test( value );
}

export function parseColorToHex( input: string ): string | null {
	const trimmed = input.trim();
	if ( ! trimmed ) {
		return null;
	}

	const normalizedHex = normalizeHexColor( trimmed );
	if ( normalizedHex ) {
		return normalizedHex;
	}

	if (
		! /^#[0-9a-f]{3,8}$/i.test( trimmed ) &&
		! /^(rgb|rgba|hsl|hsla|hwb|color|oklch|oklab|lab|lch)\(/i.test( trimmed ) &&
		! NAMED_COLORS.has( trimmed.toLowerCase() )
	) {
		return null;
	}

	if ( typeof document === 'undefined' ) {
		return null;
	}

	const host = document.body ?? document.documentElement;
	if ( ! host ) {
		return null;
	}

	const element = document.createElement( 'span' );
	element.style.color = '';
	element.style.color = trimmed;
	if ( ! element.style.color ) {
		return null;
	}

	host.appendChild( element );
	const computedColor = getComputedStyle( element ).color;
	host.removeChild( element );

	const match = computedColor.match( /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i );
	if ( ! match ) {
		return null;
	}

	return rgbToHex(
		Math.round( Number( match[ 1 ] ) ),
		Math.round( Number( match[ 2 ] ) ),
		Math.round( Number( match[ 3 ] ) )
	);
}

function normalizeHexColor( value: string ) {
	const match = value.match( /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i );
	if ( ! match ) {
		return null;
	}

	let hex = match[ 1 ].toLowerCase();
	if ( hex.length === 3 || hex.length === 4 ) {
		hex = hex
			.slice( 0, 3 )
			.split( '' )
			.map( ( character ) => character + character )
			.join( '' );
	}

	return `#${ hex.slice( 0, 6 ) }`;
}

function rgbToHex( red: number, green: number, blue: number ) {
	return (
		'#' +
		[ red, green, blue ]
			.map( ( value ) => Math.max( 0, Math.min( 255, value ) ).toString( 16 ).padStart( 2, '0' ) )
			.join( '' )
	);
}

const NAMED_COLORS = new Set( [
	'aqua',
	'black',
	'blue',
	'cyan',
	'fuchsia',
	'gray',
	'grey',
	'green',
	'lime',
	'magenta',
	'maroon',
	'navy',
	'olive',
	'orange',
	'pink',
	'purple',
	'red',
	'silver',
	'teal',
	'white',
	'yellow',
	'transparent',
	'currentcolor',
] );
