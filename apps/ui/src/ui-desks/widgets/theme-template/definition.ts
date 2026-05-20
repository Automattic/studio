import { __ } from '@wordpress/i18n';
import { page } from '@wordpress/icons';
import {
	ThemeTemplateWidgetComponent,
	ThemeTemplateWidgetThumbnailComponent,
} from '@/ui-desks/widgets/theme-template/component';
import {
	isThemeTemplateWidgetProps,
	THEME_TEMPLATE_WIDGET_TYPE,
	type ThemeTemplateWidget,
} from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const themeTemplateWidgetDefinition = {
	type: THEME_TEMPLATE_WIDGET_TYPE,
	name: () => __( 'Theme template' ),
	Component: ThemeTemplateWidgetComponent,
	thumbnail: ThemeTemplateWidgetThumbnailComponent,
	isCreatable: false,
	requiresRunningSite: true,
	isWidgetProps: isThemeTemplateWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 18,
		stroke: 'color-mix(in srgb, #1147b7 50%, white)',
	} ),
	labels: {
		add: () => __( 'Theme template' ),
		edit: () => __( 'Edit template' ),
	},
	icon: page,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 220,
			h: 160,
		},
		widgetProps: {
			templateId: '',
			slug: '',
			title: __( 'Template' ),
			description: '',
			source: 'theme',
		},
	} ),
	getSummary: ( widgetProps ) => widgetProps.slug || widgetProps.title,
	getEditAction: ( { widget, hasSiteId, hasRunningSite } ) =>
		hasSiteId && hasRunningSite && widget.widgetProps.templateId
			? {
					kind: 'site-url',
					path: `/wp-admin/site-editor.php?postType=wp_template&postId=${ encodeURIComponent(
						widget.widgetProps.templateId
					) }&canvas=edit`,
			  }
			: null,
} satisfies WidgetDefinition< ThemeTemplateWidget >;
