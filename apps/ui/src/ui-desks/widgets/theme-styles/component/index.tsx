import { __ } from '@wordpress/i18n';
import styles from './style.module.css';
import type { ThemeStylesWidgetProps } from '../types';
import type { ThemePaletteEntry } from '@/ui-desks/widgets/theme/api';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

export function ThemeStylesWidgetComponent( {
	id,
	widgetProps,
}: DeskWidgetComponentProps< ThemeStylesWidgetProps > ) {
	return (
		<section
			className={ styles.card }
			data-studio-desk-widget="theme-styles"
			data-studio-desk-widget-id={ id }
		>
			<StylesPreview widgetProps={ widgetProps } />
		</section>
	);
}

export function ThemeStylesWidgetThumbnailComponent( {
	widgetProps,
}: DeskWidgetThumbnailComponentProps< ThemeStylesWidgetProps > ) {
	return (
		<section className={ styles.thumbnail }>
			<StylesPreview widgetProps={ widgetProps } />
		</section>
	);
}

function StylesPreview( { widgetProps }: { widgetProps: ThemeStylesWidgetProps } ) {
	const accents = pickAccentDots( widgetProps.palette );
	const bands = pickBackdropBands( widgetProps.palette );

	return (
		<div className={ styles.preview } style={ { background: widgetProps.backgroundColor } }>
			<div className={ styles.backdrop } aria-hidden>
				{ bands.map( ( color, index ) => (
					<div key={ `${ color }-${ index }` } style={ { background: color } } />
				) ) }
			</div>
			<div className={ styles.content }>
				<div
					className={ styles.sample }
					style={ { color: widgetProps.textColor, fontFamily: widgetProps.fontFamily } }
				>
					Aa
				</div>
				<div className={ styles.dots } aria-label={ __( 'Theme colors' ) }>
					{ accents.map( ( color, index ) => (
						<span key={ `${ color }-${ index }` } style={ { background: color } } />
					) ) }
				</div>
			</div>
		</div>
	);
}

function pickAccentDots( palette: ThemePaletteEntry[] ): string[] {
	const colors: string[] = [];
	const preferred = [ 'primary', 'secondary', 'accent', 'accent-1', 'accent-2' ];
	for ( const slug of preferred ) {
		const color = palette.find( ( entry ) => entry.slug === slug )?.color;
		if ( color && ! colors.includes( color ) ) {
			colors.push( color );
		}
		if ( colors.length >= 2 ) {
			break;
		}
	}

	if ( colors.length < 2 ) {
		for ( const entry of palette ) {
			if (
				entry.slug === 'background' ||
				entry.slug === 'base' ||
				colors.includes( entry.color )
			) {
				continue;
			}
			colors.push( entry.color );
			if ( colors.length >= 2 ) {
				break;
			}
		}
	}

	while ( colors.length < 2 ) {
		colors.push( '#111111' );
	}
	return colors;
}

function pickBackdropBands( palette: ThemePaletteEntry[] ): string[] {
	const colors: string[] = [];
	for ( const entry of palette ) {
		if ( ! colors.includes( entry.color ) ) {
			colors.push( entry.color );
		}
		if ( colors.length >= 4 ) {
			break;
		}
	}

	const fallback = [ '#ffffff', '#111111', '#f4f4f4', '#cccccc' ];
	while ( colors.length < 4 ) {
		colors.push( fallback[ colors.length ] );
	}
	return colors;
}
