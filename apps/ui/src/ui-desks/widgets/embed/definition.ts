import { __ } from '@wordpress/i18n';
import { external } from '@wordpress/icons';
import {
	EmbedWidgetComponent,
	EmbedWidgetThumbnailComponent,
} from '@/ui-desks/widgets/embed/component';
import { getUrlEmbedInfo } from '@/ui-desks/widgets/embed/embed-info';
import { EmbedFitSizeControl } from './fit-control';
import { EmbedOpenControl } from './open-control';
import { getFittedEmbedShapeProps } from './sizing';
import { EMBED_WIDGET_TYPE, isEmbedWidgetProps, type EmbedWidget } from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const embedWidgetDefinition = {
	type: EMBED_WIDGET_TYPE,
	name: () => __( 'Embed' ),
	Component: EmbedWidgetComponent,
	thumbnail: EmbedWidgetThumbnailComponent,
	controls: [
		{
			type: 'custom',
			id: 'fit-size',
			Component: EmbedFitSizeControl,
		},
		{
			type: 'custom',
			id: 'open-embed',
			Component: EmbedOpenControl,
		},
	],
	isCreatable: false,
	shouldStartEditingOnCreate: false,
	isWidgetProps: isEmbedWidgetProps,
	getIndicator: ( widgetProps ) => ( {
		cornerRadius: getUrlEmbedInfo( widgetProps.url )?.definition.overrideOutlineRadius ?? 8,
		stroke: '#14171a',
	} ),
	labels: {
		add: () => __( 'New embed' ),
	},
	icon: external,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 720,
			h: 500,
		},
		widgetProps: {
			url: '',
		},
	} ),
	getSummary: ( widgetProps ) => widgetProps.url,
	getFittedShapeProps: ( { widgetProps, shapeProps } ) =>
		getFittedEmbedShapeProps( widgetProps, shapeProps ),
	pasteHandlers: [
		{
			id: 'embed-url',
			accept: {
				kinds: [ 'url' ],
				protocols: [ 'http:', 'https:' ],
			},
			canHandle: ( payload ) => Boolean( getUrlEmbedInfo( payload.url ) ),
			handle: async ( payload ) => {
				const embedInfo = getUrlEmbedInfo( payload.url );
				if ( ! embedInfo ) {
					return null;
				}

				return {
					shapeProps: {
						w: embedInfo.definition.width,
						h: embedInfo.definition.height,
					},
					widgetProps: {
						url: embedInfo.url,
					},
					shouldStartEditing: false,
				};
			},
		},
	],
} satisfies WidgetDefinition< EmbedWidget >;
