import { readFile } from 'fs/promises';
import path from 'path';

// Shared staged-payload handling for REST request tools (wpcom_request,
// wp_request): large generated strings and nested JSON bodies are written to
// scratch files under this directory and referenced via bodyFile/bodyFiles.
export const REQUEST_BODY_FILES_RELATIVE_DIR = 'tmp/ai-payloads';

const BODY_FILE_FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function hasOwnProperty( value: Record< string, unknown >, key: string ): boolean {
	return Object.prototype.hasOwnProperty.call( value, key );
}

function isRecord( value: unknown ): value is Record< string, unknown > {
	return Boolean( value && typeof value === 'object' && ! Array.isArray( value ) );
}

function validateBodyFileFieldName( key: string ): void {
	if ( ! BODY_FILE_FIELD_NAME_PATTERN.test( key ) ) {
		throw new Error(
			`bodyFiles keys must be top-level REST body field names such as "content" or "excerpt", not filenames, nested paths, or JSON paths. Use the value as the file path, for example bodyFiles: { content: "${ REQUEST_BODY_FILES_RELATIVE_DIR }/home.html" }.`
		);
	}
}

function resolveBodyFilePath( rootDir: string, filePath: string ): string {
	if ( path.isAbsolute( filePath ) ) {
		throw new Error(
			`bodyFile and bodyFiles paths must be relative paths under ${ REQUEST_BODY_FILES_RELATIVE_DIR }.`
		);
	}

	const resolvedRoot = path.resolve( rootDir, REQUEST_BODY_FILES_RELATIVE_DIR );
	const resolvedPath = path.resolve( rootDir, filePath );
	const relativePath = path.relative( resolvedRoot, resolvedPath );

	if ( ! relativePath || relativePath.startsWith( '..' ) || path.isAbsolute( relativePath ) ) {
		throw new Error(
			`bodyFile and bodyFiles paths must be relative paths under ${ REQUEST_BODY_FILES_RELATIVE_DIR }.`
		);
	}

	return resolvedPath;
}

function validateSingleBodySource(
	body: Record< string, unknown > | undefined,
	bodyFile: string | undefined,
	bodyFiles: Record< string, string > | undefined
): void {
	if ( bodyFile && ( body || bodyFiles ) ) {
		throw new Error(
			'Use only one request body source: body, bodyFile, or bodyFiles. bodyFile provides the entire JSON request body.'
		);
	}
}

async function readBodyFile(
	bodyFile: string,
	rootDir: string
): Promise< Record< string, unknown > > {
	const fileContents = await readFile( resolveBodyFilePath( rootDir, bodyFile ), 'utf8' );
	let parsed: unknown;
	try {
		parsed = JSON.parse( fileContents );
	} catch {
		throw new Error( 'bodyFile must contain valid JSON.' );
	}
	if ( ! isRecord( parsed ) ) {
		throw new Error( 'bodyFile JSON must be an object.' );
	}
	return parsed;
}

async function mergeBodyFiles(
	toolName: string,
	body: Record< string, unknown > | undefined,
	bodyFiles: Record< string, string > | undefined,
	rootDir: string
): Promise< Record< string, unknown > > {
	const mergedBody: Record< string, unknown > = { ...( body ?? {} ) };

	if ( ! bodyFiles ) {
		return mergedBody;
	}

	for ( const [ key, filePath ] of Object.entries( bodyFiles ) ) {
		validateBodyFileFieldName( key );
		if ( body && hasOwnProperty( body, key ) ) {
			throw new Error(
				`${ toolName } defines both body.${ key } and bodyFiles.${ key }. Put file-backed fields only in bodyFiles.`
			);
		}

		mergedBody[ key ] = await readFile( resolveBodyFilePath( rootDir, filePath ), 'utf8' );
	}

	return mergedBody;
}

export async function resolveRequestBody(
	toolName: string,
	body: Record< string, unknown > | undefined,
	bodyFile: string | undefined,
	bodyFiles: Record< string, string > | undefined,
	rootDir: string
): Promise< Record< string, unknown > > {
	validateSingleBodySource( body, bodyFile, bodyFiles );
	if ( bodyFile ) {
		return readBodyFile( bodyFile, rootDir );
	}
	return mergeBodyFiles( toolName, body, bodyFiles, rootDir );
}
