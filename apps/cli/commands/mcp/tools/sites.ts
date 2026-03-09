import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { decodePassword } from '@studio/common/lib/passwords';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { runCommand as runCreateCommand } from 'cli/commands/site/create';
import { runCommand as runDeleteCommand } from 'cli/commands/site/delete';
import { runCommand as runSetCommand, SetCommandOptions } from 'cli/commands/site/set';
import { runCommand as runStartCommand } from 'cli/commands/site/start';
import { runCommand as runStopCommand, Mode as StopMode } from 'cli/commands/site/stop';
import { getSiteUrl, readAppdata } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { isSiteRunning } from 'cli/lib/site-utils';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';

function ok( data: unknown ) {
	return { content: [ { type: 'text' as const, text: JSON.stringify( data, null, 2 ) } ] };
}

function err( message: string ) {
	return {
		content: [ { type: 'text' as const, text: message } ],
		isError: true as const,
	};
}

export function registerSiteTools( server: McpServer ) {
	server.tool( 'site_list', __( 'List all WordPress sites in Studio' ), {}, async () => {
		try {
			const appdata = await readAppdata();
			await connect();
			try {
				const sites = await Promise.all(
					appdata.sites.map( async ( site ) => {
						const running = await isSiteRunning( site );
						return {
							id: site.id,
							name: site.name,
							path: site.path,
							url: getSiteUrl( site ),
							status: running ? 'online' : 'offline',
							phpVersion: site.phpVersion,
							wpVersion: getWordPressVersion( site.path ),
						};
					} )
				);
				return ok( sites );
			} finally {
				await disconnect();
			}
		} catch ( error ) {
			return err( error instanceof Error ? error.message : String( error ) );
		}
	} );

	server.tool(
		'site_status',
		__( 'Get detailed status of a WordPress site' ),
		{ path: z.string().describe( __( 'Absolute path to the site directory' ) ) },
		async ( { path: sitePath } ) => {
			try {
				await connect();
				try {
					const appdata = await readAppdata();
					const site = appdata.sites.find( ( s ) => s.path === sitePath );
					if ( ! site ) {
						return err( __( 'Site not found at the specified path' ) );
					}
					const processInfo = await isServerRunning( site.id );
					const online = !! processInfo;
					const siteUrl = getSiteUrl( site );
					return ok( {
						id: site.id,
						name: site.name,
						path: site.path,
						url: siteUrl,
						autoLoginUrl: online
							? `${ siteUrl }/studio-auto-login?redirect_to=%2Fwp-admin%2F`
							: undefined,
						status: online ? 'online' : 'offline',
						phpVersion: site.phpVersion,
						wpVersion: getWordPressVersion( site.path ),
						adminUsername: site.adminUsername ?? 'admin',
						adminPassword: site.adminPassword ? decodePassword( site.adminPassword ) : undefined,
						adminEmail: site.adminEmail,
						customDomain: site.customDomain,
						enableHttps: site.enableHttps,
						xdebug: site.enableXdebug ?? false,
					} );
				} finally {
					await disconnect();
				}
			} catch ( error ) {
				return err( error instanceof Error ? error.message : String( error ) );
			}
		}
	);

	server.tool(
		'site_start',
		__( 'Start a WordPress site' ),
		{ path: z.string().describe( __( 'Absolute path to the site directory' ) ) },
		async ( { path: sitePath } ) => {
			try {
				await runStartCommand( sitePath, true, true );
				return ok( { success: true, message: __( 'Site started successfully' ) } );
			} catch ( error ) {
				return err( error instanceof Error ? error.message : String( error ) );
			}
		}
	);

	server.tool(
		'site_stop',
		__( 'Stop a WordPress site' ),
		{ path: z.string().describe( __( 'Absolute path to the site directory' ) ) },
		async ( { path: sitePath } ) => {
			try {
				await runStopCommand( StopMode.STOP_SINGLE_SITE, sitePath, false );
				return ok( { success: true, message: __( 'Site stopped successfully' ) } );
			} catch ( error ) {
				return err( error instanceof Error ? error.message : String( error ) );
			}
		}
	);

	server.tool(
		'site_create',
		__( 'Create a new WordPress site' ),
		{
			name: z.string().describe( __( 'Site name' ) ),
			path: z.string().describe( __( 'Absolute path where the site directory will be created' ) ),
			php: z
				.string()
				.optional()
				.describe( __( `PHP version (e.g. "8.2", default: "${ DEFAULT_PHP_VERSION }")` ) ),
			wp: z
				.string()
				.optional()
				.describe(
					__(
						`WordPress version (e.g. "6.7", "latest", default: "${ DEFAULT_WORDPRESS_VERSION }")`
					)
				),
			start: z
				.boolean()
				.optional()
				.describe( __( 'Start the site after creation (default: true)' ) ),
		},
		async ( args ) => {
			try {
				await runCreateCommand( args.path, {
					name: args.name,
					wpVersion: args.wp ?? DEFAULT_WORDPRESS_VERSION,
					phpVersion: ( args.php ?? DEFAULT_PHP_VERSION ) as never,
					enableHttps: false,
					noStart: ! ( args.start ?? true ),
					skipBrowser: true,
					skipLogDetails: true,
				} );
				return ok( { success: true, message: __( 'Site created successfully' ) } );
			} catch ( error ) {
				return err( error instanceof Error ? error.message : String( error ) );
			}
		}
	);

	server.tool(
		'site_delete',
		__( 'Delete a WordPress site' ),
		{
			path: z.string().describe( __( 'Absolute path to the site directory' ) ),
			deleteFiles: z
				.boolean()
				.optional()
				.describe( __( 'Also move site files to trash (default: false)' ) ),
		},
		async ( { path: sitePath, deleteFiles } ) => {
			try {
				await runDeleteCommand( sitePath, deleteFiles ?? false );
				return ok( { success: true, message: __( 'Site deleted successfully' ) } );
			} catch ( error ) {
				return err( error instanceof Error ? error.message : String( error ) );
			}
		}
	);

	server.tool(
		'site_set',
		__( 'Update settings for a WordPress site' ),
		{
			path: z.string().describe( __( 'Absolute path to the site directory' ) ),
			name: z.string().optional().describe( __( 'New site name' ) ),
			php: z.string().optional().describe( __( 'PHP version' ) ),
			wp: z.string().optional().describe( __( 'WordPress version' ) ),
			domain: z.string().optional().describe( __( 'Custom domain' ) ),
			https: z.boolean().optional().describe( __( 'Enable HTTPS' ) ),
			xdebug: z.boolean().optional().describe( __( 'Enable Xdebug' ) ),
			adminUsername: z.string().optional().describe( __( 'Admin username' ) ),
			adminPassword: z.string().optional().describe( __( 'Admin password' ) ),
			adminEmail: z.string().optional().describe( __( 'Admin email' ) ),
		},
		async ( { path: sitePath, ...options } ) => {
			try {
				const setOptions: SetCommandOptions = {
					name: options.name,
					php: options.php,
					wp: options.wp,
					domain: options.domain,
					https: options.https,
					xdebug: options.xdebug,
					adminUsername: options.adminUsername,
					adminPassword: options.adminPassword,
					adminEmail: options.adminEmail,
				};
				await runSetCommand( sitePath, setOptions );
				return ok( { success: true, message: __( 'Site updated successfully' ) } );
			} catch ( error ) {
				return err( error instanceof Error ? error.message : String( error ) );
			}
		}
	);
}
