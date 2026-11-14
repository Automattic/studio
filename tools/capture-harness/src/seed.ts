import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readJson } from './paths.ts';
import { createSite, runCli, stopSite } from './studio-cli.ts';
import type { Profile } from './profile.ts';
import type { LoadedScene, ResolvedSite } from './scene.ts';

/**
 * Creates the scene's sites in a profile. A site with `import` is created
 * started, loaded from its backup, and stopped; one with `blueprint` is
 * created from it. Either way Studio starts it again on launch (`autoStart`,
 * see `siteMetadata`). Other sites stay blank and stopped: they fill out the
 * sidebar. A `design` file is copied in as the site's DESIGN.md, which a
 * backup can't carry.
 */
export async function seedSites( profile: Profile, scene: LoadedScene ) {
	for ( const site of scene.sites ) {
		const sitePath = await createSite( profile, {
			...site,
			start: Boolean( site.import ),
		} );
		if ( site.import ) {
			const backup = site.import;
			// The import restarts the site's server, which occasionally crashes on
			// start (an undici assertion in Studio's server child); once more then.
			const importBackup = () => runCli( profile, [ 'import', backup, '--path', sitePath ] );
			await importBackup().catch( async ( error: Error ) => {
				console.error(
					`  Importing ${ path.basename( backup ) } failed (${
						error.message.split( '\n' )[ 0 ]
					}); trying again...`
				);
				await stopSite( profile, sitePath ).catch( () => {} );
				await importBackup();
			} );
			await stopSite( profile, sitePath );
		}
		if ( site.design ) {
			await copyFile( site.design, path.join( sitePath, 'DESIGN.md' ) );
		}
	}
	return scene.sites;
}

/**
 * The `app.json` fields for the seeded sites: the sidebar keeps the scene's
 * order, and Studio starts the sites with content on launch.
 */
export function siteMetadata( sites: ResolvedSite[] ) {
	return {
		siteMetadata: Object.fromEntries(
			sites.map( ( site, index ) => [ site.id, { sortOrder: index, autoStart: site.content } ] )
		),
	};
}

interface ToolCall {
	name: string;
	args?: Record< string, unknown >;
	result?: string;
	isError?: boolean;
	details?: unknown;
}

interface Chat {
	site: string;
	title?: string;
	minutesAgo?: number;
	turns: { prompt: string; after?: number; replies: ( string | ToolCall )[][] }[];
}

/**
 * Writes the scene's chats named in `names` (`<chats>/<name>.json`) into the
 * profile's sessions folder, as Studio Code records them, so a script opens
 * on a conversation that already happened. A chat names its `site` (a slug in
 * the scene), how many `minutesAgo` it started, and its `turns`: each a
 * `prompt` and the agent's `replies`, one message each, made of text and tool
 * calls (`{ name, args, result, isError?, details? }`, as the chat shows
 * them). A `title` names it in the sidebar, as renaming a chat does (in the
 * profile's `shared.json`); without one Studio shows the first prompt.
 * Resolves with the `app.json` placements that put each chat under its site,
 * and a `remove()` that deletes the files and titles again, since the profile
 * is shared.
 */
export async function seedChats( profile: Profile, scene: LoadedScene, names: string[] ) {
	if ( ! scene.chats ) {
		throw new Error( `Scene ${ scene.name } has no chats folder` );
	}
	const sessionsDir = path.join( profile.dirs.appData, 'sessions' );
	const sharedPath = path.join( profile.dirs.sharedConfig, 'shared.json' );
	const placements: Record< string, unknown > = {};
	const titles: Record< string, { title: string } > = {};
	const files: string[] = [];
	for ( const name of names ) {
		const chat = await readJson< Chat >( path.join( scene.chats, `${ name }.json` ) );
		const site = scene.sites.find( ( s ) => s.slug === chat.site );
		if ( ! site ) {
			throw new Error( `chats/${ name }.json: no site "${ chat.site }" in the scene` );
		}
		const sitePath = path.join( profile.dirs.sites, site.slug );
		const sessionId = randomUUID();
		let clock = Date.now() - ( chat.minutesAgo ?? 30 ) * 60_000;
		const startedAt = new Date( clock );
		const lines: Record< string, unknown >[] = [
			{
				type: 'session',
				version: 3,
				id: sessionId,
				timestamp: startedAt.toISOString(),
				cwd: '~/Studio',
			},
		];
		let lastId: string | null = null;
		const add = ( entry: Record< string, unknown >, seconds: number ) => {
			clock += seconds * 1000;
			const id = randomUUID().slice( 0, 8 );
			lines.push( { id, parentId: lastId, timestamp: new Date( clock ).toISOString(), ...entry } );
			lastId = id;
		};
		const custom = ( customType: string, data: unknown, seconds = 1 ) =>
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
	const shared = await readJson< { sessions?: Record< string, unknown > } >( sharedPath );
	await writeFile(
		sharedPath,
		JSON.stringify( { ...shared, sessions: { ...shared.sessions, ...titles } }, null, 2 )
	);
	return {
		placements,
		remove: async () => {
			await Promise.all( files.map( ( file ) => rm( file, { force: true } ) ) );
			const { sessions, ...rest } = await readJson< { sessions?: Record< string, unknown > } >(
				sharedPath
			);
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
