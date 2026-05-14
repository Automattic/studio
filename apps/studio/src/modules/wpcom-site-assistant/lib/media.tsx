import { __, _n, sprintf } from '@wordpress/i18n';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	DOLLY_IMAGE_PRELOAD_TIMEOUT_MS,
	DOLLY_MEDIA_UPLOAD_URL_ORIGIN,
	type DollyAgentImageUrl,
	type DollyPendingImage,
	type DollyUploadedImage,
	type DollyVisibleImage,
} from 'src/modules/wpcom-site-assistant/lib/types';

export const createDollyImageUrl = ( image: DollyUploadedImage ): DollyAgentImageUrl => ( {
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

export const revokeDollyPendingImageUrls = ( images: DollyPendingImage[] ) => {
	images.forEach( ( image ) => URL.revokeObjectURL( image.url ) );
};

export const readFileAsDataUrl = ( file: File ) =>
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

export const createDollyPendingVisibleImages = async (
	images: DollyPendingImage[]
): Promise< DollyVisibleImage[] > =>
	Promise.all(
		images.map( async ( image ) => ( {
			name: image.name ?? image.file.name,
			url: image.dataUrl ?? ( await readFileAsDataUrl( image.file ) ),
		} ) )
	);

export const getRawStringValue = ( value: unknown ) =>
	typeof value === 'string' ? value : undefined;

export const getNumberValue = ( value: unknown ) => {
	if ( typeof value === 'number' ) {
		return value;
	}
	if ( typeof value === 'string' ) {
		const parsedValue = Number.parseInt( value, 10 );
		return Number.isNaN( parsedValue ) ? undefined : parsedValue;
	}
	return undefined;
};

export const getFileNameFromUrl = ( url: string ) => {
	try {
		return decodeURIComponent( new URL( url ).pathname.split( '/' ).filter( Boolean ).pop() ?? '' );
	} catch {
		return '';
	}
};

export const removeFileExtension = ( fileName: string ) => fileName.replace( /\.[^.]+$/, '' );

export const getDollyUploadErrorMessage = ( data: unknown ) => {
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

export const createDollyRequestAbortError = () => {
	const message = 'Dolly request was stopped.';
	if ( typeof DOMException !== 'undefined' ) {
		return new DOMException( message, 'AbortError' );
	}

	const error = new Error( message );
	error.name = 'AbortError';
	return error;
};

export const throwIfDollyRequestAborted = ( abortSignal?: AbortSignal ) => {
	if ( abortSignal?.aborted ) {
		throw createDollyRequestAbortError();
	}
};

export const normalizeDollyUploadedImage = (
	rawMedia: unknown,
	originalImage: DollyPendingImage
): DollyUploadedImage | undefined => {
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

export const uploadDollyImages = async (
	siteId: number,
	images: DollyPendingImage[],
	abortSignal?: AbortSignal
): Promise< DollyUploadedImage[] > => {
	if ( images.length === 0 ) {
		return [];
	}

	const token = await getIpcApi().getAuthenticationToken();
	throwIfDollyRequestAborted( abortSignal );
	if ( ! token?.accessToken ) {
		throw new Error( __( 'Log in to WordPress.com before uploading images.' ) );
	}

	const formData = new FormData();
	images.forEach( ( image, index ) => {
		formData.append( 'media[]', image.file, image.file.name );
		formData.append( `attrs[${ index }][title]`, removeFileExtension( image.file.name ) );
	} );

	const response = await fetch( `${ DOLLY_MEDIA_UPLOAD_URL_ORIGIN }/sites/${ siteId }/media/new`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${ token.accessToken }`,
		},
		body: formData,
		signal: abortSignal,
	} );
	const data: unknown = await response.json().catch( () => undefined );

	if ( ! response.ok ) {
		throw new Error(
			getDollyUploadErrorMessage( data ) ?? __( 'The image upload failed. Please try again.' )
		);
	}

	const media =
		data && typeof data === 'object' ? ( data as { media?: unknown } ).media : undefined;
	if ( ! Array.isArray( media ) ) {
		throw new Error( __( 'The image upload response was missing media details.' ) );
	}

	const uploadedImages = media
		.map( ( rawMedia, index ) => normalizeDollyUploadedImage( rawMedia, images[ index ] ) )
		.filter( ( image ): image is DollyUploadedImage => Boolean( image ) );

	if ( uploadedImages.length !== images.length ) {
		throw new Error( __( 'The image upload response was missing attachment metadata.' ) );
	}

	return uploadedImages;
};

export const escapeMarkdownAltText = ( value: string ) => value.replace( /[[\]\\]/g, '\\$&' );

export const createDollyVisibleMessage = (
	message: string,
	images: DollyVisibleImage[],
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
			: '';

	return [ message, attachmentLabel ].filter( Boolean ).join( '\n\n' );
};

export const createDollyImagePrompt = ( imageCount: number ) =>
	imageCount === 1
		? __( 'Please look at the attached image.' )
		: __( 'Please look at the attached images.' );

export const DollyOptimisticImages = ( { images = [] }: { images?: DollyVisibleImage[] } ) => (
	<div className="flex flex-col gap-2">
		{ images.map( ( image ) => (
			<img key={ image.url } src={ image.url } alt={ image.name } loading="lazy" />
		) ) }
	</div>
);

export const preloadDollyImageUrls = ( images: DollyVisibleImage[] ) =>
	Promise.all(
		images.map(
			( image ) =>
				new Promise< void >( ( resolve ) => {
					if ( typeof Image === 'undefined' ) {
						resolve();
						return;
					}

					const preloadImage = new Image();
					let didFinish = false;
					const finish = () => {
						if ( didFinish ) {
							return;
						}
						didFinish = true;
						window.clearTimeout( timeoutId );
						resolve();
					};
					const timeoutId = window.setTimeout( finish, DOLLY_IMAGE_PRELOAD_TIMEOUT_MS );
					preloadImage.onload = finish;
					preloadImage.onerror = finish;
					preloadImage.src = image.url;
				} )
		)
	);
