import { __ } from '@wordpress/i18n';
import { useDesk } from '@/ui-desks/desk/provider';
import styles from './palette-control.module.css';
import {
	createThemeStylesPaletteTemporaryDesk,
	getColorPaletteEntries,
	getThemeStylesPaletteTemporaryDeskId,
} from './palette-editor';
import {
	isThemeStylesWidgetProps,
	THEME_STYLES_WIDGET_TYPE,
	type ThemeStylesWidget,
	type ThemeStylesWidgetProps,
} from './types';
import type { ControlRenderContext } from '@/ui-desks/controls/types';

export function ThemeStylesPaletteControl( {
	props,
}: ControlRenderContext< ThemeStylesWidgetProps > ) {
	const { isTemporaryDeskVisible, selectedWidgetToolbarItem, toggleTemporaryDesk } = useDesk();
	const palette = getColorPaletteEntries( props.palette );
	const sourceWidget = getSelectedThemeStylesWidget( selectedWidgetToolbarItem );
	const temporaryDeskId = sourceWidget
		? getThemeStylesPaletteTemporaryDeskId( sourceWidget.id )
		: null;
	const isActive = temporaryDeskId ? isTemporaryDeskVisible( temporaryDeskId ) : false;

	if ( palette.length === 0 ) {
		return null;
	}

	return (
		<button
			type="button"
			className={ styles.button }
			data-active={ isActive ? 'true' : 'false' }
			onClick={ () => {
				if ( ! sourceWidget ) {
					return;
				}
				const temporaryDesk = createThemeStylesPaletteTemporaryDesk( sourceWidget );
				if ( temporaryDesk ) {
					toggleTemporaryDesk( {
						...temporaryDesk,
						sourceWidgetId: sourceWidget.id,
						followSource: true,
					} );
				}
			} }
		>
			{ __( 'Colors' ) }
		</button>
	);
}

function getSelectedThemeStylesWidget(
	selectedWidgetToolbarItem: ReturnType< typeof useDesk >[ 'selectedWidgetToolbarItem' ]
) {
	if (
		selectedWidgetToolbarItem?.kind !== 'single-widget' ||
		selectedWidgetToolbarItem.widget.type !== THEME_STYLES_WIDGET_TYPE ||
		! isThemeStylesWidgetProps( selectedWidgetToolbarItem.widget.widgetProps )
	) {
		return null;
	}

	return selectedWidgetToolbarItem.widget as ThemeStylesWidget;
}
