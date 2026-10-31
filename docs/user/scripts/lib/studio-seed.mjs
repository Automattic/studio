import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { readJson } from './common.mjs';
import { CLI_MAIN } from './studio-app.mjs';

const execFile = promisify( execFileCallback );

/**
 * Runs the built Studio CLI inside a profile, so it reads and writes the
 * profile's `cli.json`, sites and daemon rather than the user's. Resolves with
 * the command's stdout.
 */
export async function runCli( profile, args ) {
	const { stdout } = await execFile( process.execPath, [ CLI_MAIN, ...args ], {
		env: profile.env,
		maxBuffer: 16 * 1024 * 1024,
	} ).catch( ( error ) => {
		const tail = `${ error.stdout }${ error.stderr }`.trim().split( '\n' ).slice( -8 ).join( '\n' );
		throw new Error(
			`studio ${ args.slice( 0, 2 ).join( ' ' ) } failed (${ error.code }):\n${ tail }`
		);
	} );
	return stdout;
}

/** Creates a site in the profile's sites directory; resolves with its path. */
export async function createSite( profile, { slug, name, id, start = false } ) {
	const sitePath = path.join( profile.dirs.sites, slug );
	await runCli( profile, [
		'site',
		'create',
		'--path',
		sitePath,
		'--name',
		name,
		...( id ? [ '--id', id ] : [] ),
		...( start ? [ '--start' ] : [] ),
		'--skip-browser',
		'--skip-log-details',
	] );
	return sitePath;
}

export function stopSite( profile, sitePath ) {
	return runCli( profile, [ 'site', 'stop', '--path', sitePath ] );
}

/**
 * Creates the demo sites in a profile from `sites.json` (id, name, slug, and
 * for the site the shots open on, `import`: a Studio backup to load into it,
 * and `design`: the DESIGN.md to put in its folder, which the backup can't
 * carry).
 * Importing needs the site started, so it is stopped after; Studio starts it
 * again on launch through `autoStart` (see `siteMetadata`). The other sites
 * stay blank and stopped: they only fill out the sidebar.
 */
export async function seedSites( profile, dir ) {
	const sites = await readJson( path.join( dir, 'sites.json' ) );
	for ( const site of sites ) {
		const sitePath = await createSite( profile, { ...site, start: !! site.import } );
		if ( site.import ) {
			// The import restarts the site's server, which occasionally crashes on
			// start (an undici assertion in Studio's server child); once more then.
			const importBackup = () =>
				runCli( profile, [ 'import', path.join( dir, site.import ), '--path', sitePath ] );
			await importBackup().catch( async ( error ) => {
				console.log(
					`  Importing ${ site.import } failed (${
						error.message.split( '\n' )[ 0 ]
					}); trying again...`
				);
				await stopSite( profile, sitePath ).catch( () => {} );
				await importBackup();
			} );
			await stopSite( profile, sitePath );
		}
		if ( site.design ) {
			await copyFile( path.join( dir, site.design ), path.join( sitePath, 'DESIGN.md' ) );
		}
	}
	return sites;
}

/**
 * The `app.json` fields for the seeded sites: the sidebar keeps the order of
 * `sites.json`, and Studio starts the imported site on launch.
 */
export function siteMetadata( sites ) {
	return {
		siteMetadata: Object.fromEntries(
			sites.map( ( site, index ) => [ site.id, { sortOrder: index, autoStart: !! site.import } ] )
		),
	};
}

/**
 * Writes the chats in `<dir>/chats/<name>.json` into the profile's sessions
 * folder, as Studio Code records them, so a suite opens on a conversation
 * that already happened. A chat names its `site` (a slug in `sites.json`),
 * how many `minutesAgo` it started, and its `turns`: each a `prompt` and the
 * agent's `replies`, one message each, made of text and tool calls
 * (`{ name, args, result, isError?, details? }`, as the chat shows them).
 * A `title` names it in the sidebar, as renaming a chat does (in the
 * profile's `shared.json`); without one Studio shows the first prompt.
 * Resolves with the `app.json` placements that put each chat under its site,
 * and a `remove()` that deletes the files and titles again, since the profile
 * is shared.
 */
