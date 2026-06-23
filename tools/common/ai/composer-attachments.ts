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
	messages: Pick<
		ComposerAttachmentMessages,
		'imageTooLarge' | 'imageReadFailed' | 'fileAttachFailed'
	>;
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

async function readFileAsBase64( file: File ): Promise< string > {
	const dataUrl = await readFileAsDataUrl( file );
	const comma = dataUrl.indexOf( ',' );
	return comma >= 0 ? dataUrl.slice( comma + 1 ) : dataUrl;
}

function getExtensionForPastedFile( mimeType: string ): string {
	if ( mimeType === 'image/jpeg' ) {
		return 'jpg';
	}
	const subtype = mimeType.split( '/' )[ 1 ]?.split( '+' )[ 0 ];
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
		const text = ( await readBlobWithFileReader( file.slice( 0, 2048 ), 'readAsText' ) ).trim();
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

export async function prepareComposerAttachments(
	incoming: File[],
	{ resolveFilePath, messages }: PrepareComposerAttachmentsOptions
): Promise< { attachments: ComposerAttachment[]; error: string | null } > {
	const prepared = await Promise.all(
		incoming.map(
			async (
				file
			): Promise< { attachment: ComposerAttachment | null; error: string | null } > => {
				if ( isStudioChatImageMimeType( file.type ) ) {
					if ( file.size > STUDIO_CHAT_MAX_IMAGE_BYTES ) {
						return { attachment: null, error: messages.imageTooLarge };
					}
					try {
						const dataBase64 = await readFileAsBase64( file );
						return {
							attachment: {
								id: newAttachmentId(),
								kind: 'image',
								name: file.name,
								mimeType: file.type,
								size: file.size,
								dataBase64,
							},
							error: null,
						};
					} catch {
						return { attachment: null, error: messages.imageReadFailed };
					}
				}

				let path = '';
				try {
					path = await resolveFilePath( file );
				} catch {
					return { attachment: null, error: messages.fileAttachFailed };
				}
				if ( ! path ) {
					return { attachment: null, error: messages.fileAttachFailed };
				}
				return {
					attachment: {
						id: newAttachmentId(),
						kind: 'file',
						name: file.name,
						path,
						mimeType: file.type || undefined,
						size: file.size,
						preview: await buildFilePreview( file ),
					},
					error: null,
				};
			}
		)
	);

	return {
		attachments: prepared
			.map( ( item ) => item.attachment )
			.filter( ( attachment ): attachment is ComposerAttachment => attachment !== null ),
		error: prepared.reduce< string | null >( ( lastError, item ) => item.error ?? lastError, null ),
	};
}

export function mergeComposerAttachments(
	current: ComposerAttachment[],
	next: ComposerAttachment[],
	messages: Pick< ComposerAttachmentMessages, 'maxImages' | 'totalImagesTooLarge' | 'maxFiles' >
): { attachments: ComposerAttachment[]; error: string | null } {
	const merged = [ ...current ];
	const images = current.filter( ( item ) => item.kind === 'image' );
	let imageCount = images.length;
	let fileCount = current.length - imageCount;
	let imageBytes = images.reduce( ( sum, item ) => sum + item.size, 0 );
	let error: string | null = null;

	for ( const attachment of next ) {
		if ( attachment.kind === 'image' ) {
			if ( imageCount >= STUDIO_CHAT_MAX_IMAGES ) {
				error = messages.maxImages;
				continue;
			}
			if ( imageBytes + attachment.size > STUDIO_CHAT_MAX_TOTAL_IMAGE_BYTES ) {
				error = messages.totalImagesTooLarge;
				continue;
			}
			imageCount++;
			imageBytes += attachment.size;
		} else {
			if ( fileCount >= STUDIO_CHAT_MAX_FILES ) {
				error = messages.maxFiles;
				continue;
			}
			fileCount++;
		}
		merged.push( attachment );
	}

	return { attachments: merged, error };
}
