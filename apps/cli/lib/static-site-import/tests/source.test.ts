import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildCreateFromSourceBlueprint, sourceSiteName } from 'cli/lib/static-site-import/source';

describe( 'static site import sources', () => {
	const createCapturedSiteArtifact = () => {
		const artifactDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-captured-artifact-' ) );
		const artifactPath = path.join( artifactDir, 'artifact.json' );
		fs.writeFileSync(
			artifactPath,
			JSON.stringify( {
				schema: 'blocks-engine/php-transformer/site-artifact/v1',
				entrypoint: 'website/index.html',
				files: [ { path: 'website/index.html', content: '<main>Captured</main>' } ],
			} )
		);
		return artifactPath;
	};

	const buildCapturedSiteBlueprint = () => {
		return buildCreateFromSourceBlueprint(
			createCapturedSiteArtifact(),
			'Captured Site',
			'https://example.com/static-site-importer.zip',
			'https://example.com/'
		);
	};

	it( 'stages the canonical Static Site Importer request', () => {
		const blueprint = buildCapturedSiteBlueprint();
		const request = JSON.parse( blueprint.staticSiteImport.request );

		expect( request ).toMatchObject( {
			operation: 'apply',
			name: 'Captured Site',
			site_title: 'Captured Site',
			activate: true,
			overwrite: true,
			fail_on_quality: true,
			require_proven_dynamic_client_assets: true,
			seed_entities: true,
			materialize_dependencies: true,
			client_script_policy: 'isolated_preview',
			source_metadata: {
				source: 'studio-create-from',
				source_path: 'https://example.com/',
			},
			source: {
				type: 'files',
				entrypoint: 'website/index.html',
				files: [ { path: 'website/index.html', content: '<main>Captured</main>' } ],
			},
		} );
		expect( blueprint.staticSiteImport ).not.toHaveProperty( 'code' );
		expect( blueprint.staticSiteImport ).not.toHaveProperty( 'source' );
		expect(
			JSON.parse(
				buildCreateFromSourceBlueprint(
					createCapturedSiteArtifact(),
					'Captured Site',
					'https://example.com/static-site-importer.zip',
					'https://example.com/'
				).staticSiteImport.request
			)
		).toMatchObject( { operation: 'apply', fail_on_quality: true } );
	} );

	it( 'forwards artifact-declared classic materialization on the request', () => {
		const artifactDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-classic-artifact-' ) );
		const artifactPath = path.join( artifactDir, 'artifact.json' );
		fs.writeFileSync(
			artifactPath,
			JSON.stringify( {
				schema: 'blocks-engine/php-transformer/site-artifact/v1',
				entrypoint: 'website/index.html',
				theme_materialization: 'classic',
				files: [ { path: 'website/index.html', content: '<main>Home</main>' } ],
			} )
		);

		expect(
			JSON.parse(
				buildCreateFromSourceBlueprint(
					artifactPath,
					'Classic Site',
					'https://example.com/static-site-importer.zip'
				).staticSiteImport.request
			).theme_materialization
		).toBe( 'classic' );
	} );

	it( 'stages a Data Liberation capture directory for SSI to resolve', () => {
		const captureDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-capture-test-' ) );
		fs.mkdirSync( path.join( captureDir, 'website' ) );
		fs.writeFileSync( path.join( captureDir, 'website', 'index.html' ), '<main>Captured</main>' );
		fs.writeFileSync( path.join( captureDir, 'diagnostics.json' ), '{"failures":[]}' );
		fs.writeFileSync(
			path.join( captureDir, 'capture-receipt.json' ),
			JSON.stringify( {
				schema: 'blocks-engine-capture/capture-receipt/v1',
				websiteRoot: 'website',
				reports: [ 'diagnostics.json' ],
			} )
		);

		const blueprint = buildCreateFromSourceBlueprint(
			captureDir,
			'Liberated Site',
			'https://example.com/static-site-importer.zip'
		);
		const request = JSON.parse( blueprint.staticSiteImport.request );

		expect( blueprint.staticSiteImport.sourcePath ).toBe( captureDir );
		expect( request.source ).toEqual( { type: 'files', ref: 'request-bundle:source' } );
		expect( request ).not.toHaveProperty( 'write_theme_report_artifacts' );
	} );

	it( 'imports a plain HTML directory that has no capture sidecars', () => {
		const sourceDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-plain-html-' ) );
		fs.writeFileSync( path.join( sourceDir, 'index.html' ), '<main>Plain</main>' );

		const blueprint = buildCreateFromSourceBlueprint(
			sourceDir,
			'Plain Site',
			'https://example.com/static-site-importer.zip'
		);
		const request = JSON.parse( blueprint.staticSiteImport.request );

		expect( blueprint.staticSiteImport.sourcePath ).toBe( sourceDir );
		expect( request.source ).toEqual( {
			type: 'files',
			ref: 'request-bundle:source',
		} );
		expect( request.source ).not.toHaveProperty( 'metadata' );
	} );

	it( 'rejects sources outside the canonical importer contract', () => {
		expect( () =>
			buildCreateFromSourceBlueprint( 'https://example.com/', 'Remote Site', {
				path: '/unused.zip',
			} )
		).toThrow( 'must be rendered by Data Liberation' );

		const sourceDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-figma-source-' ) );
		const figmaPath = path.join( sourceDir, 'design.fig' );
		fs.writeFileSync( figmaPath, 'figma' );
		expect( () =>
			buildCreateFromSourceBlueprint( figmaPath, 'Figma Site', { path: '/unused.zip' } )
		).toThrow( 'Figma files are not supported by the canonical Static Site Importer command.' );
	} );

	it( 'names a local source from its artifact or capture title unless a name is given', () => {
		const artifactDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-titled-artifact-' ) );
		const artifactPath = path.join( artifactDir, 'site.json' );
		fs.writeFileSync( artifactPath, JSON.stringify( { site_title: '  Titled Artifact  ' } ) );
		const captureDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-titled-capture-' ) );
		const websiteDir = path.join( captureDir, 'website' );
		fs.mkdirSync( websiteDir );
		fs.writeFileSync(
			path.join( captureDir, 'capture-receipt.json' ),
			JSON.stringify( {
				schema: 'blocks-engine-capture/capture-receipt/v1',
				title: 'Captured Title',
			} )
		);

		expect( sourceSiteName( artifactPath ) ).toBe( 'Titled Artifact' );
		expect( sourceSiteName( artifactPath, 'Custom' ) ).toBe( 'Custom' );
		expect( sourceSiteName( captureDir ) ).toBe( 'Captured Title' );
		expect( sourceSiteName( websiteDir ) ).toBeUndefined();
		expect( sourceSiteName( 'https://example.com/' ) ).toBeUndefined();
		expect( sourceSiteName( 'https://example.com/', 'Named' ) ).toBe( 'Named' );
	} );
} );
