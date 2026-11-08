/**
 * Jetpack's default modules on a site that is not connected to WordPress.com.
 * Jetpack activates its default modules when the site connects
 * (Jetpack::plugin_initialize() runs handle_default_module_activation() only
 * once is_connection_ready()), so on a local site, which does not connect,
 * activating Jetpack leaves every module off, Forms and Blocks with them, and
 * a Jetpack block renders without the module that serves it. When a call
 * leaves Jetpack active, unconnected and with no modules ever activated (no
 * jetpack_active_modules option), Studio activates the default modules whose
 * header says they need no connection, as Jetpack::activate_default_modules()
 * does, and says so. A site whose modules were set, even to none, keeps them.
 */
import { joinWithAnd as list } from '@studio/agent/node/bounded-list';
import { activePlugins } from '@studio/agent/node/plugins';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { printedJson, wpEval } from '@studio/agent/node/tools/utils';
import type { SiteChangeSource, Versions } from '@studio/agent/node/site-changes';

const KEY = 'jetpack modules';
const NEVER_SET = 'never set';

const ACTIVATE = `Jetpack::activate_default_modules( false, false, array(), false, false, false, false );
echo 'JETPACK_MODULES=' . wp_json_encode( array_values( Jetpack::get_active_modules() ) ) . "\\n";`;

export const jetpackModules: SiteChangeSource = {
	name: 'jetpack-modules',
	saves: true,
	async read( sitePath ) {
		return readWordPressSite( sitePath, ( site ) => {
			const options = site.option( 'jetpack_options' ) as Record< string, unknown > | undefined;
			const versions: Versions = {};
			if (
				activePlugins( site ).includes( 'jetpack/jetpack.php' ) &&
				! options?.id &&
				site.option( 'jetpack_active_modules' ) === undefined
			) {
				versions[ KEY ] = NEVER_SET;
			}
			return versions;
		} );
	},
	async check( site, before, after, host ) {
		if ( after[ KEY ] !== NEVER_SET || before[ KEY ] === NEVER_SET ) {
			return { reports: [] };
		}
		const off = `${ site.name }: Jetpack activates its default modules when the site connects to WordPress.com (Jetpack::plugin_initialize() in jetpack/class.jetpack.php), so on this site, not connected, it had activated none, and its blocks render only with their module`;
		try {
			const output = await wpEval( host, site, ACTIVATE );
			const modules = printedJson< string[] >( output, 'JETPACK_MODULES=' );
			return {
				reports: [
					{
						key: KEY,
						summary: `${ off }. Studio activated the default modules that need no connection, as Jetpack::activate_default_modules() does: ${ list(
							modules
						) }. The modules that require a connection stay off until the site connects.`,
					},
				],
			};
		} catch ( error ) {
			return {
				reports: [
					{
						key: KEY,
						problem: `${ off }, and activating the default modules that need no connection (Jetpack::activate_default_modules()) failed: ${
							error instanceof Error ? error.message : String( error )
						}. \`wp jetpack module activate <slug>\` turns one on.`,
					},
				],
			};
		}
	},
};
