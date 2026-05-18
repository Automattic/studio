import { __ } from '@wordpress/i18n';
import { link } from '@wordpress/icons';
import {
	BookmarkWidgetComponent,
	BookmarkWidgetThumbnailComponent,
} from '@/ui-desks/widgets/bookmark/component';
import { BookmarkOpenControl } from './open-control';
import { BOOKMARK_WIDGET_TYPE, isBookmarkWidgetProps, type BookmarkWidget } from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const bookmarkWidgetDefinition = {
	type: BOOKMARK_WIDGET_TYPE,
	name: () => __( 'Link' ),
	Component: BookmarkWidgetComponent,
	thumbnail: BookmarkWidgetThumbnailComponent,
	controls: [
		{
			type: 'custom',
			id: 'open-bookmark',
			Component: BookmarkOpenControl,
		},
	],
	isCreatable: false,
	shouldStartEditingOnCreate: false,
	isWidgetProps: isBookmarkWidgetProps,
	getIndicator: () => ( {
		cornerRadius: 14,
		stroke: '#14171a',
	} ),
	labels: {
		add: () => __( 'New link' ),
	},
	icon: link,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 300,
			h: 101,
		},
		widgetProps: {
			url: '',
		},
	} ),
	getSummary: ( widgetProps ) => widgetProps.url,
	pasteHandlers: [
		{
			id: 'bookmark-url',
			accept: {
				kinds: [ 'url' ],
				protocols: [ 'http:', 'https:' ],
			},
			handle: async ( payload ) => {
				if ( payload.kind !== 'url' ) {
					return null;
				}

				return {
					widgetProps: {
						url: payload.url,
					},
					shouldStartEditing: false,
				};
			},
		},
	],
} satisfies WidgetDefinition< BookmarkWidget >;
