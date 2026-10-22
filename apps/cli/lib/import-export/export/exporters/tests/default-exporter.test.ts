import fs from 'fs';
import os from 'os';
import path from 'path';
import { DefaultExporter } from '../default-exporter';
import type { ExportOptions } from '../../types';

vi.mock( 'cli/lib/run-wp-cli-command' );

const exporter = new DefaultExporter( {
	site: { id: 'site-1', name: 'Test Site', path: '/Users/me/.cache/node_modules/site' },
	backupFile: '/tmp/backup.zip',
	includes: { wpContent: true, database: false },
	phpVersion: '8.3',
} as ExportOptions );

const p = ( ...parts: string[] ) => path.join( ...parts );

describe( 'DefaultExporter', () => {
	describe( 'isExactPathExcluded', () => {
		it( 'excludes the wp-content cache directory and its contents', () => {
			expect( exporter.isExactPathExcluded( p( 'wp-content', 'cache' ) ) ).toBe( true );
			expect( exporter.isExactPathExcluded( p( 'wp-content', 'cache', 'page.html' ) ) ).toBe(
				true
			);
		} );

		it( 'does not exclude cache directories inside plugins or themes', () => {
			expect(
				exporter.isExactPathExcluded(
					p(
						'wp-content',
						'plugins',
						'elementor',
						'modules',
						'interactions',
						'cache',
						'interactions-postmeta.php'
					)
				)
			).toBe( false );
			expect(
				exporter.isExactPathExcluded(
					p( 'wp-content', 'themes', 'foo', 'vendor', 'symfony', 'cache', 'Adapter.php' )
				)
			).toBe( false );
		} );

		it( 'does not exclude siblings that only share a name prefix', () => {
			expect( exporter.isExactPathExcluded( p( 'wp-content', 'cache-backup', 'a.txt' ) ) ).toBe(
				false
			);
			expect( exporter.isExactPathExcluded( p( 'wp-content', 'database-notes.txt' ) ) ).toBe(
				false
			);
		} );

		it( 'excludes Studio-internal files', () => {
			expect( exporter.isExactPathExcluded( p( 'wp-content', 'db.php' ) ) ).toBe( true );
			expect( exporter.isExactPathExcluded( p( 'wp-content', 'database', '.ht.sqlite' ) ) ).toBe(
				true
			);
		} );
	} );

	describe( 'addWpConfig', () => {
		const wpConfig = "<?php\ndefine( 'WP_ENVIRONMENT_TYPE', 'local' );\n$table_prefix = 'wp_';\n";
		let sitePath: string;

		beforeEach( () => {
			sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-default-exporter-' ) );
			fs.writeFileSync( path.join( sitePath, 'wp-config.php' ), wpConfig );
		} );

		afterEach( () => {
			fs.rmSync( sitePath, { recursive: true, force: true } );
		} );

		function addWpConfig( options: Partial< ExportOptions > ) {
			const siteExporter = new DefaultExporter( {
				site: { id: 'site-1', name: 'Test Site', path: sitePath },
				backupFile: '/tmp/backup.tar.gz',
				includes: { wpContent: true, database: true },
				phpVersion: '8.3',
				...options,
			} as ExportOptions );
			const archiveBuilder = { file: vi.fn(), append: vi.fn() };
			Object.assign( siteExporter, { archiveBuilder } );
			( siteExporter as unknown as { addWpConfig(): void } ).addWpConfig();
			return archiveBuilder;
		}

		it( 'archives the stripped content without changing the local file', () => {
			const archiveBuilder = addWpConfig( { stripStudioWpConfigConstants: true } );

			expect( archiveBuilder.file ).not.toHaveBeenCalled();
			expect( archiveBuilder.append ).toHaveBeenCalledWith( "<?php\n$table_prefix = 'wp_';\n", {
				name: 'wp-config.php',
			} );
			expect( fs.readFileSync( path.join( sitePath, 'wp-config.php' ), 'utf-8' ) ).toBe( wpConfig );
		} );

		it( 'archives the local file as is by default', () => {
			const archiveBuilder = addWpConfig( {} );

			expect( archiveBuilder.append ).not.toHaveBeenCalled();
			expect( archiveBuilder.file ).toHaveBeenCalledWith( path.join( sitePath, 'wp-config.php' ), {
				name: 'wp-config.php',
			} );
		} );
	} );

	describe( 'isPathExcludedByPattern', () => {
		it( 'excludes files inside .git and node_modules directories', () => {
			expect(
				exporter.isPathExcludedByPattern(
					p( 'wp-content', 'plugins', 'foo', 'node_modules', 'x', 'index.js' )
				)
			).toBe( true );
			expect(
				exporter.isPathExcludedByPattern( p( 'wp-content', 'themes', 'bar', '.git', 'HEAD' ) )
			).toBe( true );
		} );

		it( 'does not exclude directories named cache', () => {
			expect(
				exporter.isPathExcludedByPattern(
					p( 'wp-content', 'plugins', 'elementor', 'modules', 'interactions', 'cache', 'a.php' )
				)
			).toBe( false );
		} );

		it( 'does not exclude files that are named like an excluded directory', () => {
			expect(
				exporter.isPathExcludedByPattern( p( 'wp-content', 'plugins', 'foo', 'node_modules' ) )
			).toBe( false );
		} );
	} );
} );
