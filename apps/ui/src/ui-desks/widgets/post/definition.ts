import { __, sprintf } from '@wordpress/i18n';
import { post } from '@wordpress/icons';
import { isMediaWidgetProps, MEDIA_WIDGET_TYPE } from '@/ui-desks/widgets/media/types';
import {
	PostWidgetComponent,
	PostWidgetThumbnailComponent,
} from '@/ui-desks/widgets/post/component';
import { isPostWidgetProps, POST_WIDGET_TYPE, type PostWidget } from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const postWidgetDefinition = {
	type: POST_WIDGET_TYPE,
	name: () => __( 'Post' ),
	Component: PostWidgetComponent,
	thumbnail: PostWidgetThumbnailComponent,
	isCreatable: false,
	requiresRunningSite: true,
	isWidgetProps: isPostWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 18,
		stroke: '#3858e9',
	} ),
	labels: {
		add: () => __( 'Add existing post…' ),
		edit: () => __( 'Edit in WP' ),
	},
	icon: post,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 280,
			h: 380,
		},
		widgetProps: {
			postId: 0,
		},
	} ),
	getSummary: ( widgetProps ) =>
		sprintf(
			/* translators: %d: WordPress post ID. */
			__( 'Post #%d' ),
			widgetProps.postId
		),
	getEditAction: ( { widget, hasSiteId, hasRunningSite } ) =>
		hasSiteId && hasRunningSite && widget.widgetProps.postId > 0
			? {
					kind: 'site-url',
					path: `/wp-admin/post.php?post=${ widget.widgetProps.postId }&action=edit`,
			  }
			: null,
	dropHandlers: [
		{
			id: 'media-actions-for-post',
			type: 'custom',
			sourceTypes: [ MEDIA_WIDGET_TYPE ],
			canHandle: ( sourceWidget, targetWidget ) =>
				isMediaWidgetProps( sourceWidget.widgetProps ) &&
				sourceWidget.widgetProps.mediaId !== null &&
				isPostWidgetProps( targetWidget.widgetProps ) &&
				targetWidget.widgetProps.postId > 0,
		},
	],
} satisfies WidgetDefinition< PostWidget >;
