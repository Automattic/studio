import { __ } from '@wordpress/i18n';
import { file } from '@wordpress/icons';
import { uploadSiteMedia } from '@/data/wordpress/media';
import { PdfWidgetComponent, PdfWidgetThumbnailComponent } from './component';
import { PdfOpenControl } from './open-control';
import { isPdfWidgetProps, PDF_WIDGET_TYPE, type PdfWidget } from './types';
import {
	createLocalPdfFileUrl,
	getPdfTitleFromFilename,
	getPdfTitleFromUrl,
	isPdfFile,
	isPdfUrl,
	PDF_CARD_HEIGHT,
	PDF_CARD_WIDTH,
	PDF_DEFAULT_HEIGHT,
	PDF_DEFAULT_WIDTH,
	PDF_FILE_EXTENSIONS,
	PDF_MIME_TYPE,
	PDF_MIN_HEIGHT,
	PDF_MIN_WIDTH,
} from './utils';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const pdfWidgetDefinition = {
	type: PDF_WIDGET_TYPE,
	name: () => __( 'PDF' ),
	Component: PdfWidgetComponent,
	thumbnail: PdfWidgetThumbnailComponent,
	controls: [
		{
			type: 'custom',
			id: 'view-pdf',
			Component: PdfOpenControl,
		},
	],
	isCreatable: false,
	shouldStartEditingOnCreate: false,
	isWidgetProps: isPdfWidgetProps,
	resizeConstraints: {
		minWidth: PDF_MIN_WIDTH,
		minHeight: PDF_MIN_HEIGHT,
	},
	getIndicator: () => ( {
		cornerRadius: 14,
		stroke: '#14171a',
	} ),
	labels: {
		add: () => __( 'New PDF' ),
	},
	icon: file,
	getInitialWidget: () => ( {
		shapeProps: {
			w: PDF_DEFAULT_WIDTH,
			h: PDF_DEFAULT_HEIGHT,
		},
		widgetProps: {
			url: '',
			title: 'PDF',
			mediaId: null,
		},
	} ),
	getSummary: ( widgetProps ) => widgetProps.title || widgetProps.url,
	fileHandlers: [
		{
			id: 'pdf-upload',
			accept: {
				mimeTypes: [ PDF_MIME_TYPE ],
				extensions: PDF_FILE_EXTENSIONS,
			},
			loading: {
				label: __( 'Uploading PDF' ),
				shapeProps: {
					w: PDF_CARD_WIDTH,
					h: PDF_CARD_HEIGHT,
				},
			},
			requiresRunningSite: true,
			handle: async ( file ) => {
				if ( ! isPdfFile( file ) ) {
					return null;
				}

				const pdfFile =
					file.type === PDF_MIME_TYPE
						? file
						: new File( [ file ], file.name, { type: PDF_MIME_TYPE } );
				const uploadedMedia = await uploadSiteMedia( pdfFile );

				return {
					shapeProps: {
						w: PDF_CARD_WIDTH,
						h: PDF_CARD_HEIGHT,
					},
					widgetProps: {
						url: uploadedMedia.source_url,
						title: uploadedMedia.alt_text || getPdfTitleFromFilename( file.name ),
						mediaId: uploadedMedia.id,
						filesize: file.size,
					},
					shouldStartEditing: false,
				};
			},
		},
		{
			id: 'pdf-local-file',
			accept: {
				mimeTypes: [ PDF_MIME_TYPE ],
				extensions: PDF_FILE_EXTENSIONS,
			},
			loading: {
				label: __( 'Adding PDF' ),
				shapeProps: {
					w: PDF_CARD_WIDTH,
					h: PDF_CARD_HEIGHT,
				},
			},
			handle: async ( file, { getFilePath } ) => {
				if ( ! isPdfFile( file ) ) {
					return null;
				}

				const path = await getFilePath?.( file );
				if ( ! path ) {
					return null;
				}

				return {
					shapeProps: {
						w: PDF_CARD_WIDTH,
						h: PDF_CARD_HEIGHT,
					},
					widgetProps: {
						url: createLocalPdfFileUrl( path ),
						title: getPdfTitleFromFilename( file.name ),
						mediaId: null,
						filesize: file.size,
					},
					shouldStartEditing: false,
				};
			},
		},
	],
	pasteHandlers: [
		{
			id: 'pdf-url',
			accept: {
				kinds: [ 'url' ],
				protocols: [ 'http:', 'https:' ],
			},
			canHandle: ( payload ) => isPdfUrl( payload.url ),
			handle: async ( payload ) => ( {
				shapeProps: {
					w: PDF_CARD_WIDTH,
					h: PDF_CARD_HEIGHT,
				},
				widgetProps: {
					url: payload.url,
					title: getPdfTitleFromUrl( payload.url ),
					mediaId: null,
				},
				shouldStartEditing: false,
			} ),
		},
	],
} satisfies WidgetDefinition< PdfWidget >;
