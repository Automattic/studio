import { __ } from '@wordpress/i18n';
import { page } from '@wordpress/icons';
import { BlogWidgetComponent } from '@/ui-desks/widgets/blog/component';
import { BLOG_WIDGET_TYPE, isBlogWidgetProps, type BlogWidget } from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

const BLOG_COLOR = '#8703e7';

export const blogWidgetDefinition = {
	type: BLOG_WIDGET_TYPE,
	Component: BlogWidgetComponent,
	isCreatable: false,
	requiresRunningSite: true,
	isWidgetProps: isBlogWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 18,
		stroke: `color-mix(in srgb, ${ BLOG_COLOR } 50%, white)`,
	} ),
	labels: {
		add: () => __( 'Blog' ),
	},
	icon: page,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 280,
			h: 380,
		},
		widgetProps: {
			title: __( 'Blog' ),
		},
	} ),
} satisfies WidgetDefinition< BlogWidget >;
