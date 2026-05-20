import { __ } from '@wordpress/i18n';
import { globe } from '@wordpress/icons';
import { isPageWidgetProps, PAGE_WIDGET_TYPE } from '@/ui-desks/widgets/page/types';
import { isPostWidgetProps, POST_WIDGET_TYPE } from '@/ui-desks/widgets/post/types';
import { SitePreviewAnnotateControl } from '@/ui-desks/widgets/site-preview/annotate-control';
import {
	SitePreviewAnnotationCancelControl,
	SitePreviewAnnotationRemoveControl,
	SitePreviewAnnotationSubmitControl,
} from '@/ui-desks/widgets/site-preview/annotations/toolbar';
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
	dropHandlers: [
		{
			id: 'preview-site-content',
			type: 'connector',
			sourceTypes: [ POST_WIDGET_TYPE, PAGE_WIDGET_TYPE ],
			canHandle: ( sourceWidget, targetWidget ) =>
				isSitePreviewWidgetProps( targetWidget.widgetProps ) &&
				( ( isPostWidgetProps( sourceWidget.widgetProps ) &&
					sourceWidget.widgetProps.postId > 0 ) ||
					( isPageWidgetProps( sourceWidget.widgetProps ) &&
						sourceWidget.widgetProps.pageId > 0 ) ),
		},
	],
	focusModeControls: [
		{
			type: 'custom',
			id: 'cancel-site-preview-annotations',
			Component: SitePreviewAnnotationCancelControl,
		},
		{
			type: 'custom',
			id: 'submit-site-preview-annotations',
			Component: SitePreviewAnnotationSubmitControl,
		},
		{
			type: 'custom',
			id: 'remove-site-preview-annotation',
			Component: SitePreviewAnnotationRemoveControl,
		},
	],
	focusModeControlsLabel: () => __( 'Annotate actions' ),
} satisfies WidgetDefinition< SitePreviewWidget >;
