import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_SCENE, isUrl, readJson } from './paths.ts';
import { resolveScene, sceneFile, type LoadedScene } from './scene.ts';
import {
	SCHEMAS,
	describeIssues,
	type Scene,
	type SchemaKind,
	type Script,
	type Step,
} from './schema.ts';

export interface Validation {
	file: string;
	kind: SchemaKind | null;
	ok: boolean;
	errors: string[];
}

const LOOK_KEYS = [ 'window', 'scale', 'appearance', 'frame', 'outputs', 'video', 'still', 'crop' ];

/** Whether a file is a scene, script, look or persona: by its `$schema`, else by its shape. */
export function detectKind( data: unknown ): SchemaKind | null {
	if ( ! data || typeof data !== 'object' || Array.isArray( data ) ) {
		return null;
	}
	const record = data as Record< string, unknown >;
	const named = /(scene|script|look|persona)\.schema\.json$/.exec( String( record.$schema ?? '' ) );
	if ( named ) {
		return named[ 1 ] as SchemaKind;
	}
	if ( 'shots' in record ) {
		return 'script';
	}
	if ( 'sites' in record ) {
		return 'scene';
	}
	if ( LOOK_KEYS.some( ( key ) => key in record ) ) {
		return 'look';
	}
	if ( 'email' in record && 'name' in record ) {
		return 'persona';
	}
	return null;
}

/** Problems with the files a scene points at. */
function checkScene( scene: LoadedScene ): string[] {
	const errors: string[] = [];
	const exists = ( file: string | undefined, what: string ) => {
		if ( file && ! isUrl( file ) && ! existsSync( file ) ) {
			errors.push( `${ what }: ${ path.relative( scene.dir, file ) } not found` );
		}
	};
	for ( const site of scene.sites ) {
		exists( site.import, `sites.${ site.slug }.import` );
		exists( site.blueprint, `sites.${ site.slug }.blueprint` );
		exists( site.design, `sites.${ site.slug }.design` );
	}
	for ( const [ key, file ] of Object.entries( scene.account ) ) {
		exists( file, `account.${ key }` );
	}
	exists( scene.chats, 'chats' );
	exists( scene.agentTurns, 'agentTurns' );
	exists( scene.files, 'files' );
	return errors;
}

/** Problems running `script` on `scene` would hit: names and files it uses that the scene lacks. */
export function checkScriptAgainstScene( script: Script, scene: LoadedScene ): string[] {
	const errors: string[] = [];
	const inFolder = ( dir: string | undefined, file: string ) =>
		Boolean( dir && existsSync( path.join( dir, file ) ) );
	for ( const name of script.chats ?? [] ) {
		if ( ! inFolder( scene.chats, `${ name }.json` ) ) {
			errors.push( `chats: scene ${ scene.name } has no chat "${ name }"` );
		}
	}
	if ( script.signedIn && script.previewSites && ! scene.account.previewSites ) {
		errors.push( `previewSites: scene ${ scene.name } has no account.previewSites` );
	}
	if ( script.signedIn && script.connectedSites && ! scene.account.wpcomSites ) {
		errors.push( `connectedSites: scene ${ scene.name } has no account.wpcomSites` );
	}
	const roots = new Set( [ 'site', ...( script.signedIn ? [ 'account' ] : [] ) ] );
	script.shots.forEach( ( shot, index ) => {
		const where = `shots.${ index }${ shot.name ? ` (${ shot.name })` : '' }`;
		for ( const match of JSON.stringify( shot ).matchAll( /\{\{\s*([\w]+)[\w.]*\s*\}\}/g ) ) {
			if ( ! roots.has( match[ 1 ] ) ) {
				errors.push( `${ where }: unknown placeholder ${ match[ 0 ] }` );
			}
		}
		const steps: Step[] = [ ...( shot.steps ?? [] ), ...( shot.after ?? [] ) ];
		for ( const step of steps ) {
			if ( 'setFiles' in step && ! inFolder( scene.files, step.file ) ) {
				errors.push( `${ where }: scene ${ scene.name } has no file "${ step.file }"` );
			}
			if (
				'helper' in step &&
				step.helper === 'playAgentTurn' &&
				! inFolder( scene.agentTurns, `${ step.args?.[ 0 ] }.json` )
			) {
				errors.push(
					`${ where }: scene ${ scene.name } has no agent turn "${ step.args?.[ 0 ] }"`
				);
			}
		}
	} );
	return errors;
}

async function expand( refs: string[] ) {
	const files: string[] = [];
	for ( const ref of refs ) {
		const full = path.resolve( ref );
		if ( ( await stat( full ) ).isDirectory() ) {
			files.push(
				...( await readdir( full, { recursive: true } ) )
					.filter( ( name ) => name.endsWith( '.json' ) )
					.sort()
					.map( ( name ) => path.join( full, name ) )
			);
		} else {
			files.push( full );
		}
	}
	return files;
}

/**
 * Validates scene, script and look files against their schemas, then checks
 * what a schema can't: that a scene's files exist, and that a script's chats,
 * agent turns, files and placeholders are in the scene it runs on (`scene`,
 * else the one it names, else the default). Folders are searched for JSON
 * files; ones that are none of the three are skipped.
 */
export async function validateFiles(
	refs: string[],
	{ scene: override }: { scene?: LoadedScene } = {}
): Promise< Validation[] > {
	const results: Validation[] = [];
	const explicit = new Set( refs.map( ( ref ) => path.resolve( ref ) ) );
	for ( const file of await expand( refs ) ) {
		let data: unknown;
		try {
			data = await readJson( file );
		} catch ( error ) {
			results.push( { file, kind: null, ok: false, errors: [ ( error as Error ).message ] } );
			continue;
		}
		const kind = detectKind( data );
		if ( ! kind ) {
			if ( explicit.has( file ) ) {
				results.push( {
					file,
					kind,
					ok: false,
					errors: [ 'Not a scene, script, look or persona (set $schema to say which)' ],
				} );
			}
			continue;
		}
		const parsed = SCHEMAS[ kind ].safeParse( data );
		if ( ! parsed.success ) {
			results.push( { file, kind, ok: false, errors: describeIssues( parsed.error, data ) } );
			continue;
		}
		let errors: string[] = [];
		try {
			if ( kind === 'scene' ) {
				errors = checkScene( resolveScene( parsed.data as Scene, path.dirname( file ), file ) );
			} else if ( kind === 'script' ) {
				const script = parsed.data as Script;
				if ( ! script.manual ) {
					const sceneRef = sceneFile( script.scene ?? DEFAULT_SCENE, path.dirname( file ) );
					const scene =
						override ??
						resolveScene(
							SCHEMAS.scene.parse( await readJson( sceneRef ) ),
							path.dirname( sceneRef ),
							sceneRef
						);
					errors = checkScriptAgainstScene( script, scene );
				}
			}
		} catch ( error ) {
			errors.push( ( error as Error ).message );
		}
		results.push( { file, kind, ok: ! errors.length, errors } );
	}
	return results;
}
