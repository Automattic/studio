import { __, _n, sprintf } from '@wordpress/i18n';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	WORKSPACE_DOLLY_MEDIA_UPLOAD_URL_ORIGIN,
	type WorkspaceDollyAgentImageUrl,
	type WorkspaceDollyPendingImage,
	type WorkspaceDollyUploadedImage,
	type WorkspaceDollyVisibleImage,
} from 'src/modules/workspaces/lib/dolly/types';

export const createWorkspaceDollyImageUrl = (
	image: WorkspaceDollyUploadedImage
): WorkspaceDollyAgentImageUrl => ( {
	url: image.url,
	metadata: {
		id: image.id,
		url: image.url,
		mimeType: image.mimeType,
		name: image.name,
		title: image.title ?? image.name,
		fileName: image.fileName ?? image.name,
		fileType: image.mimeType,
	},
} );

export const WORKSPACE_DOLLY_IMAGE_PREVIEW_CLASS_NAME = 'block h-auto rounded-md object-contain';

export const WORKSPACE_DOLLY_IMAGE_PREVIEW_STYLE = {
	maxHeight: '320px',
	maxWidth: 'min(100%, 520px)',
};

export const revokeWorkspaceDollyPendingImageUrls = ( images: WorkspaceDollyPendingImage[] ) => {
	images.forEach( ( image ) => URL.revokeObjectURL( image.url ) );
};

export const readWorkspaceDollyFileAsDataUrl = ( file: File ) =>
	new Promise< string >( ( resolve, reject ) => {
		const reader = new FileReader();
		reader.onload = () => {
			if ( typeof reader.result === 'string' ) {
				resolve( reader.result );
				return;
			}
			reject( new Error( __( 'Unable to prepare image preview.' ) ) );
		};
		reader.onerror = () =>
			reject( reader.error ?? new Error( __( 'Unable to prepare image preview.' ) ) );
		reader.readAsDataURL( file );
	} );

export const createWorkspaceDollyPendingVisibleImages = async (
	images: WorkspaceDollyPendingImage[]
): Promise< WorkspaceDollyVisibleImage[] > =>
	Promise.all(
		images.map( async ( image ) => ( {
			name: image.name ?? image.file.name,
			url: image.dataUrl ?? ( await readWorkspaceDollyFileAsDataUrl( image.file ) ),
		} ) )
	);

export const getWorkspaceDollySiteImageHostname = ( siteUrl: string ) => {
	try {
		return new URL( siteUrl ).hostname.toLowerCase();
	} catch {
		return undefined;
	}
};

export const isWorkspaceDollyRenderableImageUrl = ( src?: string, siteUrl?: string ) => {
	if ( ! src ) {
		return false;
	}

	if ( src.startsWith( 'data:' ) || src.startsWith( 'blob:' ) ) {
		return true;
	}

	try {
		const url = new URL( src );
		if ( url.protocol !== 'https:' ) {
			return false;
		}

		const siteHostname = siteUrl ? getWorkspaceDollySiteImageHostname( siteUrl ) : undefined;
		return Boolean( siteHostname && url.hostname.toLowerCase() === siteHostname );
	} catch {
		return false;
	}
};

export const isWorkspaceDollyRenderableImageLinkUrl = ( href?: string, siteUrl?: string ) => {
	if ( ! isWorkspaceDollyRenderableImageUrl( href, siteUrl ) ) {
		return false;
	}

	try {
		const pathname = new URL( href as string ).pathname.toLowerCase();
		return /\.(avif|gif|jpe?g|png|webp)$/.test( pathname );
	} catch {
		return false;
	}
};

const getRawStringValue = ( value: unknown ) => ( typeof value === 'string' ? value : undefined );

const getNumberValue = ( value: unknown ) => {
	if ( typeof value === 'number' ) {
		return value;
	}
	if ( typeof value === 'string' ) {
		const parsedValue = Number.parseInt( value, 10 );
		return Number.isNaN( parsedValue ) ? undefined : parsedValue;
	}
	return undefined;
};

const getFileNameFromUrl = ( url: string ) => {
	try {
		return decodeURIComponent( new URL( url ).pathname.split( '/' ).filter( Boolean ).pop() ?? '' );
	} catch {
		return '';
	}
};

const removeFileExtension = ( fileName: string ) => fileName.replace( /\.[^.]+$/, '' );

const getWorkspaceDollyUploadErrorMessage = ( data: unknown ) => {
	if ( ! data || typeof data !== 'object' ) {
		return undefined;
	}

	const errors = ( data as { errors?: unknown } ).errors;
	if ( ! Array.isArray( errors ) ) {
		return undefined;
	}

	return errors
		.map( ( error ) => {
			if ( ! error || typeof error !== 'object' ) {
				return undefined;
			}
			return getRawStringValue( ( error as { message?: unknown } ).message );
		} )
		.find( Boolean );
};

