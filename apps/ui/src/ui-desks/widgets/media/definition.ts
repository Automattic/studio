import { __ } from '@wordpress/i18n';
import { image } from '@wordpress/icons';
import { uploadSiteMedia } from '@/data/wordpress/media';
import { MediaWidgetComponent } from './component';
import { MediaOpenControl } from './open-control';
import { isMediaWidgetProps, MEDIA_WIDGET_TYPE, type MediaKind, type MediaWidget } from './types';
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
	fileHandlers: [
		{
			id: 'media-upload',
			accept: {
				mimeTypes: [ 'image/*', 'video/*' ],
			},
			loading: {
				label: __( 'Uploading media' ),
				shapeProps: {
					w: 320,
					h: 320,
				},
			},
			requiresRunningSite: true,
			handle: async ( file ) => {
				const mediaKind = getDroppedMediaKind( file );
				if ( ! mediaKind ) {
					return null;
				}
				const uploadedMedia = await uploadSiteMedia( file );

				return {
					widgetProps: {
						url: uploadedMedia.source_url,
						mediaKind,
						alt: uploadedMedia.alt_text || file.name,
						mediaId: uploadedMedia.id,
					},
					shouldStartEditing: false,
				};
			},
		},
	],
} satisfies WidgetDefinition< MediaWidget >;

function getDroppedMediaKind( file: File ): MediaKind | null {
	if ( file.type.startsWith( 'image/' ) ) {
		return 'image';
	}

	if ( file.type.startsWith( 'video/' ) ) {
		return 'video';
	}

	return null;
}
