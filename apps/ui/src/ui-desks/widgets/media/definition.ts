import { __ } from '@wordpress/i18n';
import { image } from '@wordpress/icons';
import { MediaWidgetComponent } from './component';
import { MediaOpenControl } from './open-control';
import { isMediaWidgetProps, MEDIA_WIDGET_TYPE, type MediaWidget } from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const mediaWidgetDefinition = {
	type: MEDIA_WIDGET_TYPE,
	Component: MediaWidgetComponent,
	controls: [
		{
			type: 'custom',
			id: 'open-media',
			Component: MediaOpenControl,
		},
	],
	isCreatable: false,
	requiresRunningSite: true,
	shouldStartEditingOnCreate: false,
	isWidgetProps: isMediaWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 18,
		stroke: '#3858e9',
	} ),
	labels: {
		add: () => __( 'New media' ),
	},
	icon: image,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 320,
			h: 320,
		},
		widgetProps: {
			url: '',
			mediaKind: 'image',
			alt: '',
			mediaId: null,
		},
	} ),
} satisfies WidgetDefinition< MediaWidget >;
