import { __, sprintf } from '@wordpress/i18n';
import { post } from '@wordpress/icons';
import { getSiteContentMediaDropActions } from '@/ui-desks/widget-actions/drop-handlers/site-content-media-actions';
import { createMediaDropPreviewTarget } from '@/ui-desks/widgets/media/drop-preview';
import { isMediaWidgetProps, MEDIA_WIDGET_TYPE } from '@/ui-desks/widgets/media/types';
import {
	PostWidgetComponent,
	PostWidgetThumbnailComponent,
} from '@/ui-desks/widgets/post/component';
import { PostPreviewControl } from '@/ui-desks/widgets/post/preview-control';
import { isPostWidgetProps, POST_WIDGET_TYPE, type PostWidget } from './types';
import type {
	WidgetCustomDropActionContext,
	WidgetCustomDropActionIntent,
	WidgetDropFeedback,
	WidgetDropFeedbackIntent,
	WidgetDefinition,
} from '@/ui-desks/widgets/types';

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
	controls: [
		{
			type: 'custom',
			id: 'preview-post-on-canvas',
			Component: PostPreviewControl,
		},
	],
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
			getFeedback: getPostMediaDropFeedback,
			getActions: getPostMediaDropActions,
		},
	],
} satisfies WidgetDefinition< PostWidget >;

function getPostMediaDropFeedback( intent: WidgetDropFeedbackIntent ): WidgetDropFeedback | null {
	const mediaProps = intent.sourceWidget.widgetProps;
	if ( ! isMediaWidgetProps( mediaProps ) ) {
		return null;
	}

	return {
		sourceOpacity: intent.phase === 'hover' ? 0 : 0.3,
		target: createMediaDropPreviewTarget( mediaProps ),
	};
}

function getPostMediaDropActions(
	intent: WidgetCustomDropActionIntent,
	context: WidgetCustomDropActionContext
) {
	const mediaProps = intent.sourceWidget.widgetProps;
	const postProps = intent.targetWidget.widgetProps;
	if (
		! isMediaWidgetProps( mediaProps ) ||
		mediaProps.mediaId === null ||
		! isPostWidgetProps( postProps )
	) {
		return [];
	}

	return getSiteContentMediaDropActions( {
		kind: 'post',
		contentId: postProps.postId,
		attachLabel: __( 'Attach to post' ),
		media: {
			id: mediaProps.mediaId,
			url: mediaProps.url,
			alt: mediaProps.alt,
			kind: mediaProps.mediaKind,
		},
		context,
	} );
}
