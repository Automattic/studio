import { __ } from '@wordpress/i18n';
import { RemoteSiteError } from '../errors';
import { FALLBACKS } from './fallbacks';
import { inSite, shellQuote, syncFolder, uploadWpCli, withSsh, type SshConnection } from './shell';
import type { SshTarget } from './address';
import type { PushContent, PushStatus } from '../types';
import type { Readable } from 'node:stream';

/*
 * A push runs in a folder of its own on the server, outside the site: the archive is uploaded and
 * unpacked there, the tables it replaces are backed up there, and so are the plugins and themes it
 * replaces. The last three pushes' folders stay, as backups.
 *
 * The database is imported into staging tables, which get the server's URL while the live site keeps
 * serving, then swapped in with one RENAME TABLE. Each plugin and theme in the archive replaces the
 * live one whole; uploads and other content are merged.
 */

const STAGING = 'studio_new_';

function uploadScript( { path }: SshTarget, run: string ): string {
	return `set -e
umask 077
${ syncFolder( path, run ) }
mkdir -p "$dir"
ls -1dt "$base"/.studio-sync/push-* | tail -n +4 | while IFS= read -r old; do rm -rf "$old"; done
cat > "$dir/site.tar.gz"
printf '%s\\n' "$dir"`;
}

// What every later step starts with: in the site's folder, with WP-CLI and the push's folder at hand.
function prelude( site: SshConnection, wpCli: string, dir: string ): string {
	return `set -e
umask 022
${ inSite( site, wpCli ) }
${ FALLBACKS }
dir=${ shellQuote( dir ) }
# The shortest prefix of a table named …options: the core table's, not a plugin's.
source_prefix() { ls "$dir/site/sql" | sed -n 's/options\\.sql$//p' | awk '{ print length, $0 }' | sort -n | head -n 1 | cut -d ' ' -f 2-; }`;
}

function backupScript( site: SshConnection, wpCli: string, dir: string ): string {
	return `${ prelude( site, wpCli, dir ) }
rm -rf "$dir/site"
mkdir "$dir/site"
studio_untar "$dir/site.tar.gz" "$dir/site"
rm "$dir/site.tar.gz"
[ -d "$dir/site/sql" ] || exit 0
from=$(source_prefix)
[ -n "$from" ] || { echo 'Error: The pushed database has no options table.' >&2; exit 1; }
prefix=$(studio_wp db prefix)
existing=,$(studio_wp db tables --all-tables-with-prefix --format=csv),
tables=
for file in "$dir"/site/sql/*.sql; do
	name=$(basename "$file" .sql)
	table=$prefix\${name#"$from"}
	case "$existing" in *",$table,"*) tables=$tables,$table ;; esac
done
[ -n "$tables" ] || exit 0
studio_export "$dir/backup.sql" "\${tables#,}"
if studio_has gzip; then gzip "$dir/backup.sql"; fi`;
}

// Gives the staging tables the server's URL wherever the local one is, in each way it's written, and
// the server's own home, site URL and roles option.
const REPLACE_URLS = `global $wpdb;
$staging = '${ STAGING }';
$tables = $wpdb->get_col( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $staging ) . '%' ) );
$local = $wpdb->get_var( "SELECT option_value FROM {$staging}options WHERE option_name = 'siteurl'" );
$home = get_option( 'home' );
$ways = array(
	function ( $url ) { return $url; },
	function ( $url ) { return str_replace( array( ':', '/' ), array( '%3A', '%2F' ), $url ); },
	function ( $url ) { return str_replace( '/', '\\\\/', $url ); },
);
if ( $local ) {
	$bare = preg_replace( '#^https?://#', '', untrailingslashit( $local ) );
	foreach ( array( 'http://', 'https://' ) as $scheme ) {
		foreach ( $ways as $way ) {
			WP_CLI::run_command(
				array_merge( array( 'search-replace', $way( $scheme . $bare ), $way( $home ) ), $tables ),
				array( 'all-tables' => true, 'skip-columns' => 'guid' )
			);
		}
	}
}
// The server keeps its own address, search engine visibility and Jetpack connection.
foreach ( array( 'home', 'siteurl', 'blog_public', 'jetpack_options', 'jetpack_private_options' ) as $option ) {
	$live = $wpdb->get_row( $wpdb->prepare( "SELECT option_value, autoload FROM {$wpdb->options} WHERE option_name = %s", $option ), ARRAY_A );
	$wpdb->delete( "{$staging}options", array( 'option_name' => $option ) );
	if ( $live ) {
		$wpdb->insert( "{$staging}options", array( 'option_name' => $option ) + $live );
	}
}
$wpdb->update(
	"{$staging}options",
	array( 'option_name' => $wpdb->prefix . 'user_roles' ),
	array( 'option_name' => getenv( 'STUDIO_SOURCE_PREFIX' ) . 'user_roles' )
);`;

