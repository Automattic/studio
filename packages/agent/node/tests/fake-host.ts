import path from 'path';
import { vi } from 'vitest';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { RemoteHost } from '@studio/agent/node/remote-hosts';
import type { Snapshot } from '@studio/common/types/snapshot';

export const fakeSite: HostSite = {
	id: 'site-123',
	name: 'My Site',
	path: '/sites/my-site',
	url: 'http://localhost:8888',
	phpVersion: '8.4',
	adminPassword: 'password',
};

export const fakePreview: Snapshot = {
	url: 'demo.wp.build',
	atomicSiteId: 12345,
	localSiteId: 'site-123',
	date: 0,
	name: 'My Site Preview 1',
};

// WordPress.com as the CLI provides it, with spies that find no sites.
export function fakeWpcom(): RemoteHost {
	return {
		name: 'WordPress.com',
		environment:
			"The user's WordPress.com sites are live sites, reached through the WordPress.com REST API.",
		sites: {
			listKey: 'wordpressCom',
			list: vi.fn( async () => ( { signedIn: true, sites: [] } ) ),
			facts: vi.fn( async () => [] ),
		},
		publishes: 'WordPress.com sites',
		publishable: vi.fn( async () => ( { signedIn: true, sites: [] } ) ),
		newSiteUrl: () => 'https://wordpress.com/setup',
		signIn: 'Sign in with /login.',
		targets: vi.fn( async () => ( { signedIn: true, targets: [] } ) ),
		mcpServer: vi.fn( async () => undefined ),
		push: vi.fn( async () => 'Pushed.' ),
		pull: vi.fn( async () => 'Pulled.' ),
	};
}

// A host whose operations are spies that succeed. Tests override the ones they
// exercise.
export function createFakeHost( sitesRoot = '/sites' ): StudioAgentHost {
	return {
		sitesRoot,
		userAgent: 'WordPressStudio/test',
		sites: {
			resolve: vi.fn( async () => fakeSite ),
			findByFolder: vi.fn( async () => undefined ),
			all: vi.fn( async () => [ fakeSite ] ),
			list: vi.fn( async () => [] ),
			status: vi.fn( async () => ( {
				url: `${ fakeSite.url }/`,
				path: fakeSite.path,
				emailPath: '/email/site-123',
				running: false,
				phpVersion: fakeSite.phpVersion,
				fileAccess: 'site-directory' as const,
				xdebug: false,
				adminUsername: 'admin',
			} ) ),
			create: vi.fn( async () => {} ),
			start: vi.fn( async () => {} ),
			stop: vi.fn( async () => {} ),
			delete: vi.fn( async () => {} ),
			isRunning: vi.fn( async () => true ),
			import: vi.fn( async () => {} ),
			export: vi.fn( async () => {} ),
			wpCli: vi.fn( async () => ( { exitCode: 0, stdout: '', stderr: '' } ) ),
		},
		previews: {
			list: vi.fn( async () => [] ),
			create: vi.fn( async () => fakePreview ),
			update: vi.fn( async () => fakePreview ),
			delete: vi.fn( async () => {} ),
		},
		blocksEngine: vi.fn( async () => ( { bootstrap: '/engine/bootstrap.php', version: '1.0.0' } ) ),
		remoteHosts: {},
		tracks: {
			record: vi.fn( async () => {} ),
		},
	};
}

// A host whose Studio sites are `sites`, found by name, path or folder as the
// CLI finds them.
export function createFakeHostWithSites(
	sites: Array< Partial< HostSite > & Pick< HostSite, 'path' > >,
	sitesRoot = '/sites'
): StudioAgentHost {
	const host = createFakeHost( sitesRoot );
	const all = sites.map( ( site, i ) => ( {
		...fakeSite,
		id: String( i + 1 ),
		name: path.basename( site.path ),
		...site,
	} ) );
	const byFolder = ( folder: string ) =>
		all.find( ( site ) => path.resolve( site.path ) === path.resolve( folder ) );
	vi.mocked( host.sites.all ).mockImplementation( async () => all );
	vi.mocked( host.sites.findByFolder ).mockImplementation( async ( folder ) => byFolder( folder ) );
	vi.mocked( host.sites.resolve ).mockImplementation( async ( nameOrPath ) => {
		const site = all.find( ( s ) => s.name === nameOrPath ) ?? byFolder( nameOrPath );
		if ( ! site ) {
			throw new Error( `Site not found: ${ nameOrPath }` );
		}
		return site;
	} );
	return host;
}
