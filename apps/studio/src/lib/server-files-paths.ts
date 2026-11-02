import path from 'path';
import { getCliPath } from 'src/storage/paths';

/**
 * The path where bundled agent skills live inside the CLI bundle.
 * These are installed into each site's `.agents/skills/` directory, so the source
 * is read-only and does not need a writable cache.
 */
export function getBundledSkillsPath(): string {
	return path.join( path.dirname( getCliPath() ), 'wp-files', 'skills' );
}
