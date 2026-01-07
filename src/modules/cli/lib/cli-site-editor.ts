import { z } from 'zod';
import { SiteCommandLoggerAction } from 'common/logger-actions';
import { executeCliCommand } from './execute-command';

const cliEventSchema = z.object( {
	action: z.nativeEnum( SiteCommandLoggerAction ),
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
}

export async function editSiteViaCli( options: EditSiteOptions ): Promise< void > {
	const args = buildCliArgs( options );

	return new Promise( ( resolve, reject ) => {
		let lastErrorMessage: string | null = null;

		const [ emitter ] = executeCliCommand( args, { output: 'capture', logPrefix: options.siteId } );

		emitter.on( 'data', ( { data } ) => {
			const parsed = cliEventSchema.safeParse( data );
			if ( ! parsed.success ) {
				return;
			}

			if ( parsed.data.status === 'inprogress' ) {
				console.log( `[CLI - ${ options.siteId }] ${ parsed.data.message }` );
			} else if ( parsed.data.status === 'fail' ) {
				lastErrorMessage = parsed.data.message;
			}
		} );

		emitter.on( 'success', () => {
			resolve();
		} );

		emitter.on( 'failure', () => {
			reject( new Error( lastErrorMessage || 'CLI site set failed' ) );
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

	return args;
}
