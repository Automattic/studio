import { promises as fsPromises } from 'fs';
import path from 'path';
import ignore, { Ignore } from 'ignore';
import { isErrnoException } from './is-errno-exception';

/**
 * Default patterns excluded from deploys. These are pre-seeded
 * but can be overridden via negation patterns in .deployignore.
 */
export const DEPLOY_IGNORE_DEFAULTS = [ '.git', 'node_modules', '.DS_Store', 'Thumbs.db' ];

const DEPLOY_IGNORE_FILENAME = '.deployignore';

/**
 * Creates an Ignore instance seeded with hardcoded defaults
 * and any patterns from a .deployignore file at the given root.
 *
 * @param rootPath - The site root directory to look for .deployignore in
 */
export async function createDeployIgnoreFilter( rootPath: string ): Promise< Ignore > {
	const ig = ignore().add( DEPLOY_IGNORE_DEFAULTS );

	const deployIgnorePath = path.join( rootPath, DEPLOY_IGNORE_FILENAME );
	try {
		const content = await fsPromises.readFile( deployIgnorePath, 'utf-8' );
		ig.add( content );
	} catch ( error: unknown ) {
		if ( ! isErrnoException( error ) || error.code !== 'ENOENT' ) {
			console.warn( `Failed to read ${ deployIgnorePath }:`, error );
		}
	}

	return ig;
}
