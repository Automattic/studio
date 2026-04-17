import fs from 'fs';
import path from 'path';
import { pathExists } from '@studio/common/lib/fs-utils';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

interface LinkedTheme {
	name: string;
	sourcePath: string;
}

async function getLinkedThemes( sitePath: string ): Promise< LinkedTheme[] > {
	const themesDir = path.join( sitePath, 'wp-content', 'themes' );

	if ( ! ( await pathExists( themesDir ) ) ) {
		return [];
	}

	const entries = await fs.promises.readdir( themesDir, { withFileTypes: true } );
	const linkedThemes: LinkedTheme[] = [];

	for ( const entry of entries ) {
		const entryPath = path.join( themesDir, entry.name );

		try {
			const stats = await fs.promises.lstat( entryPath );
			if ( stats.isSymbolicLink() ) {
				const linkTarget = await fs.promises.readlink( entryPath );
				const resolvedTarget = path.resolve( path.dirname( entryPath ), linkTarget );

				linkedThemes.push( {
					name: entry.name,
					sourcePath: resolvedTarget,
				} );
			}
		} catch {
			// Skip entries we can't read
			continue;
		}
	}

	return linkedThemes;
}

export async function runCommand( sitePath: string, format: 'table' | 'json' ): Promise< void > {
	// Validate site exists
	await getSiteByFolder( sitePath );

	const linkedThemes = await getLinkedThemes( sitePath );

	if ( format === 'json' ) {
		console.log( JSON.stringify( linkedThemes, null, 2 ) );
		return;
	}

	if ( linkedThemes.length === 0 ) {
		console.log( __( 'No linked themes found.' ) );
		console.log( __( 'Use "studio theme link <source-path>" to link an external theme.' ) );
		return;
	}

	console.log( sprintf( __( 'Found %d linked theme(s):' ), linkedThemes.length ) );
	console.log();

	for ( const theme of linkedThemes ) {
		console.log( `  ${ theme.name }` );
		console.log( `    → ${ theme.sourcePath }` );
		console.log();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'list-linked',
		describe: __( 'List all linked themes in the site' ),
		builder: ( listYargs ) => {
			return listYargs.option( 'format', {
				type: 'string',
				choices: [ 'table', 'json' ] as const,
				default: 'table' as const,
				describe: __( 'Output format' ),
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.format as 'table' | 'json' );
			} catch ( error ) {
				process.exitCode = 1;
				if ( error instanceof LoggerError ) {
					console.error( error.message );
				} else if ( error instanceof Error ) {
					console.error( __( 'Failed to list linked themes' ), error.message );
				}
			}
		},
	} );
};
