/**
 * The commands that drive Studio or read the harness's inputs. cli.ts loads
 * this module only once the repo's dependencies are installed.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bake } from './bake.ts';
import { DRIVERS, type DriverName } from './drivers/types.ts';
import { renderLook } from './frame.ts';
import { inspect } from './inspect.ts';
import { loadLook } from './look.ts';
import { SCHEMAS_DIR } from './paths.ts';
import { runScripts, type Mode } from './run.ts';
import { loadScene, sceneFromBlueprint } from './scene.ts';
import { SCHEMAS, jsonSchemaFor, type LocatorSpec, type SchemaKind, type Step } from './schema.ts';
import { loadScripts } from './script.ts';
import { encodeStill } from './still.ts';
import { validateFiles } from './validate.ts';

export interface CommandArgs {
	scene?: string;
	blueprint?: string;
	look?: string;
	driver?: string;
	suite?: string;
	only?: string;
	out?: string;
	'diff-dir'?: string;
	json?: boolean;
	'keep-profile'?: boolean;
	script?: string;
	until?: string;
	'first-run'?: boolean;
	'signed-in'?: boolean;
	steps?: string;
	within?: string;
	screenshot?: string;
	'scene-out'?: string;
	check?: boolean;
}

export async function runCommand( command: string, refs: string[], args: CommandArgs ) {
	// With --json, stdout carries only the result.
	const log = ( message: string ) =>
		args.json ? process.stderr.write( `${ message }\n` ) : console.log( message );
	const names = ( value?: string ) =>
		value ? new Set( value.split( ',' ).map( ( s ) => s.trim() ) ) : null;
	const output = ( result: unknown, text: () => void ) =>
		args.json ? console.log( JSON.stringify( result, null, 2 ) ) : text();

	async function sceneOption() {
		if ( args.blueprint ) {
			return sceneFromBlueprint( args.blueprint );
		}
		return args.scene ? loadScene( args.scene ) : undefined;
	}

	function driverOption(): DriverName | undefined {
		if ( args.driver && ! ( DRIVERS as readonly string[] ).includes( args.driver ) ) {
			throw new Error( `--driver must be one of ${ DRIVERS.join( ', ' ) }.` );
		}
		return args.driver as DriverName | undefined;
	}

	function needRefs( what: string ) {
		if ( ! refs.length ) {
			throw new Error( `${ command } needs ${ what }. See \`studio-capture help\`.` );
		}
	}

	async function run( mode: Mode ) {
		needRefs( 'one or more scripts or folders of them' );
		const outDir = path.resolve( args.out ?? 'captures' );
		await mkdir( outDir, { recursive: true } );
		const result = await runScripts( {
			scripts: await loadScripts( refs ),
			mode,
			outDir,
			scene: await sceneOption(),
			look: args.look,
			driver: driverOption(),
			suites: names( args.suite ),
			only: names( args.only ),
			diffDir: args[ 'diff-dir' ] && path.resolve( args[ 'diff-dir' ] ),
			keepProfile: args[ 'keep-profile' ],
			log,
		} );
		const { summary } = result;
		output( result, () => {
			const parts =
				mode === 'record'
					? [ `${ summary.videos } video(s) written` ]
					: mode === 'check'
					? [
							`${ summary.changed } changed`,
							`${ summary.new } new`,
							`${ summary.unchanged } unchanged`,
					  ]
					: [ `${ summary.new + summary.changed } written`, `${ summary.unchanged } unchanged` ];
			if ( summary.failed ) {
				parts.push( `${ summary.failed } failed` );
			}
			log( `\n${ parts.join( ', ' ) }, in ${ path.relative( process.cwd(), outDir ) || '.' }/` );
		} );
		if ( summary.failed || ( mode === 'check' && summary.changed + summary.new ) ) {
			process.exitCode = 1;
		}
	}

	switch ( command ) {
		case 'capture':
			return run( args.check ? 'check' : 'capture' );
		case 'check':
			return run( 'check' );
		case 'record':
			return run( 'record' );
		case 'list': {
			needRefs( 'one or more scripts or folders of them' );
			const scripts = await loadScripts( refs );
			return output(
				scripts.map( ( s ) => ( {
					name: s.name,
					description: s.description,
					manual: Boolean( s.manual ),
					signedIn: Boolean( s.signedIn ),
					shots: s.shots.map( ( shot ) => shot.name ?? shot.description ),
				} ) ),
				() => {
					for ( const s of scripts ) {
						log(
							`${ s.name }${ s.signedIn ? ' (signed in)' : '' }${ s.manual ? ' (manual)' : '' }: ${
								s.description
							}`
						);
						for ( const shot of s.shots ) {
							log( `  ${ shot.name ?? `- ${ shot.description }` }` );
						}
					}
				}
			);
		}
		case 'inspect': {
			const result = await inspect( {
				scene: await sceneOption(),
				look: args.look,
				driver: driverOption(),
				script: args.script ? ( await loadScripts( [ args.script ] ) )[ 0 ] : undefined,
				until: args.until,
				launch: { firstRun: args[ 'first-run' ], signedIn: args[ 'signed-in' ] },
				steps: args.steps ? ( JSON.parse( args.steps ) as Step[] ) : undefined,
				within: args.within ? ( JSON.parse( args.within ) as LocatorSpec ) : undefined,
				screenshot: args.screenshot && path.resolve( args.screenshot ),
				keepProfile: args[ 'keep-profile' ],
				log: ( message ) => process.stderr.write( `${ message }\n` ),
			} );
			return output( result, () => console.log( result.snapshot ) );
		}
		case 'validate': {
			needRefs( 'files or folders to check' );
			const results = await validateFiles( refs, { scene: await sceneOption() } );
			output( results, () => {
				for ( const r of results ) {
					log(
						`${ r.ok ? 'ok  ' : 'FAIL' } ${ r.kind ?? '?' } ${ path.relative(
							process.cwd(),
							r.file
						) }`
					);
					for ( const error of r.errors ) {
						log( `       ${ error }` );
					}
				}
			} );
			if ( results.some( ( r ) => ! r.ok ) ) {
				process.exitCode = 1;
			}
			return;
		}
		case 'bake': {
			const scene = await sceneOption();
			if ( ! scene ) {
				throw new Error( 'bake needs --scene or --blueprint.' );
			}
			const result = await bake( scene, {
				outDir: args.out && path.resolve( args.out ),
				sceneOut: args[ 'scene-out' ] && path.resolve( args[ 'scene-out' ] ),
				log,
			} );
			return output( result, () => {} );
		}
		case 'frame': {
			needRefs( 'images to frame' );
			const look = await loadLook( args.look ?? 'blog' );
			if ( ! look.frame ) {
				throw new Error( `Look ${ look.name } has no frame.` );
			}
			const outDir = path.resolve( args.out ?? 'framed' );
			await mkdir( outDir, { recursive: true } );
			const files: string[] = [];
			for ( const ref of refs ) {
				const variants = await renderLook( await readFile( ref ), { ...look, keepRaw: false } );
				for ( const [ suffix, image ] of variants ) {
					const file = path.join(
						outDir,
						`${ path.parse( ref ).name }${ suffix }.${ look.still.format }`
					);
					await writeFile( file, await encodeStill( image, look.still ) );
					files.push( file );
					log( `  ${ path.relative( process.cwd(), file ) }` );
				}
			}
			return output( { files }, () => {} );
		}
		case 'schemas': {
			const stale: string[] = [];
			for ( const kind of Object.keys( SCHEMAS ) as SchemaKind[] ) {
				const file = path.join( SCHEMAS_DIR, `${ kind }.schema.json` );
				const text = JSON.stringify( jsonSchemaFor( kind ), null, '\t' ) + '\n';
				const current = await readFile( file, 'utf8' ).catch( () => '' );
				if ( current !== text ) {
					stale.push( path.relative( process.cwd(), file ) );
					if ( ! args.check ) {
						await mkdir( SCHEMAS_DIR, { recursive: true } );
						await writeFile( file, text );
					}
				}
			}
			if ( args.check && stale.length ) {
				throw new Error( `Out of date: ${ stale.join( ', ' ) }. Run \`studio-capture schemas\`.` );
			}
			log( stale.length ? `Wrote ${ stale.join( ', ' ) }` : 'Schemas are up to date.' );
			return;
		}
		default:
			throw new Error( `Unknown command "${ command }". See \`studio-capture help\`.` );
	}
}
