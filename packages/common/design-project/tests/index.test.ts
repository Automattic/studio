import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	acceptDesignArtifact,
	getDesignProjectRoot,
	initializeDesignProject,
	readDesignProject,
	registerDesignArtifact,
	resolveDesignProjectPath,
	selectDesignArtifact,
} from '..';

const tempPaths: string[] = [];

afterEach( async () => {
	await Promise.all(
		tempPaths.splice( 0 ).map( ( item ) => fs.promises.rm( item, { recursive: true } ) )
	);
} );

async function createSitePath(): Promise< string > {
	const sitePath = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-design-project-' ) );
	tempPaths.push( sitePath );
	return sitePath;
}

describe( 'design projects', () => {
	it( 'initializes and resumes a project', async () => {
		const sitePath = await createSitePath();
		const created = await initializeDesignProject( {
			sitePath,
			siteId: 'site-1',
			brief: 'A neighborhood bakery',
		} );

		expect( created.phase ).toBe( 'briefing' );
		expect( await readDesignProject( sitePath ) ).toEqual( created );
		expect(
			await initializeDesignProject( { sitePath, siteId: 'site-1', brief: 'Other' } )
		).toEqual( created );
	} );

	it( 'registers, selects, and accepts an immutable artifact', async () => {
		const sitePath = await createSitePath();
		await initializeDesignProject( { sitePath, siteId: 'site-1', brief: 'Bakery' } );
		const artifactDir = path.join( getDesignProjectRoot( sitePath ), 'artifacts', 'warm' );
		await fs.promises.mkdir( artifactDir, { recursive: true } );
		await fs.promises.writeFile( path.join( artifactDir, 'index.html' ), '<h1>Warm bakery</h1>' );

		const registered = await registerDesignArtifact( {
			sitePath,
			relativeIndexPath: 'artifacts/warm/index.html',
			label: 'Warm',
		} );
		const id = registered.artifacts[ 0 ].id;
		const selected = await selectDesignArtifact( sitePath, id );
		const accepted = await acceptDesignArtifact( sitePath, id );

		expect( selected.selectedArtifactId ).toBe( id );
		expect( accepted.acceptedArtifactId ).toBe( id );
		expect( accepted.manifestRevision ).toBe( 3 );
	} );

	it( 'rejects paths outside the project', async () => {
		const sitePath = await createSitePath();
		expect( () => resolveDesignProjectPath( sitePath, '../../secrets.txt' ) ).toThrow(
			'escapes the project directory'
		);
	} );

	it( 'registers a revision in the selected artifact lineage', async () => {
		const sitePath = await createSitePath();
		await initializeDesignProject( { sitePath, siteId: 'site-1', brief: 'Bakery' } );
		for ( const name of [ 'warm-r1', 'warm-r2' ] ) {
			const artifactDir = path.join( getDesignProjectRoot( sitePath ), 'artifacts', name );
			await fs.promises.mkdir( artifactDir, { recursive: true } );
			await fs.promises.writeFile( path.join( artifactDir, 'index.html' ), `<h1>${ name }</h1>` );
		}
		const original = await registerDesignArtifact( {
			sitePath,
			relativeIndexPath: 'artifacts/warm-r1/index.html',
			label: 'Warm',
		} );
		const parentArtifactId = original.artifacts[ 0 ].id;
		const revised = await registerDesignArtifact( {
			sitePath,
			relativeIndexPath: 'artifacts/warm-r2/index.html',
			label: 'Warm',
			parentArtifactId,
		} );

		expect( revised.artifacts[ 1 ].parentArtifactId ).toBe( parentArtifactId );
		expect( revised.selectedArtifactId ).toBe( revised.artifacts[ 1 ].id );
		expect( revised.phase ).toBe( 'refining' );
	} );
} );
