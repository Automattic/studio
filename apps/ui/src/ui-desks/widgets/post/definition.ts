import { __ } from '@wordpress/i18n';
import { post } from '@wordpress/icons';
import { PostWidgetComponent } from '@/ui-desks/widgets/post/component';
import { PostEditControl } from '@/ui-desks/widgets/post/edit-control';
import { isPostWidgetProps, POST_WIDGET_TYPE, type PostWidget } from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const postWidgetDefinition = {
	type: POST_WIDGET_TYPE,
	Component: PostWidgetComponent,
	controls: [
		{
			type: 'custom',
			id: 'edit-in-wp',
			Component: PostEditControl,
		},
	],
	isCreatable: false,
	requiresRunningSite: true,
	isWidgetProps: isPostWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 18,
		stroke: '#3858e9',
	} ),
	labels: {
		add: () => __( 'Add existing post…' ),
	},
	icon: post,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 280,
			h: 360,
		},
		widgetProps: {
			postId: 0,
		},
	} ),
} satisfies WidgetDefinition< PostWidget >;
