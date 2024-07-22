import { ExportOptions } from '../../../export/types';
import { WordPressExportValidator } from '../../../export/validators/wordpress-validator';

describe( 'WordPressExportValidator', () => {
	let validator: WordPressExportValidator;

	beforeEach( () => {
		validator = new WordPressExportValidator();
	} );

	describe( 'canHandle', () => {
		it( 'should return true for a valid WordPress file structure', () => {
			const files = [
				'/site/wp-content/themes/theme.php',
				'/site/wp-includes/version.php',
				'/site/wp-load.php',
				'/site/wp-config.php',
			];
			expect( validator.canHandle( files ) ).toBe( true );
		} );

		it( 'should return false if any required path is missing', () => {
			const files = [
				'/site/wp-content/themes/theme.php',
				'/site/wp-includes/version.php',
				'/site/wp-load.php',
				// wp-config.php is missing
			];
			expect( validator.canHandle( files ) ).toBe( false );
		} );

		it( 'should return true if required paths are in subdirectories', () => {
			const files = [
				'/site/wordpress/wp-content/themes/theme.php',
				'/site/wordpress/wp-includes/version.php',
				'/site/wordpress/wp-load.php',
				'/site/wordpress/wp-config.php',
			];
			expect( validator.canHandle( files ) ).toBe( true );
		} );
	} );

	describe( 'filterFiles', () => {
		const mockOptions: ExportOptions = {
			sitePath: '/site',
			backupFile: '/backup/wordpress.tar.gz',
			includes: {
				uploads: true,
				plugins: true,
				themes: true,
				database: true,
			},
		};

		it( 'should correctly categorize WordPress files', () => {
			const files = [
				'/site/wp-config.php',
				'/site/wp-content/uploads/image.jpg',
				'/site/wp-content/plugins/plugin.php',
				'/site/wp-content/themes/theme/style.css',
			];

			const result = validator.filterFiles( files, mockOptions );

			expect( result.wpConfigFile ).toBe( '/site/wp-config.php' );
			expect( result.wpContent.uploads ).toContain( '/site/wp-content/uploads/image.jpg' );
			expect( result.wpContent.plugins ).toContain( '/site/wp-content/plugins/plugin.php' );
			expect( result.wpContent.themes ).toContain( '/site/wp-content/themes/theme/style.css' );
		} );

		it( 'should respect the includes options', () => {
			const files = [
				'/site/wp-config.php',
				'/site/wp-content/uploads/image.jpg',
				'/site/wp-content/plugins/plugin.php',
				'/site/wp-content/themes/theme/style.css',
			];

			const options: ExportOptions = {
				...mockOptions,
				includes: {
					uploads: false,
					plugins: true,
					themes: false,
					database: true,
				},
			};

			const result = validator.filterFiles( files, options );

			expect( result.wpConfigFile ).toBe( '/site/wp-config.php' );
			expect( result.wpContent.uploads ).toHaveLength( 0 );
			expect( result.wpContent.plugins ).toContain( '/site/wp-content/plugins/plugin.php' );
			expect( result.wpContent.themes ).toHaveLength( 0 );
		} );

		it( 'should handle files in subdirectories', () => {
			const files = [
				'/site/wordpress/wp-config.php',
				'/site/wordpress/wp-content/uploads/image.jpg',
				'/site/wordpress/wp-content/plugins/plugin.php',
				'/site/wordpress/wp-content/themes/theme/style.css',
			];

			const options: ExportOptions = {
				...mockOptions,
				sitePath: '/site/wordpress',
			};

			const result = validator.filterFiles( files, options );

			expect( result.wpConfigFile ).toBe( '/site/wordpress/wp-config.php' );
			expect( result.wpContent.uploads ).toContain(
				'/site/wordpress/wp-content/uploads/image.jpg'
			);
			expect( result.wpContent.plugins ).toContain(
				'/site/wordpress/wp-content/plugins/plugin.php'
			);
			expect( result.wpContent.themes ).toContain(
				'/site/wordpress/wp-content/themes/theme/style.css'
			);
		} );
	} );
} );
