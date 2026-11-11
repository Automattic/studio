import { Type } from 'typebox';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { failsAs, slugify, textResult, wpEval } from './utils';
import type { HostSite, StudioAgentHost } from '@studio/agent/shared/host';

/**
 * PHP that deletes the placeholder content wp_install_defaults()
 * (wp-admin/includes/upgrade.php) gives a new site: the "Hello world!" post,
 * with its comment, and the "Sample Page". Each is identified as WordPress
 * made it, by its ID, type, slug and the guid home_url()/?p=1 or
 * home_url()/?page_id=2, and only while it is unedited, its modified time
 * still its publish time. The Privacy Policy draft stays: it is not public and
 * wp_page_for_privacy_policy names it.
 */
export const DELETE_INSTALL_DEFAULTS_PHP = `foreach ( array(
	array( 1, 'post', '/?p=1', array( 'hello-world', sanitize_title( _x( 'hello-world', 'Default post slug' ) ) ) ),
	array( 2, 'page', '/?page_id=2', array( 'sample-page', __( 'sample-page' ) ) ),
) as list( $id, $type, $guid, $slugs ) ) {
	$post = get_post( $id );
	if ( $post && $type === $post->post_type && 'publish' === $post->post_status
		&& in_array( $post->post_name, $slugs, true )
		&& substr( $post->guid, -strlen( $guid ) ) === $guid
		&& $post->post_modified_gmt === $post->post_date_gmt ) {
		wp_delete_post( $id, true );
	}
}`;

/** Deletes a new site's "Hello world!" post and "Sample Page", while unedited. */
export async function deleteInstallDefaults(
	host: StudioAgentHost,
	site: HostSite
): Promise< void > {
	await wpEval( host, site, DELETE_INSTALL_DEFAULTS_PHP );
}

export const createSiteTool = defineTool(
	'site_create',
	'Creates a new WordPress site with the latest WordPress version. Automatically sets up the site directory, installs WordPress, registers the site, and starts the server. Returns the site URL and credentials.',
	{
		name: Type.String( { description: 'The name for the new site (e.g., "My Coffee Shop")' } ),
	},
	( args, context ) =>
		failsAs( 'Failed to create site', async () => {
			const slug = slugify( args.name );
			if ( ! slug ) {
				throw new Error( 'Site name must contain at least one ASCII letter or digit (a-z, 0-9).' );
			}
			const host = context.host;
			await host.sites.create(
				args.name,
				host.path.join( host.sitesRoot, slug ),
				context.onProgress
			);

			const site = await context.host.sites.resolve( args.name );
			// A site the agent makes starts without WordPress's placeholder content;
			// the site works the same if it stays.
			await deleteInstallDefaults( host, site ).catch( () => undefined );
			const url = site.url;
			await context.host.selectSite?.( {
				id: site.id,
				name: site.name,
				path: site.path,
				running: true,
			} );
			return {
				...textResult(
					JSON.stringify(
						{
							id: site.id,
							name: site.name,
							path: site.path,
							url,
							adminUrl: `${ url }/wp-admin`,
							username: 'admin',
							password: site.adminPassword,
							phpVersion: site.phpVersion,
						},
						null,
						2
					)
				),
				studioArtifacts: [
					{
						type: 'site-preview',
						widgetProps: {
							path: '/',
							siteId: site.id,
							siteName: site.name,
							sitePath: site.path,
							url,
						},
					},
				],
			};
		} ),
	{
		annotations: LOCAL_CHANGE,
		siteParam: 'name',
		reportsChecks: true,
	}
);