// Drops staging tables a push that failed left behind.
const DROP_STAGING = `global $wpdb;
foreach ( $wpdb->get_col( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( '${ STAGING }' ) . '%' ) ) as $table ) {
	$wpdb->query( "DROP TABLE \`$table\`" );
}`;

// Swaps the staging tables in, in one RENAME TABLE, and drops the tables they replaced.
const SWAP_TABLES = `global $wpdb;
$staging = '${ STAGING }';
$replaced = 'studio_old_';
$renames = array();
$old = array();
foreach ( $wpdb->get_col( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $staging ) . '%' ) ) as $table ) {
	$name = substr( $table, strlen( $staging ) );
	$live = $wpdb->prefix . $name;
	if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $live ) ) ) ) {
		$renames[] = "\`$live\` TO \`$replaced$name\`";
		$old[] = "\`$replaced$name\`";
	}
	$renames[] = "\`$table\` TO \`$live\`";
}
if ( $old ) {
	$wpdb->query( 'DROP TABLE IF EXISTS ' . implode( ', ', $old ) );
}
if ( $renames && false === $wpdb->query( 'RENAME TABLE ' . implode( ', ', $renames ) ) ) {
	WP_CLI::error( $wpdb->last_error );
}
if ( $old ) {
	$wpdb->query( 'DROP TABLE ' . implode( ', ', $old ) );
}`;

function applyScript( site: SshConnection, wpCli: string, dir: string ): string {
	return `${ prelude( site, wpCli, dir ) }
content=${ shellQuote( site.contentDir ) }
tick=$(printf '\\140')
if [ -d "$dir/site/sql" ]; then
	export STUDIO_SOURCE_PREFIX="$(source_prefix)"
	studio_wp eval ${ shellQuote( DROP_STAGING ) }
	for file in "$dir"/site/sql/*.sql; do
		sed -E "s/^(DROP TABLE IF EXISTS|CREATE TABLE|INSERT INTO) \${tick}\${STUDIO_SOURCE_PREFIX}/\\1 \${tick}${ STAGING }/" "$file"
	done | studio_import
	studio_wp eval ${ shellQuote( REPLACE_URLS ) }
fi
if [ -d "$dir/site/wp-content" ]; then
	# The server's caching drop-ins belong to its host.
	rm -f "$dir/site/wp-content/advanced-cache.php" "$dir/site/wp-content/object-cache.php"
	for item in "$dir"/site/wp-content/plugins/* "$dir"/site/wp-content/themes/*; do
		[ -e "$item" ] || continue
		rel=\${item#"$dir/site/wp-content/"}
		live=$content/$rel
		# The host manages what it links in, and may not let the site's user move it.
		if [ -L "$live" ]; then rm -rf "$item"; continue; fi
		rm -rf "$live.studio-new" "$live.studio-old"
		mkdir -p "$(dirname "$live")" "$(dirname "$dir/old/$rel")"
		mv "$item" "$live.studio-new"
		[ ! -e "$live" ] || mv "$live" "$live.studio-old"
		mv "$live.studio-new" "$live"
		[ ! -e "$live.studio-old" ] || mv "$live.studio-old" "$dir/old/$rel"
	done
	cp -R "$dir/site/wp-content/." "$content/"
fi
if [ -d "$dir/site/sql" ]; then
	studio_wp eval ${ shellQuote( SWAP_TABLES ) }
fi`;
}

function finishScript( site: SshConnection, wpCli: string, dir: string ): string {
	return `${ prelude( site, wpCli, dir ) }
rm -rf "$dir/site"
studio_wp cache flush`;
}

/**
 * Sends the site's archive to the server and applies it, reporting each step. Only the upload can be
 * cancelled: after it, the live site is about to change.
 */
export async function pushOverSsh(
	site: SshConnection,
	content: PushContent,
	onStatus: ( status: PushStatus ) => void,
	signal?: AbortSignal
): Promise< void > {
	if ( content.kind !== 'archive' ) {
		throw new RemoteSiteError( __( 'Studio pushes a site over SSH as an archive.' ) );
	}
	const archive = content.file as Readable;
	onStatus( { phase: 'uploading' } );
	await withSsh( site, async ( ssh ) => {
		const wpCli = await uploadWpCli( ssh, site );
		// Counting the bytes starts the archive flowing, so it starts with the upload.
		let sent = 0;
		archive.on( 'data', ( chunk: Buffer ) => {
			sent += chunk.length;
			onStatus( { phase: 'uploading', progress: ( sent / content.size ) * 100 } );
		} );
		const output = await ssh.transfer( uploadScript( site, `push-${ Date.now() }` ), {
			stdin: archive,
			signal,
		} );
		const dir = output.trim().split( '\n' ).pop()!;
		onStatus( { phase: 'creatingRemoteBackup' } );
		await ssh.run( backupScript( site, wpCli, dir ) );
		onStatus( { phase: 'applyingChanges' } );
		await ssh.run( applyScript( site, wpCli, dir ) );
		onStatus( { phase: 'finishing' } );
		await ssh.run( finishScript( site, wpCli, dir ) );
	} );
}
