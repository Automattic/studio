import { StreamedPHPResponse } from '@php-wasm/universal';
import {
	getSiteByFolder,
	isXdebugBetaEnabled,
	unlockAppdata,
	readAppdata,
	saveAppdata,
	SiteData,
} from 'cli/lib/appdata';
import { updateDomainInHosts } from 'cli/lib/hosts-file';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { setupCustomDomain } from 'cli/lib/site-utils';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { getDomainNameValidationError } from 'common/lib/domains';
import { arePathsEqual } from 'common/lib/fs-utils';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { runCommand } from '../set';

vi.mock( 'common/lib/domains' );
vi.mock( 'common/lib/fs-utils', async () => {
	const actual = await vi.importActual( 'common/lib/fs-utils' );
	return {
		...actual,
		arePathsEqual: vi.fn(),
	};
} );
vi.mock( 'cli/lib/appdata', async () => {
	const actual = await vi.importActual( 'cli/lib/appdata' );
	return {
		...actual,
		getSiteByFolder: vi.fn(),
		isXdebugBetaEnabled: vi.fn(),
		lockAppdata: vi.fn().mockResolvedValue( undefined ),
		unlockAppdata: vi.fn().mockResolvedValue( undefined ),
		readAppdata: vi.fn(),
		saveAppdata: vi.fn().mockResolvedValue( undefined ),
		updateSiteLatestCliPid: vi.fn().mockResolvedValue( undefined ),
	};
} );
vi.mock( 'cli/lib/hosts-file' );
vi.mock( 'cli/lib/pm2-manager' );
vi.mock( 'cli/lib/run-wp-cli-command' );
vi.mock( 'cli/lib/site-utils' );
vi.mock( 'cli/lib/wordpress-server-manager' );

