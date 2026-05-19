import { __ } from '@wordpress/i18n';
import { blockDefault } from '@wordpress/icons';
import {
	ThemePatternWidgetComponent,
	ThemePatternWidgetThumbnailComponent,
} from '@/ui-desks/widgets/theme-pattern/component';
import {
	isThemePatternWidgetProps,
	THEME_PATTERN_WIDGET_TYPE,
	type ThemePatternWidget,
} from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const themePatternWidgetDefinition = {
	type: THEME_PATTERN_WIDGET_TYPE,
	name: () => __( 'Theme pattern' ),
	Component: ThemePatternWidgetComponent,
	thumbnail: ThemePatternWidgetThumbnailComponent,
	isCreatable: false,
	requiresRunningSite: true,
	isWidgetProps: isThemePatternWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 18,
		stroke: 'color-mix(in srgb, #3858e9 45%, white)',
	} ),
	labels: {
		add: () => __( 'Theme pattern' ),
		edit: () => __( 'Edit pattern' ),
	},
	icon: blockDefault,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 220,
			h: 160,
		},
		widgetProps: {
			patternId: '',
			title: __( 'Pattern' ),
			content: '',
			source: 'theme',
		},
	} ),
	getSummary: ( widgetProps ) => widgetProps.title,
	getEditAction: ( { widget, hasSiteId, hasRunningSite } ) => {
		if ( ! hasSiteId || ! hasRunningSite ) {
			return null;
		}

		if ( widget.widgetProps.source === 'reusable' && widget.widgetProps.blockId ) {
			return {
				kind: 'site-url',
				path: `/wp-admin/post.php?post=${ widget.widgetProps.blockId }&action=edit`,
			};
		}

		if ( widget.widgetProps.source === 'template-part' ) {
			return {
				kind: 'site-url',
				path: `/wp-admin/site-editor.php?postType=wp_template_part&postId=${ encodeURIComponent(
					widget.widgetProps.patternId
				) }&canvas=edit`,
			};
		}

		return {
			kind: 'site-url',
			path: '/wp-admin/site-editor.php?p=/pattern',
		};
	},
} satisfies WidgetDefinition< ThemePatternWidget >;
