import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SCHEMAS_DIR, isUrl, readJson } from './paths.ts';
import { createProfile } from './profile.ts';
import { createSite, runCli, stopAllSites } from './studio-cli.ts';
import type { LoadedScene } from './scene.ts';
import type { Scene } from './schema.ts';

export interface BakeResult {
	scene: string;
	backups: { site: string; backup: string; from: string }[];
}

/**
 * Turns a scene's Blueprint sites into backups, so captures rerun on the same
 * content however the Blueprint or what it downloads changes later. Each site
 * with a `blueprint` is created from it in a throwaway profile and exported
 * whole (database, themes, plugins and uploads) as `<outDir>/<slug>.zip`;
 * the baked scene, written to `sceneOut`, loads those backups with `import`
 * and keeps the Blueprint as `bakedFrom`.
 */
export async function bake(
	scene: LoadedScene,
	{
		outDir = scene.dir,
		sceneOut = path.join(
			outDir,
			scene.file ? `${ path.parse( scene.file ).name }.baked.json` : 'scene.json'
		),
		log = ( message: string ) => console.log( message ),
	}: { outDir?: string; sceneOut?: string; log?: ( message: string ) => void } = {}
): Promise< BakeResult > {
	const sites = scene.sites.filter( ( site ) => site.blueprint );
	if ( ! sites.length ) {
		throw new Error( `Scene ${ scene.name } has no Blueprint sites to bake.` );
	}
	await mkdir( outDir, { recursive: true } );
	const sceneDir = path.dirname( path.resolve( sceneOut ) );
	const relative = ( file: string ) =>
		isUrl( file ) ? file : path.relative( sceneDir, file ).split( path.sep ).join( '/' );
	const backups: BakeResult[ 'backups' ] = [];
	const profile = await createProfile();
	try {
		for ( const site of sites ) {
			log( `Creating ${ site.name } from ${ site.blueprint }...` );
			const sitePath = await createSite( profile, site );
			const backup = path.join( outDir, `${ site.slug }.zip` );
			await rm( backup, { force: true } );
			log( `Exporting ${ path.basename( backup ) }...` );
			await runCli( profile, [ 'export', backup, '--path', sitePath ] );
			backups.push( { site: site.slug, backup, from: site.blueprint as string } );
		}
	} finally {
		await stopAllSites( profile );
		await profile.remove();
	}

	// The scene as written, with paths made relative to where the baked one goes.
	const source: Scene = scene.file
		? await readJson< Scene >( scene.file )
		: { name: scene.name, sites: scene.sites.map( ( site ) => ( { name: site.name } ) ) };
	const fromScene = ( value?: string ) =>
		value === undefined
			? undefined
			: relative( isUrl( value ) ? value : path.resolve( scene.dir, value ) );
	const baked: Scene = {
		...source,
		$schema: relative( path.join( SCHEMAS_DIR, 'scene.schema.json' ) ),
		sites: source.sites.map( ( site, index ) => {
			const resolved = scene.sites[ index ];
			const done = backups.find( ( b ) => b.site === resolved.slug );
			const { blueprint: _blueprint, ...rest } = site;
			return {
				...rest,
				slug: resolved.slug,
				...( done
					? { import: relative( done.backup ), bakedFrom: relative( done.from ) }
					: { import: fromScene( site.import ) } ),
				design: fromScene( site.design ),
			};
		} ),
		account: source.account && {
			wpcomSites: fromScene( source.account.wpcomSites ),
			previewSites: fromScene( source.account.previewSites ),
			aiQuota: fromScene( source.account.aiQuota ),
			aiTopUpPricing: fromScene( source.account.aiTopUpPricing ),
		},
		chats: fromScene( source.chats ),
		agentTurns: fromScene( source.agentTurns ),
		files: fromScene( source.files ),
	};
	await writeFile( sceneOut, JSON.stringify( baked, null, '\t' ) + '\n' );
	log( `Wrote ${ sceneOut }` );
	return { scene: path.resolve( sceneOut ), backups };
}
