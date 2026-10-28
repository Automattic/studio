import { vi } from 'vitest';
import { nodeHostServices } from '@studio/agent/node/node-host';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';
import type { Snapshot } from '@studio/common/types/snapshot';
import type { SyncSite } from '@studio/common/types/sync';

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

export const fakeRemoteSite: SyncSite = {
	id: 111,
	localSiteId: 'site-123',
	name: 'My Production Site',
	url: 'https://myprod.wordpress.com',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
};

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
		sync: {
			push: vi.fn( async () => fakeRemoteSite ),
			pull: vi.fn( async () => fakeRemoteSite ),
		},
		wpcom: {
			token: vi.fn( async () => 'token' ),
			imageToken: vi.fn( async () => 'token' ),
			sites: vi.fn( async () => [] ),
			connectedSites: vi.fn( async () => [] ),
			request: vi.fn( async () => ( {} ) ),
			payloadsDirectory: '/payloads',
		},
		tracks: {
			record: vi.fn( async () => {} ),
		},
		// The real file system and paths, so tests work in temporary folders.
		path: nodeHostServices().path,
		files: nodeHostServices().files,
		pages: {
			open: vi.fn( async () => {
				throw new Error( 'No browser in tests' );
			} ),
			fetchText: vi.fn( async () => ( { status: 404, body: '' } ) ),
		},
		saveImage: vi.fn( async ( _bytes: Uint8Array, name: string ) => ( {
			path: `/images/${ name }`,
			url: `file:///images/${ name }`,
		} ) ),
	};
}
