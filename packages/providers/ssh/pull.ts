import { inSite, runSsh, shellQuote, syncFolder, type SshConnection } from './shell';
import type { PullSyncOptions } from '../wpcom/sites/site';

// What a local site can't use, or doesn't need: caches, backups, logs, and the drop-ins that bind
// WordPress to the server's database or cache.
const EXCLUDED = [
	'wp-content/cache',
	'wp-content/upgrade',
	'wp-content/updraft',
	'wp-content/ai1wm-backups',
	'wp-content/backups-dup-lite',
	'wp-content/db.php',
	'wp-content/object-cache.php',
	'wp-content/advanced-cache.php',
	'*.log',
];

/*
 * Exports the database and lists what the pull sends, in a folder of its own, where `wp-content`
 * links to the site's content folder so the archive has Studio's layout wherever the site keeps it.
 * Prints the folder and the size of what it lists, in kilobytes.
 */
function prepareScript(
	site: SshConnection,
	{ optionsToSync = [], onlyPaths = [] }: PullSyncOptions
): string {
	const all = ! optionsToSync.length || optionsToSync.includes( 'all' );
	const wants = ( option: 'plugins' | 'themes' | 'uploads' | 'contents' ) =>
		all || optionsToSync.includes( option ) ? '1' : '';
	const database = `mkdir "$dir/sql"
studio_wp db export "$dir/sql/database.sql" --tables="$(studio_wp db tables --all-tables-with-prefix --format=csv)" >&2
echo sql >> "$dir/items"`;
	const content = onlyPaths.length
		? `for only in ${ onlyPaths.map( shellQuote ).join( ' ' ) }; do
	[ ! -e "wp-content/$only" ] || printf '%s\\n' "wp-content/$only" >> items
done`
		: `for item in wp-content/*; do
	case "\${item#wp-content/}" in
		plugins) want=${ wants( 'plugins' ) } ;;
		themes) want=${ wants( 'themes' ) } ;;
		uploads) want=${ wants( 'uploads' ) } ;;
		*) want=${ wants( 'contents' ) } ;;
	esac
	[ -z "$want" ] || [ ! -e "$item" ] || printf '%s\\n' "$item" >> items
done`;
	return `set -e
umask 077
${ syncFolder( site.path, `pull-${ Date.now() }` ) }
rm -rf "$base"/.studio-sync/pull-*
mkdir -p "$dir"
ln -s ${ shellQuote( site.contentDir ) } "$dir/wp-content"
: > "$dir/items"
${ inSite( site ) }
${ all || optionsToSync.includes( 'sqls' ) ? database : '' }
cd "$dir"
${ content }
total=$(tr '\\n' '\\0' < items | xargs -0 du -skc | tail -n 1 | cut -f 1)
printf '%s\\n%s\\n' "$dir" "\${total:-0}"`;
}

// Sends what the folder lists as a tar, then removes the folder, also when the pull is cancelled.
function streamScript( dir: string ): string {
	return `set -e
dir=${ shellQuote( dir ) }
trap 'rm -rf "$dir"' EXIT
trap 'exit 1' HUP INT TERM PIPE
cd "$dir"
set --
while IFS= read -r item; do set -- "$@" "$item"; done < items
[ $# -gt 0 ] || { echo 'Error: There is nothing to pull.' >&2; exit 1; }
tar -cf - ${ EXCLUDED.map( ( pattern ) => `--exclude=${ shellQuote( pattern ) }` ).join(
		' '
	) } "$@"`;
}

export async function pullOverSsh(
	site: SshConnection,
	options: PullSyncOptions,
	archive: WritableStream< Uint8Array >,
	onProgress: ( percent: number ) => void,
	signal?: AbortSignal
): Promise< void > {
	const output = await runSsh( site, prepareScript( site, options ), { signal } );
	const [ dir, kilobytes ] = output.trim().split( '\n' ).slice( -2 );
	const total = Math.max( 1, Number( kilobytes ) * 1024 );
	let received = 0;
	const writer = archive.getWriter();
	const counted = new WritableStream< Uint8Array >( {
		write: async ( chunk ) => {
			received += chunk.length;
			onProgress( Math.min( 99, ( received / total ) * 100 ) );
			await writer.write( chunk );
		},
		close: () => writer.close(),
		abort: ( reason ) => writer.abort( reason ),
	} );
	await runSsh( site, streamScript( dir ), { stdout: counted, compress: true, signal } );
}
