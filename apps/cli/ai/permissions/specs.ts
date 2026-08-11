// Human-readable confirmation copy for each gated tool. `describe()` runs
// inside the permission extension right before the user is asked, so it can
// resolve sites and count preview snapshots — but it must never throw: a
// failed lookup falls back to generic copy (the tool call itself will surface
// the real error if the arguments are bad).

import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { __, _n, sprintf } from '@wordpress/i18n';
import { resolveSite } from 'cli/ai/tools/utils';
import { getSnapshotsFromConfig } from 'cli/lib/cli-config/snapshots';
import { classifyWpCliCommand, parseWpCliCommand } from './wp-cli-classifier';
import type { GatedToolName, ToolPermissionLevel } from '@studio/common/ai/tool-permissions';
import type { SiteData } from 'cli/lib/cli-config/core';

export interface PermissionRequestDescription {
	title: string;
	consequences: string[];
}

export interface ToolPermissionSpec {
	describe: ( params: Record< string, unknown > ) => Promise< PermissionRequestDescription >;
	// Short noun phrase composed into the "Always allow …" choice. A function
	// so `__()` runs after translations load.
	actionLabel: () => string;
	// Resolved-state labels, rendered as a compact tool-call-style row once
	// the user has decided.
	allowedLabel: () => string;
	deniedLabel: () => string;
	// Optional per-call escalation. When present, only calls classified `ask`
	// prompt; everything else runs without confirmation (used by wp_cli).
	classify?: ( params: Record< string, unknown > ) => ToolPermissionLevel;
}

function asString( value: unknown ): string {
	return typeof value === 'string' ? value : '';
}

async function tryResolveSite( nameOrPath: unknown ): Promise< SiteData | null > {
	try {
		return await resolveSite( asString( nameOrPath ) );
	} catch {
		return null;
	}
}

async function countPreviewSites( sitePath: string ): Promise< number > {
	try {
		const authToken = await readAuthToken();
		if ( ! authToken ) {
			// Preview deletion requires auth; without a token none will be deleted.
			return 0;
		}
		const snapshots = await getSnapshotsFromConfig( authToken.id, sitePath );
		return snapshots.length;
	} catch {
		return 0;
	}
}

// Best-effort lookup of the push/pull target among the local site's connected
// WordPress.com sites, so the confirmation names the environment.
async function describeRemoteTarget(
	site: SiteData | null,
	remoteSite: unknown
): Promise< string > {
	const raw = asString( remoteSite );
	if ( ! site ) {
		return raw;
	}
	try {
		const connected = await getConnectedWpcomSitesForLocalSite( site.id );
		const match = connected.find(
			( candidate ) => String( candidate.id ) === raw || candidate.url === raw
		);
		if ( ! match ) {
			return raw;
		}
		const environment = match.isStaging ? __( 'staging' ) : __( 'production' );
		// translators: 1: remote site name, 2: environment (production/staging), 3: remote site URL
		return sprintf( __( '"%1$s" (%2$s, %3$s)' ), match.name, environment, match.url );
	} catch {
		return raw;
	}
}

function describeSyncScope( options: unknown ): string {
	const raw = asString( options );
	if ( ! raw || raw === 'all' ) {
		return __( 'Database, media uploads, plugins, and themes' );
	}
	// translators: %s: comma-separated sync options as passed to the tool (e.g. "sqls, themes")
	return sprintf( __( 'The selected content (%s)' ), raw.split( ',' ).join( ', ' ) );
}

