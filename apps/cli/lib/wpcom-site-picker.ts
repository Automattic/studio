import { search } from '@inquirer/prompts';
import chalk from '@studio/common/lib/chalk';
import { __ } from '@wordpress/i18n';
import { type WpComSiteInfo } from 'cli/lib/api';
import { normalizeHostname } from 'cli/lib/utils';

/**
 * Renders one WordPress.com site as a picker choice label: the site
 * name followed by a dimmed hostname.  Unlike `pickSyncSite`'s
 * formatter there are no staging/sync-support badges — `WpComSiteInfo`
 * carries only `{ id, name, url }`.
 */
function formatSiteChoice( site: WpComSiteInfo ): string {
	return `${ site.name } ${ chalk.dim( normalizeHostname( site.url ) ) }`;
}

/**
 * Interactive, searchable WordPress.com site picker.
 *
 * A trimmed clone of `pickSyncSite` (`apps/cli/lib/sync-site-picker.ts`)
 * for the `pull-reprint` source-selection flow.  Because `WpComSiteInfo`
 * has no `syncSupport`/`isStaging`, this drops all the disabled-entry,
 * staging-badge, and sync-support logic — every site is selectable.
 *
 * Type-to-filter matches on the site name and normalized hostname.  Esc
 * cancels the prompt (TTY only, via an `AbortController` wired to the
 * raw escape byte) and resolves to `undefined`, as does Ctrl-C — so the
 * caller can treat a cancellation as a clean no-op rather than an error.
 */
export async function pickWpComSite(
	sites: WpComSiteInfo[],
	message: string
): Promise< WpComSiteInfo | undefined > {
	if ( sites.length === 0 ) {
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
							normalizeHostname( site.url ).toLowerCase().includes( lowerTerm )
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
