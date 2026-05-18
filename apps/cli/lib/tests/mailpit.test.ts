import { portFinder } from '@studio/common/lib/port-finder';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
	type SiteData,
} from 'cli/lib/cli-config/core';
import { ensureMailpitConfig } from 'cli/lib/mailpit';

vi.mock( '@studio/common/lib/port-finder', () => ( {
	portFinder: {
		addUnavailablePort: vi.fn(),
		getOpenPort: vi.fn(),
	},
} ) );

vi.mock( 'cli/lib/cli-config/core', async () => {
	const actual = await vi.importActual( 'cli/lib/cli-config/core' );
	return {
		...actual,
		lockCliConfig: vi.fn(),
		readCliConfig: vi.fn(),
		saveCliConfig: vi.fn(),
		unlockCliConfig: vi.fn(),
	};
} );

describe( 'MailPit config', () => {
	const site: SiteData = {
		adminPassword: 'password',
		adminUsername: 'admin',
		id: 'site-1',
		name: 'Mail Site',
		path: '/sites/mail-site',
		phpVersion: '8.3',
		port: 8881,
	};

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( lockCliConfig ).mockResolvedValue( undefined );
		vi.mocked( unlockCliConfig ).mockResolvedValue( undefined );
		vi.mocked( saveCliConfig ).mockResolvedValue( undefined );
	} );

	it( 'keeps an existing site MailPit config without locking the config file', async () => {
		const configuredSite = {
			...site,
			mailpit: {
				enabled: true,
				httpPort: 8025,
				smtpPort: 1025,
			},
		};

		await expect( ensureMailpitConfig( configuredSite ) ).resolves.toBe( configuredSite );

		expect( lockCliConfig ).not.toHaveBeenCalled();
		expect( readCliConfig ).not.toHaveBeenCalled();
		expect( saveCliConfig ).not.toHaveBeenCalled();
	} );

	it( 'reuses MailPit config already persisted for the site', async () => {
		const persistedMailpit = {
			enabled: true,
			httpPort: 8026,
			smtpPort: 1026,
		};
		vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
			version: 1,
			sites: [
				{
					...site,
					mailpit: persistedMailpit,
				},
			],
		} );

		await expect( ensureMailpitConfig( site ) ).resolves.toEqual( {
			...site,
			mailpit: persistedMailpit,
		} );

		expect( lockCliConfig ).toHaveBeenCalled();
		expect( saveCliConfig ).not.toHaveBeenCalled();
		expect( unlockCliConfig ).toHaveBeenCalled();
	} );

	it( 'reserves existing site and MailPit ports before assigning a new config', async () => {
		const existingSite: SiteData = {
			...site,
			id: 'existing-site',
			mailpit: {
				enabled: true,
				httpPort: 8025,
				smtpPort: 1025,
			},
			name: 'Existing Site',
			port: 8882,
		};
		const config = {
			version: 1 as const,
			sites: [ existingSite, { ...site } ],
		};
		vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( config );
		vi.mocked( portFinder.getOpenPort ).mockImplementation( async ( startPort?: number ) => {
			if ( startPort === 8025 ) {
				return 8027;
			}
			if ( startPort === 1025 ) {
				return 1027;
			}
			throw new Error( `Unexpected start port ${ startPort }` );
		} );

		await expect( ensureMailpitConfig( site ) ).resolves.toEqual( {
			...site,
			mailpit: {
				enabled: true,
				httpPort: 8027,
				smtpPort: 1027,
			},
		} );

		expect( portFinder.addUnavailablePort ).toHaveBeenCalledWith( 8882 );
		expect( portFinder.addUnavailablePort ).toHaveBeenCalledWith( 8025 );
		expect( portFinder.addUnavailablePort ).toHaveBeenCalledWith( 1025 );
		expect( portFinder.addUnavailablePort ).toHaveBeenCalledWith( 8881 );
		expect( portFinder.getOpenPort ).toHaveBeenCalledWith( 8025 );
		expect( portFinder.getOpenPort ).toHaveBeenCalledWith( 1025 );
		expect( saveCliConfig ).toHaveBeenCalledWith( {
			...config,
			sites: [
				existingSite,
				{
					...site,
					mailpit: {
						enabled: true,
						httpPort: 8027,
						smtpPort: 1027,
					},
				},
			],
		} );
		expect( unlockCliConfig ).toHaveBeenCalled();
	} );
} );
