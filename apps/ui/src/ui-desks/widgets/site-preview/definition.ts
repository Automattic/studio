import { __ } from '@wordpress/i18n';
import { globe } from '@wordpress/icons';
import { SitePreviewAnnotateControl } from '@/ui-desks/widgets/site-preview/annotate-control';
import {
	SitePreviewWidgetComponent,
	SitePreviewWidgetThumbnailComponent,
} from '@/ui-desks/widgets/site-preview/component';
import { SitePreviewInspectControl } from '@/ui-desks/widgets/site-preview/inspect-control';
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
	thumbnail: SitePreviewWidgetThumbnailComponent,
	controls: [
		{
			type: 'custom',
			id: 'open-site-preview',
			Component: SitePreviewOpenControl,
		},
		{
			type: 'custom',
			id: 'inspect-site-preview',
			Component: SitePreviewInspectControl,
		},
		{
			type: 'custom',
			id: 'annotate-site-preview',
			Component: SitePreviewAnnotateControl,
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
	getEditAction: () => ( { kind: 'canvas-editing' } ),
} satisfies WidgetDefinition< SitePreviewWidget >;
