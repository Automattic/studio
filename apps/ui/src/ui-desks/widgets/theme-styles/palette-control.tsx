import { __ } from '@wordpress/i18n';
import { useDesk } from '@/ui-desks/desk/provider';
import styles from './palette-control.module.css';
import { getColorPaletteEntries, THEME_STYLES_TOGGLE_PALETTE_ACTION } from './palette-editor';
import type { ThemeStylesWidgetProps } from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function ThemeStylesPaletteControl( {
	props,
	runWidgetAction,
}: ControlRenderContext< ThemeStylesWidgetProps > ) {
	const { selectedWidgetToolbarItem } = useDesk();
	const palette = getColorPaletteEntries( props.palette );
	const selectedProps =
		selectedWidgetToolbarItem?.kind === 'single-widget'
			? ( selectedWidgetToolbarItem.widget.widgetProps as Partial< ThemeStylesWidgetProps > )
			: null;
	const paletteStackId =
		props.paletteStackId ??
		( typeof selectedProps?.paletteStackId === 'string' ? selectedProps.paletteStackId : null );
	const isActive = typeof paletteStackId === 'string';

	if ( palette.length === 0 ) {
		return null;
	}

	return (
		<button
			type="button"
			className={ styles.button }
			data-active={ isActive ? 'true' : 'false' }
			onClick={ () => runWidgetAction( THEME_STYLES_TOGGLE_PALETTE_ACTION ) }
		>
			{ __( 'Colors' ) }
		</button>
	);
}
