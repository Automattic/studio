import { STUDIO_CHAT_MAX_FILES, type StudioChatFileAttachment } from './chat-files';
import {
	STUDIO_CHAT_MAX_IMAGES,
	STUDIO_CHAT_MAX_IMAGE_BYTES,
	STUDIO_CHAT_MAX_TOTAL_IMAGE_BYTES,
	isStudioChatImageMimeType,
	type StudioChatImage,
	type StudioChatImageMimeType,
} from './chat-images';

export interface ComposerImageAttachment {
	id: string;
	kind: 'image';
	name: string;
	mimeType: StudioChatImageMimeType;
	size: number;
	dataBase64: string;
}

export interface ComposerFileAttachment {
	id: string;
	kind: 'file';
	name: string;
	path: string;
	mimeType?: string;
	size: number;
	preview?: ComposerFilePreview;
}

export type ComposerFilePreview =
	| { kind: 'image'; dataUrl: string }
	| { kind: 'text'; text: string };

export type ComposerAttachment = ComposerImageAttachment | ComposerFileAttachment;

export interface ComposerSendAttachments {
	images: StudioChatImage[];
	files: StudioChatFileAttachment[];
}

export const COMPOSER_FILE_IMAGE_PREVIEW_MAX_BYTES = 1 * 1024 * 1024;
const COMPOSER_FILE_TEXT_PREVIEW_MAX_BYTES = 2048;

type ComposerAttachmentMessages = {
	imageTooLarge: string;
	imageReadFailed: string;
	fileAttachFailed: string;
	maxImages: string;
	totalImagesTooLarge: string;
	maxFiles: string;
};

type PrepareComposerAttachmentsOptions = {
	resolveFilePath: ( file: File ) => string | Promise< string >;
	messages: ComposerAttachmentMessages;
	existingAttachments?: ComposerAttachment[];
};

export function toComposerSendAttachments(
	attachments: ComposerAttachment[]
): ComposerSendAttachments {
	const images: StudioChatImage[] = [];
	const files: StudioChatFileAttachment[] = [];
	for ( const attachment of attachments ) {
		if ( attachment.kind === 'image' ) {
			images.push( {
				id: attachment.id,
				name: attachment.name,
				mimeType: attachment.mimeType,
				size: attachment.size,
				dataBase64: attachment.dataBase64,
			} );
		} else {
			files.push( {
				id: attachment.id,
				name: attachment.name,
				path: attachment.path,
				mimeType: attachment.mimeType,
				size: attachment.size,
			} );
		}
	}
	return { images, files };
}

function newAttachmentId(): string {
	return `${ Date.now().toString( 36 ) }-${ Math.random().toString( 36 ).slice( 2, 10 ) }`;
}

function readBlobWithFileReader(
	blob: Blob,
	method: 'readAsDataURL' | 'readAsText'
): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		const reader = new FileReader();
		reader.onerror = () => reject( reader.error ?? new Error( 'Failed to read file.' ) );
		reader.onload = () => resolve( typeof reader.result === 'string' ? reader.result : '' );
		reader[ method ]( blob );
	} );
}

function readFileAsDataUrl( file: File ): Promise< string > {
	return readBlobWithFileReader( file, 'readAsDataURL' );
}

export function readBlobAsDataUrl( blob: Blob ): Promise< string > {
	return readBlobWithFileReader( blob, 'readAsDataURL' );
}

async function readBlobTextPreview( blob: Blob ): Promise< string > {
	const text = await readBlobWithFileReader( blob, 'readAsText' );
	// The preview slice may cut through the final multibyte character.
	return text.replace( /\uFFFD$/, '' );
}

async function readFileAsBase64( file: File ): Promise< string > {
	const dataUrl = await readFileAsDataUrl( file );
	const comma = dataUrl.indexOf( ',' );
	return comma >= 0 ? dataUrl.slice( comma + 1 ) : dataUrl;
}