describe( 'CLI: studio site set', () => {
	const testSitePath = '/test/site';

	const getTestSite = (): SiteData => ( {
		id: 'site-1',
		name: 'Test Site',
		path: testSitePath,
		port: 8080,
		phpVersion: '8.0',
		adminUsername: 'admin',
		adminPassword: 'password123',
	} );

	const getTestSiteWithDomain = (): SiteData => ( {
		...getTestSite(),
		customDomain: 'test.local',
		enableHttps: false,
	} );

	const testProcessDescription = {
		name: 'test-site',
		pmId: 0,
		status: 'online',
		pid: 12345,
	};

	beforeEach( () => {
		vi.clearAllMocks();

		const testSite = getTestSite();
		const testAppdata = { sites: [ testSite ], snapshots: [] };

		vi.mocked( arePathsEqual ).mockReturnValue( true );
		vi.mocked( getSiteByFolder ).mockResolvedValue( getTestSite() );
		vi.mocked( isXdebugBetaEnabled ).mockResolvedValue( true );
		vi.mocked( readAppdata ).mockResolvedValue( testAppdata );
		vi.mocked( connect ).mockResolvedValue( undefined );
		vi.mocked( disconnect ).mockResolvedValue( undefined );
		vi.mocked( isServerRunning ).mockResolvedValue( undefined );
		vi.mocked( startWordPressServer ).mockResolvedValue( testProcessDescription );
		vi.mocked( stopWordPressServer ).mockResolvedValue( undefined );
		vi.mocked( updateDomainInHosts ).mockResolvedValue( undefined );
		vi.mocked( setupCustomDomain ).mockResolvedValue( undefined );
		vi.mocked( getDomainNameValidationError ).mockReturnValue( '' );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	describe( 'Validation', () => {
		it( 'should throw when no options provided', async () => {
			await expect( runCommand( testSitePath, {} ) ).rejects.toThrow(
				'At least one option (--name, --domain, --https, --php, --wp, --xdebug) is required.'
			);
		} );

		it( 'should throw when name is empty', async () => {
			await expect( runCommand( testSitePath, { name: '   ' } ) ).rejects.toThrow(
				'Site name cannot be empty.'
			);
		} );

		it( 'should throw when domain validation fails', async () => {
			vi.mocked( getDomainNameValidationError ).mockReturnValue( 'Invalid domain' );

			await expect( runCommand( testSitePath, { domain: 'invalid' } ) ).rejects.toThrow(
				'Invalid domain'
			);
		} );

		it( 'should throw when enabling HTTPS without domain', async () => {
			await expect( runCommand( testSitePath, { https: true } ) ).rejects.toThrow(
				'HTTPS requires a custom domain. Use --domain to set one.'
			);
		} );

		it( 'should throw when no actual changes would be made', async () => {
			// Site already has name 'Test Site' and phpVersion '8.0'
			await expect( runCommand( testSitePath, { name: 'Test Site' } ) ).rejects.toThrow(
				'No changes to apply. The site already has the specified settings.'
			);
		} );

		it( 'should allow enabling HTTPS when domain is being set', async () => {
			await runCommand( testSitePath, { domain: 'new.local', https: true } );

			const savedAppdata = vi.mocked( saveAppdata ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].customDomain ).toBe( 'new.local' );
			expect( savedAppdata.sites[ 0 ].enableHttps ).toBe( true );
		} );

		it( 'should allow enabling HTTPS when site already has domain', async () => {
			const siteWithDomain = getTestSiteWithDomain();
			vi.mocked( getSiteByFolder ).mockResolvedValue( siteWithDomain );
			vi.mocked( readAppdata ).mockResolvedValue( {
				sites: [ siteWithDomain ],
				snapshots: [],
			} );

			await runCommand( testSitePath, { https: true } );

			const savedAppdata = vi.mocked( saveAppdata ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableHttps ).toBe( true );
		} );
	} );

	describe( 'Name changes', () => {
		it( 'should update site name without restart', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );

			await runCommand( testSitePath, { name: 'New Name' } );

			const savedAppdata = vi.mocked( saveAppdata ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].name ).toBe( 'New Name' );
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'Domain changes', () => {
		it( 'should update domain and hosts file', async () => {
			await runCommand( testSitePath, { domain: 'new.local' } );

			const savedAppdata = vi.mocked( saveAppdata ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].customDomain ).toBe( 'new.local' );
			expect( updateDomainInHosts ).toHaveBeenCalledWith( undefined, 'new.local', 8080 );
		} );

		it( 'should restart running site when domain changes', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );

			await runCommand( testSitePath, { domain: 'new.local' } );

			expect( stopWordPressServer ).toHaveBeenCalledWith( 'site-1' );
			expect( startWordPressServer ).toHaveBeenCalled();
		} );

		it( 'should not restart stopped site when domain changes', async () => {
			await runCommand( testSitePath, { domain: 'new.local' } );

			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'HTTPS changes', () => {
		it( 'should update HTTPS setting', async () => {
			const siteWithDomain = getTestSiteWithDomain();
			vi.mocked( getSiteByFolder ).mockResolvedValue( siteWithDomain );
			vi.mocked( readAppdata ).mockResolvedValue( {
				sites: [ siteWithDomain ],
				snapshots: [],
			} );

			await runCommand( testSitePath, { https: true } );

			const savedAppdata = vi.mocked( saveAppdata ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableHttps ).toBe( true );
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
		} );

		it( 'should restart running site when HTTPS changes', async () => {
			const siteWithDomain = getTestSiteWithDomain();
			vi.mocked( getSiteByFolder ).mockResolvedValue( siteWithDomain );
			vi.mocked( readAppdata ).mockResolvedValue( {
				sites: [ siteWithDomain ],
				snapshots: [],
			} );
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );

			await runCommand( testSitePath, { https: true } );

			expect( stopWordPressServer ).toHaveBeenCalledWith( 'site-1' );
			expect( startWordPressServer ).toHaveBeenCalled();
		} );
	} );

	describe( 'PHP version changes', () => {
		it( 'should update PHP version', async () => {
			await runCommand( testSitePath, { php: '8.2' } );

			const savedAppdata = vi.mocked( saveAppdata ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].phpVersion ).toBe( '8.2' );
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
		} );

		it( 'should restart running site when PHP version changes', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );

			await runCommand( testSitePath, { php: '8.2' } );

			expect( stopWordPressServer ).toHaveBeenCalledWith( 'site-1' );
			expect( startWordPressServer ).toHaveBeenCalled();
		} );
	} );

	describe( 'WordPress version changes', () => {
		beforeEach( () => {
			const mockResponse: Partial< StreamedPHPResponse > = {
				exitCode: Promise.resolve( 0 ),
			};
			vi.mocked( runWpCliCommand ).mockResolvedValue( [
				mockResponse as StreamedPHPResponse,
				vi.fn().mockResolvedValue( undefined ),
			] );
		} );

		it( 'should run WP-CLI to update WordPress version', async () => {
			await runCommand( testSitePath, { wp: '6.7' } );

			expect( runWpCliCommand ).toHaveBeenCalledWith(
				testSitePath,
				'8.0',
				expect.arrayContaining( [ 'core', 'update' ] )
			);
		} );

		it( 'should stop server before WP-CLI when running', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );

			await runCommand( testSitePath, { wp: '6.7' } );

			expect( stopWordPressServer ).toHaveBeenCalledWith( 'site-1' );
			expect( runWpCliCommand ).toHaveBeenCalled();
			expect( startWordPressServer ).toHaveBeenCalled();
		} );

		it( 'should throw when WP-CLI fails', async () => {
			const mockResponse: Partial< StreamedPHPResponse > = {
				exitCode: Promise.resolve( 1 ),
			};
			vi.mocked( runWpCliCommand ).mockResolvedValue( [
				mockResponse as StreamedPHPResponse,
				vi.fn().mockResolvedValue( undefined ),
			] );

			await expect( runCommand( testSitePath, { wp: '6.7' } ) ).rejects.toThrow(
				'Failed to update WordPress version to 6.7'
			);
		} );

		it( 'should update isWpAutoUpdating to false when using specific version', async () => {
			await runCommand( testSitePath, { wp: '6.8' } );

			expect( saveAppdata ).toHaveBeenCalledWith(
				expect.objectContaining( {
					sites: expect.arrayContaining( [
						expect.objectContaining( { isWpAutoUpdating: false } ),
					] ),
				} )
			);
		} );
	} );

	describe( 'Multiple options', () => {
		it( 'should apply multiple changes at once', async () => {
			await runCommand( testSitePath, {
				name: 'New Name',
				domain: 'new.local',
				php: '8.2',
			} );

			const savedAppdata = vi.mocked( saveAppdata ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].name ).toBe( 'New Name' );
			expect( savedAppdata.sites[ 0 ].customDomain ).toBe( 'new.local' );
			expect( savedAppdata.sites[ 0 ].phpVersion ).toBe( '8.2' );
		} );

		it( 'should only restart once when multiple changes need restart', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );

			await runCommand( testSitePath, {
				domain: 'new.local',
				php: '8.2',
			} );

			// Should stop once and start once
			expect( stopWordPressServer ).toHaveBeenCalledTimes( 1 );
			expect( startWordPressServer ).toHaveBeenCalledTimes( 1 );
		} );

		it( "should restart if options contain changes that require restart and ones that don't", async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );

			await runCommand( testSitePath, {
				name: 'New Name',
				domain: 'new.local',
			} );

			// Name doesn't trigger restart, but domain does
			expect( stopWordPressServer ).toHaveBeenCalledTimes( 1 );
			expect( startWordPressServer ).toHaveBeenCalledTimes( 1 );
		} );
	} );

	describe( 'Xdebug changes', () => {
		it( 'should throw when beta feature is not enabled', async () => {
			vi.mocked( isXdebugBetaEnabled ).mockResolvedValue( false );

			await expect( runCommand( testSitePath, { xdebug: true } ) ).rejects.toThrow(
				'Xdebug support is a beta feature. Enable it in Studio settings first.'
			);
		} );

		it( 'should throw when another site already has xdebug enabled', async () => {
			const testSite = getTestSite();
			const otherSite = {
				...getTestSite(),
				id: 'site-2',
				name: 'Other Site',
				path: '/other/site',
				enableXdebug: true,
			};
			vi.mocked( getSiteByFolder ).mockResolvedValue( testSite );
			vi.mocked( readAppdata ).mockResolvedValue( {
				sites: [ testSite, otherSite ],
				snapshots: [],
			} );

			await expect( runCommand( testSitePath, { xdebug: true } ) ).rejects.toThrow(
				'Only one site can have Xdebug enabled at a time. Disable Xdebug on "Other Site" first.'
			);
		} );

		it( 'should update xdebug setting without restart when site is stopped', async () => {
			await runCommand( testSitePath, { xdebug: true } );

			const savedAppdata = vi.mocked( saveAppdata ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableXdebug ).toBe( true );
			expect( stopWordPressServer ).not.toHaveBeenCalled();
			expect( startWordPressServer ).not.toHaveBeenCalled();
		} );

		it( 'should restart running site when xdebug changes', async () => {
			vi.mocked( isServerRunning ).mockResolvedValue( testProcessDescription );

			await runCommand( testSitePath, { xdebug: true } );

			expect( stopWordPressServer ).toHaveBeenCalledWith( 'site-1' );
			expect( startWordPressServer ).toHaveBeenCalled();
		} );

		it( 'should disable xdebug', async () => {
			const siteWithXdebug = { ...getTestSite(), enableXdebug: true };
			vi.mocked( getSiteByFolder ).mockResolvedValue( siteWithXdebug );
			vi.mocked( readAppdata ).mockResolvedValue( {
				sites: [ siteWithXdebug ],
				snapshots: [],
			} );

			await runCommand( testSitePath, { xdebug: false } );

			const savedAppdata = vi.mocked( saveAppdata ).mock.calls[ 0 ][ 0 ];
			expect( savedAppdata.sites[ 0 ].enableXdebug ).toBe( false );
		} );

		it( 'should throw when xdebug is already enabled', async () => {
			const siteWithXdebug = { ...getTestSite(), enableXdebug: true };
			vi.mocked( getSiteByFolder ).mockResolvedValue( siteWithXdebug );
			vi.mocked( readAppdata ).mockResolvedValue( {
				sites: [ siteWithXdebug ],
				snapshots: [],
			} );

			await expect( runCommand( testSitePath, { xdebug: true } ) ).rejects.toThrow(
				'No changes to apply. The site already has the specified settings.'
			);
		} );

		it( 'should throw when xdebug is already disabled', async () => {
			const siteWithXdebugDisabled = { ...getTestSite(), enableXdebug: false };
			vi.mocked( getSiteByFolder ).mockResolvedValue( siteWithXdebugDisabled );
			vi.mocked( readAppdata ).mockResolvedValue( {
				sites: [ siteWithXdebugDisabled ],
				snapshots: [],
			} );

			await expect( runCommand( testSitePath, { xdebug: false } ) ).rejects.toThrow(
				'No changes to apply. The site already has the specified settings.'
			);
		} );
	} );

	describe( 'Error handling', () => {
		it( 'should throw when site not found', async () => {
			vi.mocked( getSiteByFolder ).mockRejectedValue( new Error( 'Site not found' ) );

			await expect( runCommand( testSitePath, { name: 'New Name' } ) ).rejects.toThrow(
				'Site not found'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should always disconnect PM2 on error', async () => {
			vi.mocked( saveAppdata ).mockRejectedValue( new Error( 'Save failed' ) );

			await expect( runCommand( testSitePath, { name: 'New Name' } ) ).rejects.toThrow(
				'Save failed'
			);
			expect( disconnect ).toHaveBeenCalled();
		} );

		it( 'should always unlock appdata on error', async () => {
			vi.mocked( saveAppdata ).mockRejectedValue( new Error( 'Save failed' ) );

			await expect( runCommand( testSitePath, { name: 'New Name' } ) ).rejects.toThrow();
			expect( unlockAppdata ).toHaveBeenCalled();
		} );
	} );
} );
