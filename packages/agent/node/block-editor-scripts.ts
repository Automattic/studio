/**
 * The blocks a site's own code registers from a block.json that WordPress
 * gives nothing to register them in the block editor. A block type has the
 * editor scripts its block.json "editorScript" names
 * (register_block_type_from_metadata() in wp-includes/blocks.php fills
 * WP_Block_Type::$editor_script_handles from it), which the block editor
 * loads for it; a block whose "supports" has "autoRegister" and that renders
 * on the server needs none, as the editor registers it itself
 * (_wp_enqueue_auto_register_blocks() in wp-includes/blocks.php).
 *
 * When the block.json, PHP or JavaScript files of a site's active plugins or
 * themes change, Studio asks WordPress, with the site's code loaded, which
 * block types named by a block.json in them have neither, and of those, which
 * the site's block editor does not register: another of the plugin's editor
 * scripts can register a block, as a parent block's script registers its
 * inner blocks.
 *
 * A plugin WordPress updates, as from WordPress.org, is its author's code: an
 * update replaces its folder (Plugin_Upgrader::upgrade() in
 * wp-admin/includes/class-plugin-upgrader.php), and WordPress's last update
 * check (wp_update_plugins() in wp-includes/update.php) lists it in the
 * update_plugins transient. Its blocks are not the site's to fix. Installing a
 * plugin deletes that transient (wp_clean_plugins_cache() in
 * Plugin_Upgrader::install()), and WordPress checks again only later, on cron
 * or an admin page; so when a block is in a plugin folder the transient does
 * not list, Studio has WordPress check then, which asks WordPress.org only when
 * the installed plugins changed since its last check. Offline, the plugin's
 * blocks are reported.
 */
import { blockCodeVersion, readBlockCode, seeBlockCode } from '@studio/agent/node/block-code';
import { unregisteredInEditor } from '@studio/agent/node/block-validator';
import { printedJson, wpEval } from '@studio/agent/shared/tools/utils';
import type { SiteChangeSource } from '@studio/agent/node/site-changes';

const KEY = 'block editor scripts';

const WITHOUT = `$dirs = array_map( 'dirname', array_filter( wp_get_active_and_valid_plugins(), fn ( $file ) => dirname( $file ) !== WP_PLUGIN_DIR ) );
$dirs = array_unique( array_merge( $dirs, array( get_template_directory(), get_stylesheet_directory() ) ) );
$without = array();
foreach ( $dirs as $dir ) {
	$files = new RecursiveIteratorIterator(
		new RecursiveCallbackFilterIterator(
			new RecursiveDirectoryIterator( $dir, FilesystemIterator::SKIP_DOTS ),
			fn ( $file ) => 'node_modules' !== $file->getFilename()
		)
	);
	foreach ( $files as $file ) {
		if ( 'block.json' !== $file->getFilename() ) {
			continue;
		}
		$metadata = wp_json_file_decode( $file->getPathname(), array( 'associative' => true ) );
		$type     = is_array( $metadata ) && isset( $metadata['name'] ) && is_string( $metadata['name'] )
			? WP_Block_Type_Registry::get_instance()->get_registered( $metadata['name'] )
			: null;
		if ( ! $type || $type->editor_script_handles || ( ! empty( $type->supports['autoRegister'] ) && $type->render_callback ) ) {
			continue;
		}
		$without[ $type->name ][] = $file->getPathname();
	}
}
$updated = function () {
	$updates = get_site_transient( 'update_plugins' );
	$plugins = array_keys( array_merge( (array) ( $updates->response ?? array() ), (array) ( $updates->no_update ?? array() ) ) );
	return array_values( array_unique( array_map( 'dirname', array_filter( $plugins, fn ( $plugin ) => str_contains( $plugin, '/' ) ) ) ) );
};
$folders = array();
foreach ( array_merge( array(), ...array_values( $without ) ) as $file ) {
	if ( str_starts_with( $file, WP_PLUGIN_DIR . '/' ) ) {
		$folders[] = explode( '/', substr( $file, strlen( WP_PLUGIN_DIR ) + 1 ) )[0];
	}
}
if ( array_diff( $folders, $updated() ) ) {
	wp_update_plugins();
}
echo "\nUPDATED_PLUGIN_FOLDERS=" . wp_json_encode( $updated() ) . "\n";
echo 'WITHOUT_EDITOR_SCRIPT=' . wp_json_encode( (object) $without );`;

export const blockEditorScripts: SiteChangeSource = {
	name: KEY,
	async read( sitePath ) {
		const code = await blockCodeVersion( sitePath );
		// For the block validations of files, which hold for the code they ran with.
		readBlockCode( sitePath, code );
		return { code };
	},
	async check( site, before, after, host ) {
		if ( before.code === after.code ) {
			return { reports: [] };
		}
		seeBlockCode( site.url, after.code );
		let without: Record< string, string[] >;
		// The folders of the plugins WordPress's last update check found an update source for.
		let updated: string[];
		try {
			const output = await wpEval( host, site, WITHOUT );
			without = printedJson( output, 'WITHOUT_EDITOR_SCRIPT=' );
			updated = printedJson( output, 'UPDATED_PLUGIN_FOLDERS=' );
		} catch {
			// Code that does not load is reported by what runs it.
			return { reports: [] };
		}
		for ( const [ name, files ] of Object.entries( without ) ) {
			const own = files.filter(
				( file ) =>
					! updated.some( ( folder ) => file.includes( `/wp-content/plugins/${ folder }/` ) )
			);
			if ( own.length ) {
				without[ name ] = own;
			} else {
				delete without[ name ];
			}
		}
		const names = Object.keys( without ).length
			? await unregisteredInEditor( Object.keys( without ), site.url ).catch( () =>
					Object.keys( without )
			  )
			: [];
		return {
			reports: [
				{
					key: KEY,
					problem: names.length
						? `${ site.name }: WordPress registers ${ names
								.map( ( name ) => `${ name } (${ without[ name ].join( ', ' ) })` )
								.join(
									', '
								) } with no editor script. register_block_type_from_metadata() (wp-includes/blocks.php) gives a block type the scripts its block.json "editorScript" names, and the block editor loads them for it (WP_Block_Type::$editor_script_handles). "editorScript" takes a handle the plugin registers before the block, or "file:./index.js", which register_block_script_handle() registers with the dependencies and version of the index.asset.php beside it, as @wordpress/scripts writes it. A block that renders on the server can instead have "supports": { "autoRegister": true }, and the editor registers it itself (_wp_enqueue_auto_register_blocks() in wp-includes/blocks.php).`
						: undefined,
				},
			],
		};
	},
};
