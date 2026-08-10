import os from 'node:os';
import { parse as parsePath } from 'node:path';
import { SupportedPHPVersion, SupportedPHPVersions } from '@php-wasm/universal';
import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { LoggerError } from 'cli/logger';

// Coarse, low-cardinality classification of a preview-site create/update failure for the
// `failure_reason` Tracks prop. Never send the raw error message: it can carry site URLs and
// filesystem paths (PII), and its high cardinality would make the prop unqueryable. Mirrors
// `classifyStartFailure` in `wordpress-server-manager.ts`.
export function classifyPreviewFailure( error: unknown ): string {
	const message = error instanceof Error ? error.message : String( error );
	const normalized = message.toLowerCase();
	if ( normalized.includes( 'authentication' ) || normalized.includes( 'log in' ) ) {
		return 'auth_required';
	}
	if ( normalized.includes( 'size limit' ) || normalized.includes( 'exceeds' ) ) {
		return 'size_limit';
	}
	if ( normalized.includes( 'expired' ) ) {
		return 'expired';
	}
	if ( normalized.includes( 'not found' ) ) {
		return 'not_found';
	}
	if ( normalized.includes( 'timeout' ) || normalized.includes( 'timed out' ) ) {
		return 'timeout';
	}
	if ( normalized.includes( 'upload' ) ) {
		return 'upload';
	}
	return 'unknown';
}

// Import/export failure buckets for the `failure_reason` Tracks prop, keyed by the exact msgid used
// at the throw site. These errors are thrown with `__()`-built messages in this same process, so
// translating the msgid at classification time reproduces the exact localized string — matching
// works regardless of the active locale (and falls back to English when no translation is loaded).
// Ordered: the first matching msgid wins.
const IMPORT_FAILURE_BUCKETS: Array< [ string, string ] > = [
	[
		'Cannot set up WordPress. Bundled WordPress files not found. Please connect to the internet or reinstall Studio.',
		'bundled_wp_missing',
	],
	[ 'Import file not found: %s', 'file_not_found' ],
	[ 'Input file at location "%s" could not be found.', 'file_not_found' ],
	[ 'No suitable backup handler found for the provided backup file', 'no_backup_handler' ],
	[ 'No suitable importer found for the provided backup contents', 'no_importer_found' ],
	[ 'Backup validation failed', 'validation' ],
	[ 'Failed to extract backup', 'extract' ],
	[ 'Database import failed: %s', 'database_import' ],
	[ 'WordPress export import failed: %s', 'wxr_import' ],
];

const EXPORT_FAILURE_BUCKETS: Array< [ string, string ] > = [
	[ 'No suitable exporter found for the provided backup file', 'no_exporter_found' ],
	[ 'Database export failed', 'database_export' ],
	[ 'Database export failed for table %s', 'database_export' ],
	[ 'Could not get list of database tables to export.', 'database_export' ],
	[ 'Failed to get site plugins: %s', 'site_meta' ],
	[ 'Failed to get site themes: %s', 'site_meta' ],
	[ 'Could not parse information about installed plugins to create meta.json file.', 'site_meta' ],
	[ 'Could not parse information about installed themes to create meta.json file.', 'site_meta' ],
];

// Translates the msgid, strips sprintf placeholders, and requires every remaining static chunk to
// appear in the message. Chunk-based matching keeps this order-independent, so translations that
// move the placeholder around still match.
function matchesTranslatedMessage( normalizedMessage: string, msgid: string ): boolean {
	const chunks = __( msgid )
		.toLowerCase()
		.split( /%(?:\d+\$)?[sd]/ )
		.map( ( chunk ) => chunk.trim() )
		.filter( ( chunk ) => chunk.length > 2 );
	return chunks.length > 0 && chunks.every( ( chunk ) => normalizedMessage.includes( chunk ) );
}

function classifyFailureMessage(
	error: unknown,
	buckets: Array< [ string, string ] >,
	untranslatedBuckets: Array< [ string[], string ] >
): string {
	const message = error instanceof Error ? error.message : String( error );
	const normalized = message.toLowerCase();
	for ( const [ substrings, bucket ] of untranslatedBuckets ) {
		if ( substrings.some( ( substring ) => normalized.includes( substring ) ) ) {
			return bucket;
		}
	}
	for ( const [ msgid, bucket ] of buckets ) {
		if ( matchesTranslatedMessage( normalized, msgid ) ) {
			return bucket;
		}
	}
	return 'unknown';
}

// Coarse classification of a site import failure for the `failure_reason` Tracks prop. Same
// constraints as `classifyPreviewFailure`: never send the raw message (carries file paths).
// In standalone-logger mode errors arrive as `LoggerError` wrappers whose `.message` getter
// appends the inner error's message, so inner-message matching still works. System/library
// errors (ENOSPC, unzipper) are never translated and are matched first, so a disk-full error
// during any phase wins over the phase's own bucket.
export function classifyImportFailure( error: unknown ): string {
	return classifyFailureMessage( error, IMPORT_FAILURE_BUCKETS, [
		[ [ 'enospc', 'no space left' ], 'disk_full' ],
		[ [ 'absolute path' ], 'invalid_zip' ],
	] );
}

// Coarse classification of a site export failure for the `failure_reason` Tracks prop.
export function classifyExportFailure( error: unknown ): string {
	return classifyFailureMessage( error, EXPORT_FAILURE_BUCKETS, [
		[ [ 'enospc', 'no space left' ], 'disk_full' ],
	] );
}

export function normalizeHostname( hostname: string ): string {
	return hostname
		.trim()
		.toLowerCase()
		.replace( /^https?:\/\//, '' )
		.replace( /\/$/, '' );
}

export function validatePhpVersion( rawPhpVersion: string ): SupportedPHPVersion {
	const phpVersionSchema = z.enum( SupportedPHPVersions );
	const result = phpVersionSchema.safeParse( rawPhpVersion );
	if ( ! result.success ) {
		throw new LoggerError( sprintf( __( 'Unsupported PHP version: %s' ), rawPhpVersion ) );
	}
	return result.data;
}

export function getColumnWidths( widthFactors: number[] ) {
	const padding = widthFactors.length * 2;
	const columns = Math.min( process.stdout.columns || 80, 140 ) - padding;
	return widthFactors.map( ( widthFactor ) => Math.round( widthFactor * columns ) );
}

export function getPrettyPath( path: string ): string {
	const cwd = process.cwd();
	const root = parsePath( cwd ).root;

	// If cwd is system root, don't replace it. Otherwise `/Users/foo/bar` becomes `.Users/foo/bar`
	if ( cwd !== root ) {
		path = path.replace( cwd, '.' );
	}

	if ( process.platform === 'win32' ) {
		return path;
	}

	return path.replace( os.homedir(), '~' );
}

// `~` is a shell construct on Posix platforms. The shell expands it to the user's home directory
// if it's at the beginning of a word, like this: `--path ~/test`. If users specify an option like
// this: `--path=~/test`, then it's not expanded, and we need to do it in code.
export function untildify( path: string ): string {
	return process.platform === 'win32' ? path : path.replace( /^~/, os.homedir() );
}
