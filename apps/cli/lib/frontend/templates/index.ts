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
import { detectNodeRuntime } from 'cli/lib/frontend/server';
import { LoggerError, type Logger } from 'cli/logger';
import { getAstroTemplate } from './astro';
import { getNextTemplate } from './next';
import { toPackageName, type FrontendTemplateContext, type FrontendTemplateFiles } from './shared';
import { getStaticTemplate } from './static';

type FrontendTemplate = ( context: FrontendTemplateContext ) => FrontendTemplateFiles;

const MINIMUM_NODE_MAJOR_VERSION = 20;

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

function quoteForShell( value: string ): string {
	return `'${ value.replace( /'/g, `'\\''` ) }'`;
}

function getNodeMajorVersion( version: string ): number {
	return Number.parseInt( version.replace( /^v/, '' ), 10 );
}

function getInstallRetryHint( frontend: SiteFrontend ): string {
	return sprintf(
		/* translators: %1$d: minimum Node.js major version, %2$s: frontend folder */
		__(
			'The frontend needs Node.js %1$d or later. Install it (for example from nodejs.org or with nvm), then run "npm install" in %2$s and start the site again.'
		),
		MINIMUM_NODE_MAJOR_VERSION,
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

	const runtime = await detectNodeRuntime().catch( () => undefined );
	if ( ! runtime || getNodeMajorVersion( runtime.version ) < MINIMUM_NODE_MAJOR_VERSION ) {
		const found = runtime
			? sprintf(
					/* translators: %s: the Node.js version found */
					__( 'Found Node.js %s.' ),
					runtime.version
			  )
			: __( 'No Node.js was found.' );
		throw new LoggerError( `${ found } ${ getInstallRetryHint( frontend ) }` );
	}

	const npm = runtime.npmPath ?? 'npm';
	const npmArgs = [ 'install', '--no-audit', '--no-fund' ];
	let output = '';
	const exitCode = await new Promise< number >( ( resolve, reject ) => {
		const child =
			process.platform === 'win32'
				? spawn( 'npm', npmArgs, { cwd: frontend.path, shell: true, env: process.env } )
				: spawn(
						process.env.SHELL || '/bin/sh',
						[
							'-lc',
							`export PATH=${ quoteForShell(
								path.dirname( runtime.nodePath )
							) }:"$PATH"; exec ${ quoteForShell( npm ) } ${ npmArgs.join( ' ' ) }`,
						],
						{ cwd: frontend.path, env: process.env }
				  );
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
