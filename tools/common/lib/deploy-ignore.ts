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
 * Creates an Ignore instance seeded with the given base patterns
 * and any patterns from a .deployignore file at the given root.
 *
 * @param rootPath - The site root directory to look for .deployignore in
 * @param basePatterns - Patterns to pre-seed the ignore filter with (defaults to DEPLOY_IGNORE_DEFAULTS)
 */
export async function createDeployIgnoreFilter(
	rootPath: string,
	basePatterns: string[] = DEPLOY_IGNORE_DEFAULTS
): Promise< Ignore > {
	const ig = ignore().add( basePatterns );

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
