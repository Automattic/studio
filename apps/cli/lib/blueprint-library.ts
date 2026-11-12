import fs from 'fs';
import { fetchLibraryBlueprints, type LibraryBlueprint } from '@studio/blueprints';
import { openBlueprint } from '@studio/blueprints/node';
import { isNetworkError } from '@studio/common/lib/network-utils';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import { __ } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';

function toLoggerError( error: unknown, hint?: string ): never {
	if ( isNetworkError( error ) ) {
		throw new LoggerError( __( 'An internet connection is required to use blueprints.' ), error );
	}
	throw error instanceof Error && ! ( error instanceof LoggerError )
		? new LoggerError( hint ? `${ error.message } ${ hint }` : error.message )
		: error;
}

export async function loadLibraryBlueprints(): Promise< LibraryBlueprint[] > {
	const { locale } = await readSharedConfig();
	return fetchLibraryBlueprints( { locale } ).catch( ( error ) => toLoggerError( error ) );
}

/** Opens a Blueprint for the CLI, in the Library of the user's language when it's a slug. */
export async function openBlueprintSource( source: string | LibraryBlueprint ) {
	const { locale } = await readSharedConfig();
	const isSlug =
		typeof source === 'string' && /^[\w-]+$/.test( source ) && ! fs.existsSync( source );
	const hint = isSlug ? __( 'Run "studio blueprint list" to see available slugs.' ) : undefined;
	return openBlueprint( source, { locale } ).catch( ( error ) => toLoggerError( error, hint ) );
}
