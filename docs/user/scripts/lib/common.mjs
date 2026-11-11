import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve( fileURLToPath( import.meta.url ), '../../..' );
export const SCREENSHOTS_DIR = path.join( ROOT, 'screenshots' );
export const SHOTS_DIR = path.join( SCREENSHOTS_DIR, 'shots' );
export const FIXTURES_DIR = path.join( SCREENSHOTS_DIR, 'fixtures' );
export const DEMO_SITE_DIR = path.join( SCREENSHOTS_DIR, 'demo-site' );

export async function readJson( file ) {
	return JSON.parse( await readFile( file, 'utf8' ) );
}

export function slugify( label ) {
	return label
		.toLowerCase()
		.trim()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' );
}
