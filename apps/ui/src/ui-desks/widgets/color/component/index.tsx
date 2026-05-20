import { __ } from '@wordpress/i18n';
import {
	COLOR_WIDGET_DRAG_MIME_TYPE,
	COLOR_WIDGET_DRAG_TITLE_MIME_TYPE,
	type ColorFormat,
	type ColorWidgetProps,
} from '../types';
import styles from './style.module.css';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';
import type { CSSProperties, DragEvent, MouseEvent, PointerEvent } from 'react';

export function ColorWidgetComponent( {
	id,
	widgetProps,
	isTemporary = false,
	onWidgetPropsChange,
}: DeskWidgetComponentProps< ColorWidgetProps > ) {
	const format = getColorFormat( widgetProps );
	const parts = formatColorParts( widgetProps.color, format );

	function cycleFormat( event: MouseEvent< HTMLButtonElement > ) {
		event.stopPropagation();
		onWidgetPropsChange( {
			...widgetProps,
			format: nextFormat( format ),
		} );
	}

	return (
		<ColorCard
			id={ id }
			widgetProps={ widgetProps }
			parts={ parts }
			isDraggable={ isTemporary }
			onCycleFormat={ cycleFormat }
		/>
	);
}

export function ColorWidgetThumbnailComponent( {
	id,
	widgetProps,
}: DeskWidgetThumbnailComponentProps< ColorWidgetProps > ) {
	return (
		<ColorCard
			id={ id }
			widgetProps={ widgetProps }
			parts={ formatColorParts( widgetProps.color, getColorFormat( widgetProps ) ) }
		/>
	);
}

function ColorCard( {
	id,
	widgetProps,
	parts,
	isDraggable = false,
	onCycleFormat,
}: {
	id?: string;
	widgetProps: ColorWidgetProps;
	parts: { label: string | null; values: string };
	isDraggable?: boolean;
	onCycleFormat?: ( event: MouseEvent< HTMLButtonElement > ) => void;
} ) {
	function handleDragStart( event: DragEvent< HTMLDivElement > ) {
		if ( ! isDraggable ) {
			return;
		}

		event.stopPropagation();
		event.dataTransfer.effectAllowed = 'copy';
		event.dataTransfer.setData( COLOR_WIDGET_DRAG_MIME_TYPE, widgetProps.color );
		event.dataTransfer.setData( COLOR_WIDGET_DRAG_TITLE_MIME_TYPE, widgetProps.title ?? '' );
		event.dataTransfer.setData( 'text/plain', widgetProps.color );
	}

	return (
		<div
			className={ styles.card }
			draggable={ isDraggable }
			onDragStart={ handleDragStart }
			style={
				{
					background: widgetProps.color,
					'--sd-color-ink': contrastingShade( widgetProps.color ),
				} as CSSProperties
			}
			data-studio-desk-widget="color"
			data-studio-desk-widget-id={ id }
		>
			{ widgetProps.title && <span className={ styles.title }>{ widgetProps.title }</span> }
			<button
				type="button"
				className={ styles.value }
				title={ __( 'Click to cycle hex, rgb, and hsl' ) }
				onClick={ onCycleFormat }
				onPointerDown={ stopPropagation }
			>
				{ parts.label && <span className={ styles.valueLabel }>{ parts.label }</span> }
				<span className={ styles.valueText }>{ parts.values }</span>
			</button>
		</div>
	);
}

function stopPropagation( event: PointerEvent< HTMLButtonElement > ) {
	event.stopPropagation();
}

function getColorFormat( props: ColorWidgetProps ): ColorFormat {
	return props.format === 'rgb' || props.format === 'hsl' ? props.format : 'hex';
}

function nextFormat( format: ColorFormat ): ColorFormat {
	if ( format === 'hex' ) {
		return 'rgb';
	}
	return format === 'rgb' ? 'hsl' : 'hex';
}

export function formatColor( hex: string, format: ColorFormat ): string {
	if ( format === 'hex' ) {
		return hex;
	}

	const rgb = hexToRgb( hex );
	if ( ! rgb ) {
		return hex;
	}

	if ( format === 'rgb' ) {
		return `rgb(${ rgb[ 0 ] }, ${ rgb[ 1 ] }, ${ rgb[ 2 ] })`;
	}

	const [ hue, saturation, lightness ] = rgbToHsl( rgb[ 0 ], rgb[ 1 ], rgb[ 2 ] );
	return `hsl(${ Math.round( hue * 360 ) }, ${ Math.round( saturation * 100 ) }%, ${ Math.round(
		lightness * 100
	) }%)`;
}