export const throwIfWorkspaceDollyRequestAborted = ( abortSignal?: AbortSignal ) => {
	if ( abortSignal?.aborted ) {
		if ( typeof DOMException !== 'undefined' ) {
			throw new DOMException( 'Dolly request was stopped.', 'AbortError' );
		}
		const error = new Error( 'Dolly request was stopped.' );
		error.name = 'AbortError';
		throw error;
	}
};

const normalizeWorkspaceDollyUploadedImage = (
	rawMedia: unknown,
	originalImage: WorkspaceDollyPendingImage
): WorkspaceDollyUploadedImage | undefined => {
	if ( ! rawMedia || typeof rawMedia !== 'object' ) {
		return undefined;
	}

	const media = rawMedia as Record< string, unknown >;
	const id = getNumberValue( media.ID ) ?? getNumberValue( media.id ) ?? 0;
	const url = getRawStringValue( media.URL ) ?? getRawStringValue( media.url ) ?? '';
	const mimeType =
		getRawStringValue( media.mime_type ) ||
		getRawStringValue( media.mimeType ) ||
		originalImage.file.type ||
		'application/octet-stream';
	const fileName = getRawStringValue( media.file ) ?? originalImage.file.name;
	const title =
		getRawStringValue( media.title ) ??
		getRawStringValue( media.name ) ??
		removeFileExtension( fileName );
	const name = title || getFileNameFromUrl( url ) || originalImage.file.name;

	if ( id <= 0 || ! url.trim() ) {
		return undefined;
	}

	return {
		id,
		url,
		name,
		mimeType,
		fileName,
		title,
	};
};

export const uploadWorkspaceDollyImages = async (
	siteId: number,
	images: WorkspaceDollyPendingImage[],
	abortSignal?: AbortSignal
): Promise< WorkspaceDollyUploadedImage[] > => {
	if ( images.length === 0 ) {
		return [];
	}

	const token = await getIpcApi().getAuthenticationToken();
	throwIfWorkspaceDollyRequestAborted( abortSignal );
	if ( ! token?.accessToken ) {
		throw new Error( __( 'Log in to WordPress.com before uploading images.' ) );
	}

	const formData = new FormData();
	images.forEach( ( image, index ) => {
		formData.append( 'media[]', image.file, image.file.name );
		formData.append( `attrs[${ index }][title]`, removeFileExtension( image.file.name ) );
	} );

	const response = await fetch(
		`${ WORKSPACE_DOLLY_MEDIA_UPLOAD_URL_ORIGIN }/sites/${ siteId }/media/new`,
		{
			method: 'POST',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${ token.accessToken }`,
			},
			body: formData,
			signal: abortSignal,
		}
	);
	const data: unknown = await response.json().catch( () => undefined );

	if ( ! response.ok ) {
		throw new Error(
			getWorkspaceDollyUploadErrorMessage( data ) ??
				__( 'The image upload failed. Please try again.' )
		);
	}

	const media =
		data && typeof data === 'object' ? ( data as { media?: unknown } ).media : undefined;
	if ( ! Array.isArray( media ) ) {
		throw new Error( __( 'The image upload response was missing media details.' ) );
	}

	const uploadedImages = media
		.map( ( rawMedia, index ) => normalizeWorkspaceDollyUploadedImage( rawMedia, images[ index ] ) )
		.filter( ( image ): image is WorkspaceDollyUploadedImage => Boolean( image ) );

	if ( uploadedImages.length !== images.length ) {
		throw new Error( __( 'The image upload response was missing attachment metadata.' ) );
	}

	return uploadedImages;
};

const escapeMarkdownAltText = ( value: string ) => value.replace( /[[\]\\]/g, '\\$&' );

export const createWorkspaceDollyVisibleMessage = (
	message: string,
	images: WorkspaceDollyVisibleImage[],
	fallbackImageCount: number
) => {
	const imageMarkdown = images
		.map( ( image ) => `![${ escapeMarkdownAltText( image.name ) }](${ image.url })` )
		.join( '\n' );
	const attachmentLabel =
		images.length > 0
			? imageMarkdown
			: fallbackImageCount > 0
			? sprintf(
					_n( '%d image attached', '%d images attached', fallbackImageCount ),
					fallbackImageCount
			  )
			: undefined;

	return [ message, attachmentLabel ].filter( Boolean ).join( '\n\n' );
};

export const createWorkspaceDollyImagePrompt = ( imageCount: number ) =>
	imageCount === 1
		? __( 'Please look at the attached image.' )
		: __( 'Please look at the attached images.' );

export const WorkspaceDollyOptimisticImages = ( {
	images = [],
}: {
	images?: WorkspaceDollyVisibleImage[];
} ) => (
	<div className="flex flex-col gap-2">
		{ images.map( ( image ) => (
			<img
				key={ image.url }
				src={ image.url }
				alt={ image.name }
				loading="lazy"
				className={ WORKSPACE_DOLLY_IMAGE_PREVIEW_CLASS_NAME }
				style={ WORKSPACE_DOLLY_IMAGE_PREVIEW_STYLE }
			/>
		) ) }
	</div>
);