const PASTED_FILE_EXTENSION_BY_MIME_TYPE: Record< string, string > = {
	'application/javascript': 'js',
	'application/json': 'json',
	'application/pdf': 'pdf',
	'image/jpeg': 'jpg',
	'text/csv': 'csv',
	'text/javascript': 'js',
	'text/markdown': 'md',
	'text/plain': 'txt',
};

function getExtensionForPastedFile( mimeType: string ): string {
	const normalizedMimeType = mimeType.toLowerCase();
	const mappedExtension = PASTED_FILE_EXTENSION_BY_MIME_TYPE[ normalizedMimeType ];
	if ( mappedExtension ) {
		return mappedExtension;
	}
	const subtype = normalizedMimeType.split( '/' )[ 1 ]?.split( '+' )[ 0 ];
	return subtype || 'bin';
}

function getFileExtension( name: string ): string {
	const extension = name.split( '.' ).pop();
	return extension && extension !== name ? extension.toLowerCase() : '';
}

const TEXT_PREVIEW_EXTENSIONS = new Set( [
	'css',
	'csv',
	'html',
	'js',
	'json',
	'jsx',
	'md',
	'php',
	'ts',
	'tsx',
	'txt',
	'xml',
	'yaml',
	'yml',
] );

function isTextPreviewableFile( file: File ): boolean {
	const mimeType = file.type.toLowerCase();
	return (
		mimeType.startsWith( 'text/' ) ||
		mimeType.includes( 'json' ) ||
		mimeType.includes( 'xml' ) ||
		mimeType.includes( 'javascript' ) ||
		TEXT_PREVIEW_EXTENSIONS.has( getFileExtension( file.name ) )
	);
}

async function buildFilePreview( file: File ): Promise< ComposerFilePreview | undefined > {
	if ( file.type.startsWith( 'image/' ) ) {
		if ( file.size > COMPOSER_FILE_IMAGE_PREVIEW_MAX_BYTES ) {
			return undefined;
		}
		try {
			return { kind: 'image', dataUrl: await readFileAsDataUrl( file ) };
		} catch {
			return undefined;
		}
	}

	if ( ! isTextPreviewableFile( file ) ) {
		return undefined;
	}

	try {
		const text = (
			await readBlobTextPreview( file.slice( 0, COMPOSER_FILE_TEXT_PREVIEW_MAX_BYTES ) )
		).trim();
		return text ? { kind: 'text', text } : undefined;
	} catch {
		return undefined;
	}
}

function normalizePastedFile( file: File, index: number ): File {
	if ( file.name ) {
		return file;
	}
	const baseName = file.type.startsWith( 'image/' ) ? 'pasted-image' : 'pasted-file';
	const suffix = index === 0 ? '' : `-${ index + 1 }`;
	return new File(
		[ file ],
		`${ baseName }${ suffix }.${ getExtensionForPastedFile( file.type ) }`,
		{
			type: file.type,
			lastModified: file.lastModified || Date.now(),
		}
	);
}

export function getComposerClipboardFiles( dataTransfer: DataTransfer ): File[] {
	const files = Array.from( dataTransfer.files ?? [] );
	if ( files.length > 0 ) {
		return files.map( normalizePastedFile );
	}
	return Array.from( dataTransfer.items ?? [] )
		.filter( ( item ) => item.kind === 'file' )
		.map( ( item ) => item.getAsFile() )
		.filter( ( file ): file is File => file !== null )
		.map( normalizePastedFile );
}

function addUniqueError( errors: string[], error: string ): void {
	if ( ! errors.includes( error ) ) {
		errors.push( error );
	}
}

function summarizeComposerAttachmentErrors( errors: string[] ): string | null {
	return errors.length > 0 ? errors.join( ' ' ) : null;
}

