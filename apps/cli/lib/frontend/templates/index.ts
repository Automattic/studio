/**
 * Studio-owned frontend templates for headless sites: a handful of files each,
 * so the WordPress glue (env contract, previews, revalidation) is right on
 * first run and the agent owns everything after.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { type SiteFrontend, type SiteFrontendFramework } from '@studio/common/lib/site-frontend';
import { SiteCommandLoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { MIN_FRONTEND_NODE_MAJOR, requireNodeRuntime } from 'cli/lib/frontend/server';
import { buildShellInvocation, prependToPath } from 'cli/lib/frontend/shell';
import { LoggerError, type Logger } from 'cli/logger';
import { getAstroTemplate } from './astro';
import { getNextTemplate } from './next';
import { toPackageName, type FrontendTemplateContext, type FrontendTemplateFiles } from './shared';
import { getStaticTemplate } from './static';

type FrontendTemplate = ( context: FrontendTemplateContext ) => FrontendTemplateFiles;

export function getFrontendTemplate( framework: SiteFrontendFramework ): FrontendTemplate {
	switch ( framework ) {
		case 'static':
			return getStaticTemplate;
		case 'astro':
			return getAstroTemplate;
		case 'next':
			return getNextTemplate;
		default:
			throw new LoggerError(
				sprintf( __( 'There is no frontend template for "%s".' ), framework )
			);
	}
}

/**
 * Writes the template into `frontend.path`. Files that already exist are left
 * alone, so it never overwrites the user's work. Returns the files it wrote.
 */
export async function scaffoldFrontend(
	frontend: SiteFrontend,
	siteName: string,
	wordpressUrl: string
): Promise< string[] > {
	const template = getFrontendTemplate( frontend.framework ?? 'static' );
	const files = template( {
		siteName,
		packageName: toPackageName( siteName ),
		wordpressUrl: wordpressUrl.replace( /\/$/, '' ),
		frontend,
	} );

	const written: string[] = [];
	for ( const [ relativePath, content ] of Object.entries( files ) ) {
		const filePath = path.join( frontend.path, relativePath );
		await fs.promises.mkdir( path.dirname( filePath ), { recursive: true } );
		try {
			await fs.promises.writeFile( filePath, content, { flag: 'wx' } );
			written.push( relativePath );
		} catch ( error ) {
			if ( ( error as NodeJS.ErrnoException ).code !== 'EEXIST' ) {
				throw error;
			}
		}
	}
	return written;
}

function getInstallRetryHint( frontend: SiteFrontend ): string {
	return sprintf(
		/* translators: %1$d: minimum Node.js major version, %2$s: frontend folder */
		__(
			'The frontend needs Node.js %1$d or later. Install it (for example from nodejs.org or with nvm), then run "npm install" in %2$s and start the site again.'
		),
		MIN_FRONTEND_NODE_MAJOR,
		frontend.path
	);
}

/**
 * Runs `npm install` in the frontend folder through the user's login shell, so
 * the Node that nvm, volta, fnm or Homebrew put on their PATH is the one used.
 */
export async function installFrontendDependencies(
	frontend: SiteFrontend,
	logger: Logger< string >
): Promise< void > {
	logger.reportStart(
		SiteCommandLoggerAction.SETUP_FRONTEND,
		__( 'Installing frontend dependencies…' )
	);

	let runtime;
	try {
		runtime = await requireNodeRuntime( 'npm install' );
	} catch ( error ) {
		const reason = error instanceof Error ? error.message : String( error );
		throw new LoggerError( `${ reason } ${ getInstallRetryHint( frontend ) }` );
	}

	const invocation = buildShellInvocation( 'npm install --no-audit --no-fund' );
	let output = '';
	const exitCode = await new Promise< number >( ( resolve, reject ) => {
		const child = spawn( invocation.file, invocation.args, {
			cwd: frontend.path,
			env: prependToPath( process.env, path.dirname( runtime.nodePath ) ),
			windowsHide: true,
			windowsVerbatimArguments: invocation.windowsVerbatimArguments,
		} );
		const collect = ( chunk: Buffer ) => {
			output = ( output + chunk.toString() ).slice( -8000 );
			const line = chunk.toString().trim().split( '\n' ).pop();
			if ( line ) {
				logger.reportProgress( line );
			}
		};
		child.stdout?.on( 'data', collect );
		child.stderr?.on( 'data', collect );
		child.once( 'error', reject );
		child.once( 'close', ( code ) => resolve( code ?? 1 ) );
	} ).catch( ( error: unknown ) => {
		throw new LoggerError( getInstallRetryHint( frontend ), error );
	} );

	if ( exitCode !== 0 ) {
		throw new LoggerError(
			sprintf(
				/* translators: %s: how to fix and retry */
				__( 'npm install failed in the frontend folder. %s' ),
				getInstallRetryHint( frontend )
			),
			new Error( output.trim() )
		);
	}

	logger.reportSuccess(
		sprintf(
			/* translators: %s: the Node.js version used */
			__( 'Frontend dependencies installed (Node.js %s)' ),
			runtime.version
		)
	);
}
