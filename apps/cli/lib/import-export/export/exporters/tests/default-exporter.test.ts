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