function formatColorParts(
	hex: string,
	format: ColorFormat
): { label: string | null; values: string } {
	if ( format === 'hex' ) {
		return { label: null, values: hex };
	}

	const rgb = hexToRgb( hex );
	if ( ! rgb ) {
		return { label: null, values: hex };
	}

	if ( format === 'rgb' ) {
		return { label: 'rgb', values: `${ rgb[ 0 ] }, ${ rgb[ 1 ] }, ${ rgb[ 2 ] }` };
	}

	const [ hue, saturation, lightness ] = rgbToHsl( rgb[ 0 ], rgb[ 1 ], rgb[ 2 ] );
	return {
		label: 'hsl',
		values: `${ Math.round( hue * 360 ) }, ${ Math.round( saturation * 100 ) }%, ${ Math.round(
			lightness * 100
		) }%`,
	};
}

export function contrastingShade( color: string ) {
	const rgb = hexToRgb( color );
	if ( ! rgb ) {
		return '#000000';
	}

	const [ hue, saturation, lightness ] = rgbToHsl( rgb[ 0 ], rgb[ 1 ], rgb[ 2 ] );
	const targetLightness =
		lightness > 0.5 ? Math.max( 0.1, lightness - 0.45 ) : Math.min( 0.93, lightness + 0.45 );
	const [ red, green, blue ] = hslToRgb( hue, saturation, targetLightness );
	return rgbToHex( red, green, blue );
}

export function indicatorShade( color: string ) {
	const rgb = hexToRgb( color );
	if ( ! rgb ) {
		return '#666666';
	}

	const [ hue, saturation, lightness ] = rgbToHsl( rgb[ 0 ], rgb[ 1 ], rgb[ 2 ] );
	const targetLightness =
		lightness > 0.15 ? Math.max( 0.05, lightness - 0.18 ) : Math.min( 0.95, lightness + 0.22 );
	const [ red, green, blue ] = hslToRgb( hue, saturation, targetLightness );
	return rgbToHex( red, green, blue );
}

function hexToRgb( hex: string ): [ number, number, number ] | null {
	const match = hex
		.trim()
		.replace( '#', '' )
		.match( /^([0-9a-f]{6})$/i );
	if ( ! match ) {
		return null;
	}

	return [
		parseInt( match[ 1 ].slice( 0, 2 ), 16 ),
		parseInt( match[ 1 ].slice( 2, 4 ), 16 ),
		parseInt( match[ 1 ].slice( 4, 6 ), 16 ),
	];
}

function rgbToHsl( red: number, green: number, blue: number ): [ number, number, number ] {
	const redRatio = red / 255;
	const greenRatio = green / 255;
	const blueRatio = blue / 255;
	const max = Math.max( redRatio, greenRatio, blueRatio );
	const min = Math.min( redRatio, greenRatio, blueRatio );
	const lightness = ( max + min ) / 2;

	if ( max === min ) {
		return [ 0, 0, lightness ];
	}

	const delta = max - min;
	const saturation = lightness > 0.5 ? delta / ( 2 - max - min ) : delta / ( max + min );
	let hue = 0;
	if ( max === redRatio ) {
		hue = ( greenRatio - blueRatio ) / delta + ( greenRatio < blueRatio ? 6 : 0 );
	} else if ( max === greenRatio ) {
		hue = ( blueRatio - redRatio ) / delta + 2;
	} else {
		hue = ( redRatio - greenRatio ) / delta + 4;
	}

	return [ hue / 6, saturation, lightness ];
}

function hslToRgb(
	hue: number,
	saturation: number,
	lightness: number
): [ number, number, number ] {
	if ( saturation === 0 ) {
		const value = Math.round( lightness * 255 );
		return [ value, value, value ];
	}

	const q =
		lightness < 0.5
			? lightness * ( 1 + saturation )
			: lightness + saturation - lightness * saturation;
	const p = 2 * lightness - q;
	const toChannel = ( t: number ) => {
		let next = t;
		if ( next < 0 ) {
			next += 1;
		}
		if ( next > 1 ) {
			next -= 1;
		}
		if ( next < 1 / 6 ) {
			return p + ( q - p ) * 6 * next;
		}
		if ( next < 1 / 2 ) {
			return q;
		}
		if ( next < 2 / 3 ) {
			return p + ( q - p ) * ( 2 / 3 - next ) * 6;
		}
		return p;
	};

	return [
		Math.round( toChannel( hue + 1 / 3 ) * 255 ),
		Math.round( toChannel( hue ) * 255 ),
		Math.round( toChannel( hue - 1 / 3 ) * 255 ),
	];
}

function rgbToHex( red: number, green: number, blue: number ) {
	return (
		'#' +
		[ red, green, blue ]
			.map( ( value ) => Math.max( 0, Math.min( 255, value ) ).toString( 16 ).padStart( 2, '0' ) )
			.join( '' )
	);
}