function getAttachmentStats( attachments: ComposerAttachment[] ): {
	imageCount: number;
	fileCount: number;
	imageBytes: number;
} {
	const images = attachments.filter( ( item ) => item.kind === 'image' );
	return {
		imageCount: images.length,
		fileCount: attachments.length - images.length,
		imageBytes: images.reduce( ( sum, item ) => sum + item.size, 0 ),
	};
}

export async function prepareComposerAttachments(
	incoming: File[],
	{ resolveFilePath, messages, existingAttachments = [] }: PrepareComposerAttachmentsOptions
): Promise< { attachments: ComposerAttachment[]; error: string | null; errors: string[] } > {
	const attachments: ComposerAttachment[] = [];
	const errors: string[] = [];
	let { imageCount, fileCount, imageBytes } = getAttachmentStats( existingAttachments );

	for ( const file of incoming ) {
		if ( isStudioChatImageMimeType( file.type ) ) {
			if ( file.size > STUDIO_CHAT_MAX_IMAGE_BYTES ) {
				addUniqueError( errors, messages.imageTooLarge );
				continue;
			}
			if ( imageCount >= STUDIO_CHAT_MAX_IMAGES ) {
				addUniqueError( errors, messages.maxImages );
				continue;
			}
			if ( imageBytes + file.size > STUDIO_CHAT_MAX_TOTAL_IMAGE_BYTES ) {
				addUniqueError( errors, messages.totalImagesTooLarge );
				continue;
			}
			try {
				const dataBase64 = await readFileAsBase64( file );
				attachments.push( {
					id: newAttachmentId(),
					kind: 'image',
					name: file.name,
					mimeType: file.type,
					size: file.size,
					dataBase64,
				} );
				imageCount++;
				imageBytes += file.size;
			} catch {
				addUniqueError( errors, messages.imageReadFailed );
			}
			continue;
		}

		if ( fileCount >= STUDIO_CHAT_MAX_FILES ) {
			addUniqueError( errors, messages.maxFiles );
			continue;
		}

		let path = '';
		try {
			path = await resolveFilePath( file );
		} catch {
			addUniqueError( errors, messages.fileAttachFailed );
			continue;
		}
		if ( ! path ) {
			addUniqueError( errors, messages.fileAttachFailed );
			continue;
		}
		attachments.push( {
			id: newAttachmentId(),
			kind: 'file',
			name: file.name,
			path,
			mimeType: file.type || undefined,
			size: file.size,
			preview: await buildFilePreview( file ),
		} );
		fileCount++;
	}

	return {
		attachments,
		error: summarizeComposerAttachmentErrors( errors ),
		errors,
	};
}

export function mergeComposerAttachments(
	current: ComposerAttachment[],
	next: ComposerAttachment[],
	messages: Pick< ComposerAttachmentMessages, 'maxImages' | 'totalImagesTooLarge' | 'maxFiles' >
): { attachments: ComposerAttachment[]; error: string | null; errors: string[] } {
	const merged = [ ...current ];
	const images = current.filter( ( item ) => item.kind === 'image' );
	let imageCount = images.length;
	let fileCount = current.length - imageCount;
	let imageBytes = images.reduce( ( sum, item ) => sum + item.size, 0 );
	const errors: string[] = [];

	for ( const attachment of next ) {
		if ( attachment.kind === 'image' ) {
			if ( imageCount >= STUDIO_CHAT_MAX_IMAGES ) {
				addUniqueError( errors, messages.maxImages );
				continue;
			}
			if ( imageBytes + attachment.size > STUDIO_CHAT_MAX_TOTAL_IMAGE_BYTES ) {
				addUniqueError( errors, messages.totalImagesTooLarge );
				continue;
			}
			imageCount++;
			imageBytes += attachment.size;
		} else {
			if ( fileCount >= STUDIO_CHAT_MAX_FILES ) {
				addUniqueError( errors, messages.maxFiles );
				continue;
			}
			fileCount++;
		}
		merged.push( attachment );
	}

	return { attachments: merged, error: summarizeComposerAttachmentErrors( errors ), errors };
}
