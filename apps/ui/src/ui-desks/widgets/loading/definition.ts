import { __ } from '@wordpress/i18n';
import { update } from '@wordpress/icons';
import { LoadingWidgetComponent } from './component';
import { isLoadingWidgetProps, LOADING_WIDGET_TYPE, type LoadingWidget } from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const loadingWidgetDefinition = {
	type: LOADING_WIDGET_TYPE,
	Component: LoadingWidgetComponent,
	isCreatable: false,
	isWidgetProps: isLoadingWidgetProps,
	labels: {
		add: () => __( 'Loading' ),
	},
	icon: update,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 320,
			h: 220,
		},
		widgetProps: {
			label: __( 'Loading' ),
		},
	} ),
	getIndicator: () => ( {
		cornerRadius: 18,
		stroke: 'transparent',
	} ),
} satisfies WidgetDefinition< LoadingWidget >;
