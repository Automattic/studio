import { __ } from '@wordpress/i18n';
import { page } from '@wordpress/icons';
import {
	BlogWidgetComponent,
	BlogWidgetThumbnailComponent,
} from '@/ui-desks/widgets/blog/component';
import { BLOG_WIDGET_TYPE, isBlogWidgetProps, type BlogWidget } from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

const BLOG_COLOR = '#8703e7';

export const blogWidgetDefinition = {
	type: BLOG_WIDGET_TYPE,
	name: () => __( 'Blog' ),
	Component: BlogWidgetComponent,
	thumbnail: BlogWidgetThumbnailComponent,
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
	getSummary: ( widgetProps ) =>
		widgetProps.slug ? `${ widgetProps.title } /${ widgetProps.slug }` : widgetProps.title,
} satisfies WidgetDefinition< BlogWidget >;
