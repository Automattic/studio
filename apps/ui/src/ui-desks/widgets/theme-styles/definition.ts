import { __ } from '@wordpress/i18n';
import { category } from '@wordpress/icons';
import {
	ThemeStylesWidgetComponent,
	ThemeStylesWidgetThumbnailComponent,
} from '@/ui-desks/widgets/theme-styles/component';
import { ThemeStylesPaletteControl } from '@/ui-desks/widgets/theme-styles/palette-control';
import {
	moveThemeStylesPaletteWithShapeInEditor,
	THEME_STYLES_TOGGLE_PALETTE_ACTION,
	toggleThemeStylesPaletteInEditor,
} from '@/ui-desks/widgets/theme-styles/palette-editor';
import {
	isThemeStylesWidgetProps,
	THEME_STYLES_WIDGET_TYPE,
	type ThemeStylesWidget,
} from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const themeStylesWidgetDefinition = {
	type: THEME_STYLES_WIDGET_TYPE,
	name: () => __( 'Theme styles' ),
	Component: ThemeStylesWidgetComponent,
	thumbnail: ThemeStylesWidgetThumbnailComponent,
	isCreatable: false,
	requiresRunningSite: true,
	isWidgetProps: isThemeStylesWidgetProps,
	controls: [
		{
			type: 'custom',
			id: 'theme-styles-colors',
			Component: ThemeStylesPaletteControl,
		},
	],
	editorActions: {
		[ THEME_STYLES_TOGGLE_PALETTE_ACTION ]: ( { editor, shape, widget } ) =>
			toggleThemeStylesPaletteInEditor( editor, shape, widget ),
	},
	onShapeChange: ( { editor, previousShape, nextShape, widget, isDragging } ) => {
		if ( isDragging ) {
			moveThemeStylesPaletteWithShapeInEditor( editor, previousShape, nextShape, widget );
		}
	},
	getIndicator: () => ( {
		cornerRadius: 18,
		stroke: 'color-mix(in srgb, #3858e9 45%, white)',
	} ),
	labels: {
		add: () => __( 'Theme styles' ),
		edit: () => __( 'Styles' ),
	},
	icon: category,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 220,
			h: 160,
		},
		widgetProps: {
			palette: [],
			fontFamily: 'system-ui, sans-serif',
			textColor: '#111111',
			backgroundColor: '#ffffff',
		},
	} ),
	getSummary: () => __( 'Theme styles' ),
	getEditAction: ( { hasSiteId, hasRunningSite } ) =>
		hasSiteId && hasRunningSite
			? {
					kind: 'site-url',
					path: '/wp-admin/site-editor.php?path=%2Fwp_global_styles',
			  }
			: null,
} satisfies WidgetDefinition< ThemeStylesWidget >;
