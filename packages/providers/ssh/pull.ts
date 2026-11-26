import { CREATE_TAR, FALLBACKS } from './fallbacks';
import { inSite, shellQuote, syncFolder, uploadWpCli, withSsh, type SshConnection } from './shell';
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
	wpCli: string,
	{ optionsToSync = [], onlyPaths = [] }: PullSyncOptions
): string {
	const all = ! optionsToSync.length || optionsToSync.includes( 'all' );
	const wants = ( option: 'plugins' | 'themes' | 'uploads' | 'contents' ) =>
		all || optionsToSync.includes( option ) ? '1' : '';
	const database = `mkdir "$dir/sql"
studio_export "$dir/sql/database.sql" "$(studio_wp db tables --all-tables-with-prefix --format=csv)"
echo sql >> "$dir/items"`;
	// A folder the host links in, such as a plugin it manages, is sent as what it links to, which
	// \`/.\` follows.
	const studioList = `studio_list() { if [ -L "$1" ] && [ -d "$1" ]; then printf '%s/.\\n' "$1"; else printf '%s\\n' "$1"; fi >> items; }`;
	const content = onlyPaths.length
		? `${ studioList }
for only in ${ onlyPaths.map( shellQuote ).join( ' ' ) }; do
	[ ! -e "wp-content/$only" ] || studio_list "wp-content/$only"
done`
		: `${ studioList }
for item in wp-content/*; do
	case "\${item#wp-content/}" in
		plugins) want=${ wants( 'plugins' ) } ;;
		themes) want=${ wants( 'themes' ) } ;;
		uploads) want=${ wants( 'uploads' ) } ;;
		*) want=${ wants( 'contents' ) } ;;
	esac
	[ -n "$want" ] && [ -e "$item" ] || continue
	case "\${item#wp-content/}" in
		plugins | themes) for entry in "$item"/* "$item"/.[!.]* "$item"/..?*; do
			[ ! -e "$entry" ] || studio_list "$entry"
		done ;;
		*) studio_list "$item" ;;
	esac
done`;
	return `set -e
umask 077
${ syncFolder( site.path, `pull-${ Date.now() }` ) }
rm -rf "$base"/.studio-sync/pull-*
mkdir -p "$dir"
ln -s ${ shellQuote( site.contentDir ) } "$dir/wp-content"
: > "$dir/items"
${ inSite( site, wpCli ) }
${ FALLBACKS }
${ all || optionsToSync.includes( 'sqls' ) ? database : '' }
cd "$dir"
${ content }
total=$(tr '\\n' '\\0' < items | xargs -0 du -skc | tail -n 1 | cut -f 1)
printf '%s\\n%s\\n' "$dir" "\${total:-0}"`;
}

// Sends what the folder lists as a tar, then removes the folder, also when the pull is cancelled.
function streamScript( site: SshConnection, wpCli: string, dir: string ): string {
	return `set -e
${ inSite( site, wpCli ) }
dir=${ shellQuote( dir ) }
trap 'rm -rf "$dir"' EXIT
trap 'exit 1' HUP INT TERM PIPE
cd "$dir"
[ -s items ] || { echo 'Error: There is nothing to pull.' >&2; exit 1; }
if command -v tar >/dev/null 2>&1; then
	# Stores what a link was followed to under the link's name, with GNU tar's option or bsdtar's.
	if tar --version 2>/dev/null | grep -q GNU; then
		set -- --transform 's,/\\./,/,' --transform 's,/\\.$,,'
	else
		set -- -s ',/\\./,/,' -s ',/\\.$,,'
	fi
	while IFS= read -r item; do set -- "$@" "$item"; done < items
	tar -cf - ${ EXCLUDED.map( ( pattern ) => `--exclude=${ shellQuote( pattern ) }` ).join(
		' '
	) } "$@"
else
	STUDIO_EXCLUDE=${ shellQuote(
		EXCLUDED.join( '\n' )
	) } studio_wp eval --skip-wordpress ${ shellQuote( CREATE_TAR ) } < items 3>&1 1>&2
fi`;
}

export async function pullOverSsh(
	site: SshConnection,
	options: PullSyncOptions,
	archive: WritableStream< Uint8Array >,
	onProgress: ( percent: number ) => void,
	signal?: AbortSignal
): Promise< void > {
	await withSsh( site, async ( ssh ) => {
		const wpCli = await uploadWpCli( ssh, site );
		const output = await ssh.run( prepareScript( site, wpCli, options ), { signal } );
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
		await ssh.transfer( streamScript( site, wpCli, dir ), {
			stdout: counted,
			compress: true,
			signal,
		} );
	} );
}
