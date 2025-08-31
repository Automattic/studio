import fs from 'fs';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import { DEMO_SITE_SIZE_LIMIT_BYTES, DEMO_SITE_SIZE_LIMIT_GB } from 'common/constants';
import { calculateDirectorySize, isWordPressDirectory } from 'common/lib/fs-utils';

export interface ValidationResult {
	valid: boolean;
	error?: string;
}

export function validateReadSitePath(
	sitePath: string,
	ignoreWordPressCheck: boolean = false
): ValidationResult {
	if ( ! fs.existsSync( sitePath ) ) {
		return { valid: false, error: sprintf( __( 'Folder not found: %s' ), sitePath ) };
	}

	const stat = fs.statSync( sitePath );
	if ( ! stat.isDirectory() ) {
		return { valid: false, error: __( 'Path must be a directory' ) };
	}

	if ( ! ignoreWordPressCheck && ! isWordPressDirectory( sitePath ) ) {
		return {
			valid: false,
			error: __(
				`The specified folder doesn't appear to be a WordPress site. ` +
					`Please ensure it contains a wp-content directory.`
			),
		};
	}

	return { valid: true };
}

export function validateCreateSitePath( sitePath: string ): ValidationResult {
	const resolvedPath = path.resolve( sitePath );

	if ( fs.existsSync( resolvedPath ) ) {
		const stat = fs.statSync( resolvedPath );
		if ( ! stat.isDirectory() ) {
			return { valid: false, error: __( 'Path must be a directory' ) };
		}

		const files = fs.readdirSync( resolvedPath );
		if ( files.length > 0 ) {
			return {
				valid: false,
				error: __( 'Directory is not empty' ),
			};
		}
		return { valid: true };
	} else {
		const parentDir = path.dirname( resolvedPath );
		if ( ! fs.existsSync( parentDir ) ) {
			return {
				valid: false,
				error: sprintf( __( 'Parent directory does not exist: %s' ), parentDir ),
			};
		}

		try {
			fs.accessSync( parentDir, fs.constants.W_OK );
		} catch {
			return {
				valid: false,
				error: sprintf( __( 'Cannot write to parent directory: %s' ), parentDir ),
			};
		}

		return { valid: true };
	}
}

export async function validateSiteSize( siteFolder: string ): Promise< ValidationResult > {
	const wpContentPath = path.join( siteFolder, 'wp-content' );
	const wpContentSize = await calculateDirectorySize( wpContentPath );

	if ( wpContentSize > DEMO_SITE_SIZE_LIMIT_BYTES ) {
		return {
			valid: false,
			error: sprintf(
				__(
					'Your site exceeds the %d GB size limit. Please, consider removing unnecessary media files, plugins, or themes from wp-content.'
				),
				DEMO_SITE_SIZE_LIMIT_GB
			),
		};
	}

	return { valid: true };
}
