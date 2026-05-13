import { __ } from '@wordpress/i18n';
import { image } from '@wordpress/icons';
import { uploadSiteMedia } from '@/data/wordpress/media';
import { MediaWidgetComponent, MediaWidgetThumbnailComponent } from './component';
import {
	createLocalFileUrl,
	getMediaKindForFilename,
	getMediaKindForMimeType,
	getMediaMimeTypeFromFilename,
	MEDIA_FILE_EXTENSIONS,
} from './local-file';
import { MediaOpenControl } from './open-control';
import { getFittedMediaShapeProps } from './sizing';
import { isMediaWidgetProps, MEDIA_WIDGET_TYPE, type MediaKind, type MediaWidget } from './types';
import { MediaUploadControl } from './upload-control';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const mediaWidgetDefinition = {
	type: MEDIA_WIDGET_TYPE,
	name: () => __( 'Media' ),
	Component: MediaWidgetComponent,
	thumbnail: MediaWidgetThumbnailComponent,
	controls: [
		{
			type: 'custom',
			id: 'open-media',
			Component: MediaOpenControl,
		},
		{
			type: 'custom',
			id: 'upload-local-media',
			Component: MediaUploadControl,
		},
	],
	isCreatable: false,
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
	getSummary: ( widgetProps ) => widgetProps.alt || widgetProps.url,
	getFittedShapeProps: ( { widgetProps, shapeProps } ) =>
		getFittedMediaShapeProps( widgetProps, shapeProps ),
	fileHandlers: [
		{
			id: 'media-upload',
			accept: {
				mimeTypes: [ 'image/*', 'video/*' ],
				extensions: MEDIA_FILE_EXTENSIONS,
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
				const mimeType = file.type || getMediaMimeTypeFromFilename( file.name );
				const fileToUpload =
					mimeType && ! file.type ? new File( [ file ], file.name, { type: mimeType } ) : file;
				const uploadedMedia = await uploadSiteMedia( fileToUpload );

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
		{
			id: 'media-local-file',
			accept: {
				mimeTypes: [ 'image/*', 'video/*' ],
				extensions: MEDIA_FILE_EXTENSIONS,
			},
			loading: {
				label: __( 'Adding media' ),
				shapeProps: {
					w: 320,
					h: 320,
				},
			},
			handle: async ( file, { getFilePath } ) => {
				const mediaKind = getDroppedMediaKind( file );
				const path = await getFilePath?.( file );
				if ( ! mediaKind || ! path ) {
					return null;
				}

				const mimeType = file.type || getMediaMimeTypeFromFilename( file.name );

				return {
					widgetProps: {
						url: createLocalFileUrl( path ),
						mediaKind,
						alt: file.name,
						mediaId: null,
						source: {
							type: 'local',
							path,
							name: file.name,
							mimeType,
						},
					},
					shouldStartEditing: false,
				};
			},
		},
	],
} satisfies WidgetDefinition< MediaWidget >;

function getDroppedMediaKind( file: File ): MediaKind | null {
	return getMediaKindForMimeType( file.type ) ?? getMediaKindForFilename( file.name );
}
