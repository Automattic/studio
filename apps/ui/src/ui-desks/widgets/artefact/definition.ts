import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import {
	ArtefactWidgetComponent,
	ArtefactWidgetThumbnailComponent,
} from '@/ui-desks/widgets/artefact/component';
import {
	ARTEFACT_DEFAULT_SHAPE_PROPS,
	getFittedArtefactShapeProps,
} from '@/ui-desks/widgets/artefact/sizing';
import {
	ARTEFACT_WIDGET_TYPE,
	isArtefactWidgetProps,
	type ArtefactWidget,
} from '@/ui-desks/widgets/artefact/types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const artefactWidgetDefinition = {
	type: ARTEFACT_WIDGET_TYPE,
	name: () => __( 'Artefact' ),
	Component: ArtefactWidgetComponent,
	thumbnail: ArtefactWidgetThumbnailComponent,
	isCreatable: false,
	shouldStartEditingOnCreate: false,
	isWidgetProps: isArtefactWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 18,
		stroke: '#14171a',
	} ),
	labels: {
		add: () => __( 'New artefact' ),
	},
	icon: external,
	getInitialWidget: () => ( {
		shapeProps: { ...ARTEFACT_DEFAULT_SHAPE_PROPS },
		widgetProps: {
			html: '',
			title: '',
			scope: 'block',
			description: '',
		},
	} ),
	getSummary: ( widgetProps ) => widgetProps.title || __( 'Untitled artefact' ),
	getFittedShapeProps: getFittedArtefactShapeProps,
} satisfies WidgetDefinition< ArtefactWidget >;
