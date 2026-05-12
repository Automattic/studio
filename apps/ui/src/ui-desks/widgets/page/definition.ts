import { __, sprintf } from '@wordpress/i18n';
import { page } from '@wordpress/icons';
import { PageWidgetComponent } from '@/ui-desks/widgets/page/component';
import { isPageWidgetProps, PAGE_WIDGET_TYPE, type PageTone, type PageWidget } from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

const PAGE_TONE_COLORS: Record< PageTone, string > = {
	neutral: '#14171a',
	orange: '#e86a00',
	red: '#e5484d',
	violet: '#8703e7',
	blue: '#2200e0',
	sky: '#0081f3',
	green: '#00a96c',
};

const PAGE_TONE_OPTIONS: Array< { value: PageTone; label: string; color: string } > = [
	{ value: 'neutral', label: __( 'Default' ), color: PAGE_TONE_COLORS.neutral },
	{ value: 'orange', label: __( 'Orange' ), color: PAGE_TONE_COLORS.orange },
	{ value: 'red', label: __( 'Red' ), color: PAGE_TONE_COLORS.red },
	{ value: 'violet', label: __( 'Violet' ), color: PAGE_TONE_COLORS.violet },
	{ value: 'blue', label: __( 'Blue' ), color: PAGE_TONE_COLORS.blue },
	{ value: 'sky', label: __( 'Sky' ), color: PAGE_TONE_COLORS.sky },
	{ value: 'green', label: __( 'Green' ), color: PAGE_TONE_COLORS.green },
];

export const pageWidgetDefinition = {
	type: PAGE_WIDGET_TYPE,
	name: () => __( 'Page' ),
	Component: PageWidgetComponent,
	controls: [
		{
			type: 'color',
			id: 'tone',
			property: 'tone',
			label: __( 'Color' ),
			options: PAGE_TONE_OPTIONS,
		},
	],
	isCreatable: false,
	requiresRunningSite: true,
	isWidgetProps: isPageWidgetProps,
	getIndicator: ( widgetProps ) => {
		const color = PAGE_TONE_COLORS[ widgetProps.tone ];
		return {
			cornerRadius: 18,
			stroke: `color-mix(in srgb, ${ color } 50%, white)`,
		};
	},
	labels: {
		add: () => __( 'Add existing page…' ),
		edit: () => __( 'Edit in WP' ),
	},
	icon: page,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 280,
			h: 380,
		},
		widgetProps: {
			pageId: 0,
			tone: 'neutral',
		},
	} ),
	getSummary: ( widgetProps ) =>
		sprintf(
			/* translators: %d: WordPress page ID. */
			__( 'Page #%d' ),
			widgetProps.pageId
		),
	getEditAction: ( { widget, hasSiteId, hasRunningSite } ) =>
		hasSiteId && hasRunningSite && widget.widgetProps.pageId > 0
			? {
					kind: 'site-url',
					path: `/wp-admin/post.php?post=${ widget.widgetProps.pageId }&action=edit`,
			  }
			: null,
} satisfies WidgetDefinition< PageWidget >;