export const TOOL_PERMISSION_SPECS: Record< GatedToolName, ToolPermissionSpec > = {
	site_delete: {
		// Never shown — site_delete does not support "Always allow" — but the
		// spec shape stays uniform.
		actionLabel: () => __( 'deleting sites' ),
		allowedLabel: () => __( 'Site deletion approved' ),
		deniedLabel: () => __( 'Site deletion denied' ),
		describe: async ( params ) => {
			const site = await tryResolveSite( params.nameOrPath );
			const siteName = site?.name ?? asString( params.nameOrPath );
			const deleteFiles = params.deleteFiles === true;

			const consequences: string[] = [];
			if ( deleteFiles ) {
				consequences.push(
					__( 'This will remove the site from Studio and move its files to the Trash.' )
				);
			} else {
				consequences.push(
					__( 'This will remove the site from Studio. Its files will stay on your computer.' )
				);
			}
			const previewCount = site ? await countPreviewSites( site.path ) : 0;
			if ( previewCount > 0 ) {
				consequences.push(
					sprintf(
						// translators: %d: number of preview sites
						_n(
							'%d preview site will be permanently deleted — this cannot be undone.',
							'%d preview sites will be permanently deleted — this cannot be undone.',
							previewCount
						),
						previewCount
					)
				);
			}
			if ( site?.customDomain ) {
				consequences.push(
					__( 'Its custom domain and SSL certificate are removed from this machine.' )
				);
			}

			return {
				// translators: %s: site name
				title: sprintf( __( 'Delete site “%s”?' ), siteName ),
				consequences,
			};
		},
	},

	preview_delete: {
		actionLabel: () => __( 'deleting preview sites' ),
		allowedLabel: () => __( 'Preview site deletion approved' ),
		deniedLabel: () => __( 'Preview site deletion denied' ),
		describe: async ( params ) => ( {
			// translators: %s: preview site hostname
			title: sprintf( __( 'Delete preview site “%s”?' ), asString( params.host ) ),
			consequences: [
				__( 'The hosted preview site will be permanently deleted — this cannot be undone.' ),
			],
		} ),
	},

	site_push: {
		actionLabel: () => __( 'pushing sites to WordPress.com' ),
		allowedLabel: () => __( 'Push to WordPress.com approved' ),
		deniedLabel: () => __( 'Push to WordPress.com denied' ),
		describe: async ( params ) => {
			const site = await tryResolveSite( params.nameOrPath );
			const localName = site?.name ?? asString( params.nameOrPath );
			const target = await describeRemoteTarget( site, params.remoteSite );
			return {
				// translators: 1: local site name, 2: remote site (name, environment, URL)
				title: sprintf( __( 'Push “%1$s” to %2$s?' ), localName, target ),
				consequences: [
					sprintf(
						// translators: %s: what will be overwritten (e.g. "Database, media uploads, plugins, and themes")
						__( '%s on the remote site will be overwritten with the local versions.' ),
						describeSyncScope( params.options )
					),
					__( 'Content that only exists on the remote site may be lost.' ),
				],
			};
		},
	},

	site_pull: {
		actionLabel: () => __( 'pulling sites from WordPress.com' ),
		allowedLabel: () => __( 'Pull from WordPress.com approved' ),
		deniedLabel: () => __( 'Pull from WordPress.com denied' ),
		describe: async ( params ) => {
			const site = await tryResolveSite( params.nameOrPath );
			const localName = site?.name ?? asString( params.nameOrPath );
			const target = await describeRemoteTarget( site, params.remoteSite );
			return {
				// translators: 1: remote site (name, environment, URL), 2: local site name
				title: sprintf( __( 'Pull %1$s into “%2$s”?' ), target, localName ),
				consequences: [
					sprintf(
						// translators: %s: what will be overwritten (e.g. "Database, media uploads, plugins, and themes")
						__( '%s on the local site will be overwritten with the remote versions.' ),
						describeSyncScope( params.options )
					),
					__( 'Local changes that were never pushed may be lost.' ),
				],
			};
		},
	},

	site_import: {
		actionLabel: () => __( 'importing backups into sites' ),
		allowedLabel: () => __( 'Backup import approved' ),
		deniedLabel: () => __( 'Backup import denied' ),
		describe: async ( params ) => {
			const site = await tryResolveSite( params.nameOrPath );
			const siteName = site?.name ?? asString( params.nameOrPath );
			return {
				// translators: 1: backup file path, 2: site name
				title: sprintf(
					__( 'Import “%1$s” into site “%2$s”?' ),
					asString( params.importFile ),
					siteName
				),
				consequences: [
					__( 'The site’s current database and files will be overwritten by the backup.' ),
				],
			};
		},
	},

	wp_cli: {
		actionLabel: () => __( 'destructive WP-CLI commands' ),
		allowedLabel: () => __( 'WP-CLI command approved' ),
		deniedLabel: () => __( 'WP-CLI command denied' ),
		classify: ( params ) => classifyWpCliCommand( asString( params.command ) ),
		describe: async ( params ) => {
			const site = await tryResolveSite( params.nameOrPath );
			const siteName = site?.name ?? asString( params.nameOrPath );
			return describeDestructiveWpCliCommand( asString( params.command ), siteName );
		},
	},
};