export async function seedChats( profile, dir, sites, names ) {
	const sessionsDir = path.join( profile.dirs.appData, 'sessions' );
	const sharedPath = path.join( profile.dirs.sharedConfig, 'shared.json' );
	const placements = {};
	const titles = {};
	const files = [];
	for ( const name of names ) {
		const chat = await readJson( path.join( dir, 'chats', `${ name }.json` ) );
		const site = sites.find( ( s ) => s.slug === chat.site );
		if ( ! site ) {
			throw new Error( `chats/${ name }.json: no demo site "${ chat.site }" in sites.json` );
		}
		const sitePath = path.join( profile.dirs.sites, site.slug );
		const sessionId = randomUUID();
		let clock = Date.now() - ( chat.minutesAgo ?? 30 ) * 60_000;
		const startedAt = new Date( clock );
		const lines = [
			{
				type: 'session',
				version: 3,
				id: sessionId,
				timestamp: startedAt.toISOString(),
				cwd: '~/Studio',
			},
		];
		let lastId = null;
		const add = ( entry, seconds ) => {
			clock += seconds * 1000;
			const id = randomUUID().slice( 0, 8 );
			lines.push( { id, parentId: lastId, timestamp: new Date( clock ).toISOString(), ...entry } );
			lastId = id;
		};
		const custom = ( customType, data, seconds = 1 ) =>
			add( { type: 'custom', customType, data }, seconds );
		custom( 'studio.site_selected', { siteName: site.name, sitePath, siteId: site.id } );
		let call = 0;
		for ( const turn of chat.turns ) {
			custom( 'studio.user_prompt', { text: turn.prompt, source: 'prompt' }, turn.after ?? 60 );
			for ( const reply of turn.replies ) {
				const blocks = reply.map( ( block ) =>
					typeof block === 'string' ? block : { ...block, id: `call-${ ++call }` }
				);
				add(
					{
						type: 'message',
						message: {
							role: 'assistant',
							content: blocks.map( ( block ) =>
								typeof block === 'string'
									? { type: 'text', text: block }
									: {
											type: 'toolCall',
											id: block.id,
											name: block.name,
											arguments: block.args ?? {},
									  }
							),
						},
					},
					6
				);
				for ( const block of blocks ) {
					if ( typeof block !== 'string' && block.result !== undefined ) {
						add(
							{
								type: 'message',
								message: {
									role: 'toolResult',
									toolCallId: block.id,
									toolName: block.name,
									content: [ { type: 'text', text: block.result } ],
									isError: block.isError ?? false,
									details: block.details,
								},
							},
							2
						);
					}
				}
			}
			custom( 'studio.turn_closed', { status: 'success' } );
		}
		const day = path.join(
			sessionsDir,
			String( startedAt.getFullYear() ),
			String( startedAt.getMonth() + 1 ).padStart( 2, '0' ),
			String( startedAt.getDate() ).padStart( 2, '0' )
		);
		await mkdir( day, { recursive: true } );
		const stamp = startedAt
			.toISOString()
			.replace( /:/g, '-' )
			.replace( /\.\d{3}Z$/, '' );
		const file = path.join( day, `${ stamp }-${ sessionId }.jsonl` );
		await writeFile( file, lines.map( ( line ) => JSON.stringify( line ) ).join( '\n' ) + '\n' );
		files.push( file );
		placements[ sessionId ] = { kind: 'site', siteId: site.id, sitePath, siteName: site.name };
		if ( chat.title ) {
			titles[ sessionId ] = { title: chat.title };
		}
	}
	const shared = await readJson( sharedPath );
	await writeFile(
		sharedPath,
		JSON.stringify( { ...shared, sessions: { ...shared.sessions, ...titles } }, null, 2 )
	);
	return {
		placements,
		remove: async () => {
			await Promise.all( files.map( ( file ) => rm( file, { force: true } ) ) );
			const { sessions, ...rest } = await readJson( sharedPath );
			const kept = Object.fromEntries(
				Object.entries( sessions ?? {} ).filter( ( [ id ] ) => ! titles[ id ] )
			);
			await writeFile(
				sharedPath,
				JSON.stringify( Object.keys( kept ).length ? { ...rest, sessions: kept } : rest, null, 2 )
			);
		},
	};
}
