export const PDF_CARD_WIDTH = 320;
export const PDF_CARD_HEIGHT = 110;
export const PDF_DEFAULT_WIDTH = 300;
export const PDF_DEFAULT_HEIGHT = 101;
export const PDF_MIN_WIDTH = 220;
export const PDF_MIN_HEIGHT = 80;
export const PDF_PREVIEW_THRESHOLD = 480;
export const PDF_FILE_EXTENSIONS = [ 'pdf' ];
export const PDF_MIME_TYPE = 'application/pdf';

export function isPdfFile( file: File ) {
	return file.type === PDF_MIME_TYPE || isPdfFilename( file.name );
}

export function isPdfUrl( url: string ) {
	return /\.pdf(\?|$)/i.test( url );
}

export function getPdfTitleFromFilename( filename: string ) {
	return filename.replace( /\.pdf$/i, '' ) || 'PDF';
}

export function getPdfTitleFromUrl( url: string ) {
	try {
		const tail = new URL( url ).pathname.split( '/' ).pop() ?? '';
		return tail ? decodeURIComponent( tail ).replace( /\.pdf$/i, '' ) || 'PDF' : 'PDF';
	} catch {
		return 'PDF';
	}
}

export function chromelessPdfUrl( url: string ) {
	const flags = 'toolbar=0&navpanes=0&scrollbar=0&statusbar=0';
	const hashIndex = url.indexOf( '#' );
	if ( hashIndex === -1 ) {
		return `${ url }#${ flags }`;
	}

	const existing = url.slice( hashIndex + 1 );
	return `${ url.slice( 0, hashIndex ) }#${ existing ? `${ existing }&${ flags }` : flags }`;
}

export function createLocalPdfFileUrl( filePath: string ) {
	const normalizedPath = filePath.replace( /\\/g, '/' );

	if ( /^[a-zA-Z]:\//.test( normalizedPath ) ) {
		const [ drive, ...segments ] = normalizedPath.split( '/' );
		return `file:///${ drive }/${ encodePathSegments( segments ) }`;
	}

	if ( normalizedPath.startsWith( '//' ) ) {
		return `file://${ encodePathSegments( normalizedPath.slice( 2 ).split( '/' ) ) }`;
	}

	const absolutePath = normalizedPath.startsWith( '/' ) ? normalizedPath : `/${ normalizedPath }`;
	return `file://${ encodePathSegments( absolutePath.split( '/' ) ) }`;
}

export function formatPdfBytes( bytes: number ) {
	if ( bytes < 1024 ) {
		return `${ bytes } B`;
	}

	const kb = bytes / 1024;
	if ( kb < 1024 ) {
		return `${ kb < 10 ? kb.toFixed( 1 ) : Math.round( kb ) } KB`;
	}

	const mb = kb / 1024;
	if ( mb < 1024 ) {
		return `${ mb < 10 ? mb.toFixed( 1 ) : Math.round( mb ) } MB`;
	}

	const gb = mb / 1024;
	return `${ gb < 10 ? gb.toFixed( 1 ) : Math.round( gb ) } GB`;
}

function encodePathSegments( segments: string[] ) {
	return segments.map( ( segment ) => encodeURIComponent( segment ) ).join( '/' );
}

function isPdfFilename( filename: string ) {
	return /\.pdf$/i.test( filename );
}
