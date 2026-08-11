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
