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
 * update_plugins transient. Its blocks are not the site's to fix.
 */
import { activeCodeVersion } from '@studio/agent/node/active-code';
import { unregisteredInEditor } from '@studio/agent/node/block-validator';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { runWpCli } from '@studio/agent/node/tools/utils';
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
echo 'WITHOUT_EDITOR_SCRIPT=' . wp_json_encode( (object) $without );`;

export const blockEditorScripts: SiteChangeSource = {
	name: KEY,
	async read( sitePath ) {
		return {
			code: await activeCodeVersion( sitePath, ( name ) => /\.(php|js|json)$/.test( name ) ),
		};
	},
	async check( site, before, after, host ) {
		if ( before.code === after.code ) {
			return { reports: [] };
		}
		let without: Record< string, string[] >;
		try {
			const output = await runWpCli( host, site, [ 'eval', WITHOUT ] );
			without = JSON.parse(
				output.slice( output.indexOf( 'WITHOUT_EDITOR_SCRIPT=' ) + 'WITHOUT_EDITOR_SCRIPT='.length )
			) as Record< string, string[] >;
		} catch {
			// Code that does not load is reported by what runs it.
			return { reports: [] };
		}
		const updated = await updatedPluginFolders( site.path );
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

type UpdateCheck =
	| Partial< Record< 'response' | 'no_update', Record< string, unknown > > >
	| undefined;

// The folders of the plugins WordPress's last update check found an update source for.
async function updatedPluginFolders( sitePath: string ): Promise< string[] > {
	const updates = await readWordPressSite(
		sitePath,
		( site ) => site.option( '_site_transient_update_plugins' ) as UpdateCheck
	).catch( () => undefined );
	return [ ...Object.keys( updates?.response ?? {} ), ...Object.keys( updates?.no_update ?? {} ) ]
		.filter( ( plugin ) => plugin.includes( '/' ) )
		.map( ( plugin ) => plugin.split( '/' )[ 0 ] );
}
