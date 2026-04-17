import { search } from '@inquirer/prompts';
import { __ } from '@wordpress/i18n';
import chalk from 'chalk';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';

function formatSiteChoice( site: SiteData ): string {
	return `${ site.name } ${ chalk.dim( site.path ) }`;
}

export async function pickLocalSite( message: string ): Promise< SiteData | undefined > {
	const config = await readCliConfig();
	const sites = config.sites;

	if ( sites.length === 0 ) {
		console.log( __( 'No Studio sites found. Create one with `studio site create`.' ) );
		return undefined;
	}

	const choices = sites.map( ( site ) => ( {
		name: formatSiteChoice( site ),
		value: site.id,
	} ) );

	const abortController = new AbortController();
	const handleEscKey = ( chunk: Buffer | string ) => {
		const bytes = Buffer.isBuffer( chunk ) ? chunk : Buffer.from( chunk );
		if ( bytes.length === 1 && bytes[ 0 ] === 0x1b ) {
			abortController.abort();
		}
	};

	if ( process.stdin.isTTY ) {
		process.stdin.on( 'data', handleEscKey );
	}

	try {
		const selectedId = await search(
			{
				message,
				source: ( term ) => {
					if ( ! term ) {
						return choices;
					}
					const lowerTerm = term.toLowerCase();
					return choices.filter( ( choice ) => {
						const site = sites.find( ( s ) => s.id === choice.value );
						if ( ! site ) {
							return false;
						}
						return (
							site.name.toLowerCase().includes( lowerTerm ) ||
							site.path.toLowerCase().includes( lowerTerm )
						);
					} );
				},
				pageSize: 12,
				theme: {
					style: {
						keysHelpTip: () =>
							chalk.dim(
								[
									__( '↑↓ navigate' ),
									__( 'type to filter' ),
									__( '⏎ select' ),
									__( 'esc cancel' ),
								].join( ' · ' )
							),
					},
				},
			},
			{
				signal: abortController.signal,
			}
		);

		return sites.find( ( site ) => site.id === selectedId );
	} catch ( error ) {
		if (
			error instanceof Error &&
			( error.name === 'AbortPromptError' || error.name === 'ExitPromptError' )
		) {
			return undefined;
		}
		throw error;
	} finally {
		if ( process.stdin.isTTY ) {
			process.stdin.off( 'data', handleEscKey );
		}
	}
}
