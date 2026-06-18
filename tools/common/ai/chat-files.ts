// Non-image file attachments for Studio Code chat. Unlike images (which travel
// as base64 multimodal content blocks), files are passed to the agent by their
// absolute disk path — the coding agent reads them with its built-in file tools.
// This keeps the payload tiny and supports any file type with no size cap.

export interface StudioChatFileAttachment {
	id: string;
	name: string;
	path: string;
	mimeType?: string;
	size?: number;
}

export const STUDIO_CHAT_MAX_FILES = 10;

function isAbsolutePath( value: string ): boolean {
	// POSIX absolute ("/foo") or Windows absolute ("C:\foo" / "\\server\share").
	return value.startsWith( '/' ) || /^[a-zA-Z]:[\\/]/.test( value ) || value.startsWith( '\\\\' );
}

export function validateStudioChatFiles(
	files: StudioChatFileAttachment[] | undefined
): StudioChatFileAttachment[] {
	if ( ! files || files.length === 0 ) {
		return [];
	}

	if ( files.length > STUDIO_CHAT_MAX_FILES ) {
		throw new Error( `You can attach up to ${ STUDIO_CHAT_MAX_FILES } files.` );
	}

	for ( const file of files ) {
		if ( typeof file.path !== 'string' || ! file.path.trim() ) {
			throw new Error( 'Attached file path is missing.' );
		}
		if ( ! isAbsolutePath( file.path ) ) {
			throw new Error( 'Attached files must be referenced by an absolute path.' );
		}
		// The path is interpolated into the prompt the model reads; a newline or
		// other control char (legal in POSIX paths) could inject extra lines.
		// eslint-disable-next-line no-control-regex
		if ( /[\x00-\x1f]/.test( file.path ) ) {
			throw new Error( 'Attached file path contains invalid characters.' );
		}
		if ( typeof file.name !== 'string' || ! file.name.trim() ) {
			throw new Error( 'Attached file name is missing.' );
		}
	}

	return files;
}

// Builds the text block appended to the prompt so the agent knows which files to
// read. The agent's file tools resolve the absolute paths.
export function buildAttachedFilesPromptBlock( files: StudioChatFileAttachment[] ): string {
	if ( files.length === 0 ) {
		return '';
	}
	const lines = files.map( ( file ) => `- ${ file.path }` );
	return `\n\nAttached files (read them as needed):\n${ lines.join( '\n' ) }`;
}