// Human copy for the destructive WP-CLI commands the classifier escalates.
// Each known command gets a concrete question ("Delete post ID 2 on
// “Site”?") and a consequence sentence in plain language; only the generic
// fallback mentions the raw command, woven into a sentence.
function describeDestructiveWpCliCommand(
	command: string,
	siteName: string
): PermissionRequestDescription {
	const { words } = parseWpCliCommand( command );
	const [ commandName, subcommand ] = words;
	const args = words.slice( 2 );
	const argList = args.join( ', ' );

	if ( commandName === 'post' && subcommand === 'delete' ) {
		return {
			title: sprintf(
				// translators: 1: site name, 2: comma-separated post IDs
				_n( 'Delete post ID %2$s on “%1$s”?', 'Delete posts %2$s on “%1$s”?', args.length ),
				siteName,
				argList
			),
			consequences: [
				_n(
					'The post will be permanently deleted, skipping the trash — this cannot be undone.',
					'The posts will be permanently deleted, skipping the trash — this cannot be undone.',
					args.length
				),
			],
		};
	}

	if ( commandName === 'comment' && subcommand === 'delete' ) {
		return {
			title: sprintf(
				// translators: 1: site name, 2: comma-separated comment IDs
				_n( 'Delete comment ID %2$s on “%1$s”?', 'Delete comments %2$s on “%1$s”?', args.length ),
				siteName,
				argList
			),
			consequences: [
				_n(
					'The comment will be permanently deleted, skipping the trash — this cannot be undone.',
					'The comments will be permanently deleted, skipping the trash — this cannot be undone.',
					args.length
				),
			],
		};
	}

	if ( commandName === 'user' && subcommand === 'delete' ) {
		return {
			title: sprintf(
				// translators: 1: site name, 2: comma-separated user IDs or logins
				_n( 'Delete user %2$s on “%1$s”?', 'Delete users %2$s on “%1$s”?', args.length ),
				siteName,
				argList
			),
			consequences: [ __( 'The user account will be permanently removed from the site.' ) ],
		};
	}

	if ( commandName === 'plugin' && ( subcommand === 'delete' || subcommand === 'uninstall' ) ) {
		return {
			// translators: 1: site name, 2: plugin name
			title: sprintf( __( 'Delete the plugin “%2$s” from “%1$s”?' ), siteName, argList ),
			consequences: [ __( 'The plugin and its files will be permanently removed from the site.' ) ],
		};
	}

	if ( commandName === 'theme' && subcommand === 'delete' ) {
		return {
			// translators: 1: site name, 2: theme name
			title: sprintf( __( 'Delete the theme “%2$s” from “%1$s”?' ), siteName, argList ),
			consequences: [ __( 'The theme and its files will be permanently removed from the site.' ) ],
		};
	}

	if ( commandName === 'option' && subcommand === 'delete' ) {
		return {
			// translators: 1: site name, 2: option name
			title: sprintf( __( 'Delete the setting “%2$s” on “%1$s”?' ), siteName, argList ),
			consequences: [ __( 'The setting will be permanently removed — this cannot be undone.' ) ],
		};
	}

	if ( commandName === 'term' && subcommand === 'delete' ) {
		return {
			// translators: %s: site name
			title: sprintf( __( 'Delete taxonomy terms on “%s”?' ), siteName ),
			consequences: [ __( 'The terms (such as categories or tags) will be permanently deleted.' ) ],
		};
	}

	if ( commandName === 'menu' && subcommand === 'delete' ) {
		return {
			// translators: 1: site name, 2: menu name
			title: sprintf( __( 'Delete the menu “%2$s” on “%1$s”?' ), siteName, argList ),
			consequences: [ __( 'The menu and its items will be permanently deleted.' ) ],
		};
	}

	if ( commandName === 'db' ) {
		if ( subcommand === 'reset' || subcommand === 'drop' || subcommand === 'clean' ) {
			return {
				// translators: %s: site name
				title: sprintf( __( 'Erase the database of “%s”?' ), siteName ),
				consequences: [
					__(
						'All posts, pages, settings, and users on the site will be erased — this cannot be undone.'
					),
				],
			};
		}
		if ( subcommand === 'import' ) {
			return {
				// translators: %s: site name
				title: sprintf( __( 'Replace the database of “%s” with an imported file?' ), siteName ),
				consequences: [ __( 'Everything currently in the site’s database will be overwritten.' ) ],
			};
		}
		if ( subcommand === 'query' ) {
			return {
				// translators: %s: site name
				title: sprintf( __( 'Run a raw database query on “%s”?' ), siteName ),
				consequences: [
					__( 'Raw queries can permanently change or delete any of the site’s data.' ),
				],
			};
		}
	}

	if ( commandName === 'site' && subcommand === 'empty' ) {
		return {
			// translators: %s: site name
			title: sprintf( __( 'Delete all content on “%s”?' ), siteName ),
			consequences: [
				__(
					'All posts, pages, comments, and terms will be permanently deleted — this cannot be undone.'
				),
			],
		};
	}

	if ( commandName === 'search-replace' ) {
		const [ from, to ] = args;
		return {
			title:
				from && to
					? sprintf(
							// translators: 1: site name, 2: text being replaced, 3: replacement text
							__( 'Replace “%2$s” with “%3$s” across the database of “%1$s”?' ),
							siteName,
							from,
							to
					  )
					: // translators: %s: site name
					  sprintf( __( 'Search and replace across the database of “%s”?' ), siteName ),
			consequences: [
				__(
					'Every matching value in the site’s database will be rewritten — this cannot be undone.'
				),
			],
		};
	}

	if ( commandName === 'eval' || commandName === 'eval-file' ) {
		return {
			// translators: %s: site name
			title: sprintf( __( 'Run custom PHP code on “%s”?' ), siteName ),
			consequences: [
				__(
					'Custom code has full access to the site’s files and data, and its changes may not be reversible.'
				),
			],
		};
	}

	return {
		// translators: %s: site name
		title: sprintf( __( 'Run a destructive command on “%s”?' ), siteName ),
		consequences: [
			sprintf(
				// translators: 1: site name, 2: the WP-CLI command
				__(
					'This will run “wp %2$s” on “%1$s”, which can permanently change or delete the site’s data.'
				),
				siteName,
				command
			),
		],
	};
}
