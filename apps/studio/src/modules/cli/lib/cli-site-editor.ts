import { SiteCommandLoggerAction } from '@studio/common/logger-actions';
import { z } from 'zod';
import { executeCliCommand } from './execute-command';

const cliEventSchema = z.object( {
	action: z.enum( SiteCommandLoggerAction ),
	status: z.enum( [ 'inprogress', 'fail', 'success', 'warning' ] ),
	message: z.string(),
} );

export interface EditSiteOptions {
	path: string;
	siteId: string;
	name?: string;
	domain?: string;
	https?: boolean;
	php?: string;
	wp?: string;
	xdebug?: boolean;
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	debugLog?: boolean;
	debugDisplay?: boolean;
}

export async function editSiteViaCli( options: EditSiteOptions ): Promise< void > {
	const args = buildCliArgs( options );
	console.log( `[CLI Site Editor] Executing: studio ${ args.join( ' ' ) }` );

	return new Promise( ( resolve, reject ) => {
		const [ emitter ] = executeCliCommand( args, { output: 'capture', logPrefix: options.siteId } );

		emitter.on( 'data', ( { data } ) => {
			const parsed = cliEventSchema.safeParse( data );
			if ( ! parsed.success ) {
				return;
			}

			if ( parsed.data.status === 'inprogress' ) {
				console.log( `[CLI - ${ options.siteId }] ${ parsed.data.message }` );
			}
		} );

		emitter.on( 'success', () => {
			resolve();
		} );

		emitter.on( 'failure', ( { error } ) => {
			error.baseMessage = 'Failed to edit site';
			reject( error );
		} );

		emitter.on( 'error', ( { error } ) => {
			reject( error );
		} );
	} );
}

function buildCliArgs( options: EditSiteOptions ): string[] {
	const args = [ 'site', 'set', '--path', options.path ];

	if ( options.name !== undefined ) {
		args.push( '--name', options.name );
	}

	if ( options.domain !== undefined ) {
		args.push( '--domain', options.domain );
	}

	if ( options.https !== undefined ) {
		args.push( options.https ? '--https' : '--no-https' );
	}

	if ( options.php !== undefined ) {
		args.push( '--php', options.php );
	}

	if ( options.wp !== undefined ) {
		args.push( '--wp', options.wp );
	}

	if ( options.xdebug !== undefined ) {
		args.push( options.xdebug ? '--xdebug' : '--no-xdebug' );
	}

	if ( options.adminUsername !== undefined ) {
		args.push( '--admin-username', options.adminUsername );
	}

	if ( options.adminPassword !== undefined ) {
		args.push( '--admin-password', options.adminPassword );
	}

	if ( options.adminEmail !== undefined ) {
		args.push( '--admin-email', options.adminEmail );
	}

	if ( options.debugLog !== undefined ) {
		args.push( options.debugLog ? '--debug-log' : '--no-debug-log' );
	}

	if ( options.debugDisplay !== undefined ) {
		args.push( options.debugDisplay ? '--debug-display' : '--no-debug-display' );
	}

	return args;
}
