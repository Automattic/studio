import os from 'node:os';
import { parse as parsePath } from 'node:path';
import { resolveSupportedPhpVersion } from '@studio/common/lib/php-binary-metadata';
import { __, sprintf } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';

// The known import/export/preview failure points throw `LoggerError`s tagged with a machine-readable
// `code`, which these classifiers return as the `failure_reason` Tracks prop. Classifying on the
// code rather than the message keeps this locale-independent — messages are `__()`-translated
// display text. Walks the `previousError` chain so a code survives generic wrapping.
export function findFailureCode( error: unknown ): string | undefined {
	let current: unknown = error;
	while ( current instanceof LoggerError ) {
		if ( current.code ) {
			return current.code;
		}
		current = current.previousError;
	}
	return undefined;
}

// System/library errors carry no code and are never translated, so they are matched by substring
// on the full message chain — checked before the code walk so a disk-full error during any phase
// wins over the phase's own bucket. Never send the raw message: it carries filesystem paths.
function classifyFailure(
	error: unknown,
	untranslatedBuckets: Array< [ string[], string ] >,
	fallback = 'unknown'
): string {
	const message = error instanceof Error ? error.message : String( error );
	const normalized = message.toLowerCase();
	for ( const [ substrings, bucket ] of untranslatedBuckets ) {
		if ( substrings.some( ( substring ) => normalized.includes( substring ) ) ) {
			return bucket;
		}
	}
	return findFailureCode( error ) ?? fallback;
}

// Coarse classification of a site import failure for the `failure_reason` Tracks prop.
export function classifyImportFailure( error: unknown ): string {
	return classifyFailure( error, [
		[ [ 'enospc', 'no space left' ], 'disk_full' ],
		[ [ 'absolute path' ], 'invalid_zip' ],
	] );
}

// Coarse classification of a site export failure for the `failure_reason` Tracks prop.
export function classifyExportFailure( error: unknown ): string {
	return classifyFailure( error, [ [ [ 'enospc', 'no space left' ], 'disk_full' ] ] );
}

// Coarse classification of a preview-site create/update failure for the `failure_reason` Tracks
// prop. An error without a code reports the step it failed in (e.g. `archive`), so no failure
// is left unattributed.
export function classifyPreviewFailure( error: unknown, step?: string ): string {
	return classifyFailure( error, [ [ [ 'enospc', 'no space left' ], 'disk_full' ] ], step );
}

export function validatePhpVersion( rawPhpVersion: string ): SupportedPHPVersion {
	try {
		return resolveSupportedPhpVersion( rawPhpVersion );
	} catch {
		throw new LoggerError( sprintf( __( 'Unsupported PHP version: %s' ), rawPhpVersion ) );
	}
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
