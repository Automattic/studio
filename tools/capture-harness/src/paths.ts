import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { HARNESS_DIR } from './locate.ts';

export { HARNESS_DIR, REPO_ROOT } from './locate.ts';
export const LOOKS_DIR = path.join( HARNESS_DIR, 'looks' );
export const SCENES_DIR = path.join( HARNESS_DIR, 'scenes' );
export const SCHEMAS_DIR = path.join( HARNESS_DIR, 'schemas' );
export const PERSONAS_DIR = path.join( HARNESS_DIR, 'personas' );

export const DEFAULT_SCENE = 'moire';
export const DEFAULT_LOOK = 'plain';
export const DEFAULT_PERSONA = 'maya-okafor';

export async function readJson< T = unknown >( file: string ): Promise< T > {
	return JSON.parse( await readFile( file, 'utf8' ) ) as T;
}

export const isUrl = ( value: string ) => /^https?:\/\//i.test( value );

/** The first line of an error's message, for one-line reports. */
export const firstLine = ( error: unknown ) =>
	( error instanceof Error ? error.message : String( error ) ).split( '\n' )[ 0 ];
