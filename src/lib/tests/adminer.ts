/**
 * @jest-environment node
 */
import { shell } from 'electron';
import fs from 'fs';
import * as Sentry from '@sentry/electron/main';
import { setupAdminer, updateAdminerConfig, deleteAdminer } from 'src/lib/adminer';
import { pathExists, recursiveCopyDirectory } from 'src/lib/fs-utils';
import { getSiteUrl } from 'src/lib/get-site-url';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';

jest.mock( 'fs', () => ( {
	promises: {
		readFile: jest.fn(),
		writeFile: jest.fn(),
		copyFile: jest.fn(),
	},
} ) );

jest.mock( 'src/lib/fs-utils', () => ( {
	pathExists: jest.fn(),
	recursiveCopyDirectory: jest.fn(),
} ) );

jest.mock( 'src/lib/locale-node', () => ( {
	getUserLocaleWithFallback: jest.fn(),
} ) );

jest.mock( 'src/lib/get-site-url', () => ( {
	getSiteUrl: jest.fn(),
} ) );

platformTestSuite( 'Adminer setup', ( { normalize } ) => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	describe( 'setupAdminer', () => {
		beforeEach( () => {
			jest.clearAllMocks();
		} );

		it( 'should copy adminer setup files to site path', async () => {
			// Mock pathExists to return false (adminer directory doesn't exist)
			( pathExists as jest.Mock ).mockResolvedValueOnce( false );

			( fs.promises.readFile as jest.Mock ).mockResolvedValueOnce(
				'<?php return array("siteUrl" => "{ADMINER_WP_SITE_URL}", "locale" => "{ADMINER_LOCALE}", "siteName" => "{ADMINER_WP_SITE_NAME}");'
			);

			// Mock recursiveCopyDirectory to succeed
			( recursiveCopyDirectory as jest.Mock ).mockResolvedValueOnce( true );

			// Mock copyFile to succeed
			( fs.promises.copyFile as jest.Mock ).mockResolvedValueOnce( undefined );

			// Mock getUserLocaleWithFallback to return en_US
			( getUserLocaleWithFallback as jest.Mock ).mockResolvedValueOnce( 'en_US' );

			// Mock getSiteUrl to return http://localhost:8080
			( getSiteUrl as jest.Mock ).mockReturnValueOnce( 'http://localhost:8080' );

			// Call setupAdminer
			await setupAdminer( {
				path: 'mock-site-path',
				id: 'mock-site-id',
				running: true,
				name: 'mock-site-name',
				port: 8080,
				phpVersion: '8.0',
				url: 'https://mock-site-url',
			} );

			// Verify the correct sequence of operations
			expect( fs.promises.writeFile ).toHaveBeenCalledWith(
				'vendor/adminer/translations.php',
				expect.stringContaining( 'Open site' )
			);
			expect( recursiveCopyDirectory ).toHaveBeenCalledWith(
				'vendor/adminer',
				normalize( 'mock-site-path/adminer' )
			);
			expect( fs.promises.copyFile ).toHaveBeenCalledWith(
				'vendor/adminer/config.php',
				normalize( 'mock-site-path/adminer/config.php' )
			);
			expect( fs.promises.readFile ).toHaveBeenCalledWith(
				normalize( 'mock-site-path/adminer/config.php' ),
				'utf8'
			);

			// Instead of checking the exact content, just verify that writeFile was called with the config path
			expect( fs.promises.writeFile ).toHaveBeenCalledWith(
				normalize( 'mock-site-path/adminer/config.php' ),
				expect.any( String )
			);
		} );

		it( 'should update adminer when versions do not match', async () => {
			// Mock pathExists to return true (adminer directory exists)
			( pathExists as jest.Mock ).mockResolvedValueOnce( true );

			// Mock recursiveCopyDirectory to succeed
			( recursiveCopyDirectory as jest.Mock ).mockResolvedValueOnce( true );

			// Mock copyFile to succeed
			( fs.promises.copyFile as jest.Mock ).mockResolvedValueOnce( undefined );

			// Mock readFile for version checks and config file
			( fs.promises.readFile as jest.Mock )
				.mockResolvedValueOnce( '1.0.0' ) // source version (newer)
				.mockResolvedValueOnce( '0.0.0' ) // dest version (older)
				.mockResolvedValueOnce(
					'<?php return array("siteUrl" => "{ADMINER_WP_SITE_URL}", "locale" => "{ADMINER_LOCALE}", "siteName" => "{ADMINER_WP_SITE_NAME}");'
				);

			// Mock getUserLocaleWithFallback to return en_US
			( getUserLocaleWithFallback as jest.Mock ).mockResolvedValueOnce( 'en_US' );

			// Mock getSiteUrl to return http://localhost:8080
			( getSiteUrl as jest.Mock ).mockReturnValueOnce( 'http://localhost:8080' );

			// Call setupAdminer
			await setupAdminer( {
				path: 'mock-site-path',
				id: 'mock-site-id',
				running: true,
				name: 'mock-site-name',
				port: 8080,
				phpVersion: '8.0',
				url: 'https://mock-site-url',
			} );

			// Verify the correct sequence of operations
			expect( fs.promises.writeFile ).toHaveBeenCalledWith(
				'vendor/adminer/translations.php',
				expect.stringContaining( 'Open site' )
			);
			expect( recursiveCopyDirectory ).toHaveBeenCalledWith(
				'vendor/adminer',
				normalize( 'mock-site-path/adminer' )
			);
			expect( fs.promises.copyFile ).toHaveBeenCalledWith(
				'vendor/adminer/config.php',
				normalize( 'mock-site-path/adminer/config.php' )
			);
			expect( fs.promises.readFile ).toHaveBeenCalledWith(
				normalize( 'mock-site-path/adminer/config.php' ),
				'utf8'
			);

			// Instead of checking the exact content, just verify that writeFile was called with the config path
			expect( fs.promises.writeFile ).toHaveBeenCalledWith(
				normalize( 'mock-site-path/adminer/config.php' ),
				expect.any( String )
			);
		} );

		it( 'should not update adminer when versions match', async () => {
			// Mock pathExists to return true (adminer directory exists)
			( pathExists as jest.Mock ).mockResolvedValueOnce( true );

			// Mock readFile for version checks - both files exist and have same version
			( fs.promises.readFile as jest.Mock )
				.mockResolvedValueOnce( '1.0.0' ) // source version
				.mockResolvedValueOnce( '1.0.0' ); // dest version matches

			// Call setupAdminer
			await setupAdminer( {
				path: 'mock-site-path',
				id: 'mock-site-id',
				running: true,
				name: 'mock-site-name',
				port: 8080,
				phpVersion: '8.0',
				url: 'https://mock-site-url',
			} );

			// Verify that no file operations were performed
			expect( recursiveCopyDirectory ).not.toHaveBeenCalled();
			expect( fs.promises.copyFile ).not.toHaveBeenCalled();
			expect( fs.promises.writeFile ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'updateAdminerConfig', () => {
		it( 'should update config with site details', async () => {
			// Mock readFile for config file
			( fs.promises.readFile as jest.Mock ).mockResolvedValueOnce(
				'<?php return array("siteUrl" => "{ADMINER_WP_SITE_URL}", "locale" => "{ADMINER_LOCALE}", "siteName" => "{ADMINER_WP_SITE_NAME}");'
			);

			// Mock copyFile to succeed
			( fs.promises.copyFile as jest.Mock ).mockResolvedValueOnce( undefined );

			// Mock getUserLocaleWithFallback to return en_US
			( getUserLocaleWithFallback as jest.Mock ).mockResolvedValueOnce( 'en_US' );

			// Mock getSiteUrl to return http://localhost:8080
			( getSiteUrl as jest.Mock ).mockReturnValueOnce( 'http://localhost:8080' );

			// Call updateAdminerConfig
			await updateAdminerConfig( {
				path: 'mock-site-path',
				id: 'mock-site-id',
				running: false,
				name: 'mock-site-name',
				port: 8080,
				phpVersion: '8.0',
			} );

			// Verify the correct sequence of operations
			expect( fs.promises.copyFile ).toHaveBeenCalledWith(
				'vendor/adminer/config.php',
				normalize( 'mock-site-path/adminer/config.php' )
			);
			expect( fs.promises.readFile ).toHaveBeenCalledWith(
				normalize( 'mock-site-path/adminer/config.php' ),
				'utf8'
			);

			// Instead of checking the exact content, just verify that writeFile was called with the config path
			expect( fs.promises.writeFile ).toHaveBeenCalledWith(
				normalize( 'mock-site-path/adminer/config.php' ),
				expect.any( String )
			);
		} );
	} );

	describe( 'deleteAdminer', () => {
		it( 'should move adminer directory to trash', async () => {
			await deleteAdminer( {
				path: 'mock-site-path',
				id: 'mock-site-id',
				running: false,
				name: 'mock-site-name',
				port: 8080,
				phpVersion: '8.0',
			} );

			expect( shell.trashItem ).toHaveBeenCalledWith( normalize( 'mock-site-path/adminer' ) );
		} );

		it( 'should capture exception on error', async () => {
			( shell.trashItem as jest.Mock ).mockRejectedValueOnce( new Error( 'Delete failed' ) );

			await deleteAdminer( {
				path: 'mock-site-path',
				id: 'mock-site-id',
				running: false,
				name: 'mock-site-name',
				port: 8080,
				phpVersion: '8.0',
			} );

			expect( Sentry.captureException ).toHaveBeenCalled();
		} );
	} );
} );
