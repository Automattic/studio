import { __ } from '@wordpress/i18n';
import { globe } from '@wordpress/icons';
import { SitePreviewWidgetComponent } from '@/ui-desks/widgets/site-preview/component';
import { SitePreviewOpenControl } from '@/ui-desks/widgets/site-preview/open-control';
import {
	isSitePreviewWidgetProps,
	SITE_PREVIEW_WIDGET_TYPE,
	type SitePreviewWidget,
} from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const sitePreviewWidgetDefinition = {
	type: SITE_PREVIEW_WIDGET_TYPE,
	name: () => __( 'Preview' ),
	Component: SitePreviewWidgetComponent,
	controls: [
		{
			type: 'custom',
			id: 'open-site-preview',
			Component: SitePreviewOpenControl,
		},
	],
	isCreatable: true,
	requiresRunningSite: true,
	shouldStartEditingOnCreate: false,
	isWidgetProps: isSitePreviewWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 18,
		stroke: '#3858e9',
	} ),
	labels: {
		add: () => __( 'New site preview' ),
	},
	icon: globe,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 560,
			h: 420,
		},
		widgetProps: {
			path: '/',
		},
	} ),
	getSummary: ( widgetProps ) => widgetProps.path || '/',
} satisfies WidgetDefinition< SitePreviewWidget >;
