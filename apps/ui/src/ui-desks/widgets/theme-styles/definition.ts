import { __ } from '@wordpress/i18n';
import { category } from '@wordpress/icons';
import {
	ThemeStylesWidgetComponent,
	ThemeStylesWidgetThumbnailComponent,
} from '@/ui-desks/widgets/theme-styles/component';
import { DEFAULT_THEME_STYLES_WIDGET_PROPS } from '@/ui-desks/widgets/theme-styles/defaults';
import { ThemeStylesPaletteControl } from '@/ui-desks/widgets/theme-styles/palette-control';
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
	isCreatable: true,
	requiresRunningSite: true,
	shouldStartEditingOnCreate: false,
	isWidgetProps: isThemeStylesWidgetProps,
	controls: [
		{
			type: 'custom',
			id: 'theme-styles-colors',
			Component: ThemeStylesPaletteControl,
		},
	],
	getIndicator: () => ( {
		cornerRadius: 18,
		stroke: 'color-mix(in srgb, #3858e9 45%, white)',
	} ),
	labels: {
		add: () => __( 'New style card' ),
		edit: () => __( 'Styles' ),
	},
	icon: category,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 280,
			h: 200,
		},
		widgetProps: DEFAULT_THEME_STYLES_WIDGET_PROPS,
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
