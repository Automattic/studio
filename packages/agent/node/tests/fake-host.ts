import { vi } from 'vitest';
import type { CommandOutput, HostSite, StudioAgentHost } from '@studio/agent/node/host';

export const fakeSite: HostSite = {
	id: 'site-123',
	name: 'My Site',
	path: '/sites/my-site',
	url: 'http://localhost:8888',
	phpVersion: '8.4',
	adminPassword: 'password',
};

const commandOutput = ( consoleOutput = '' ): CommandOutput => ( {
	consoleOutput,
	progressOutput: '',
	exitCode: undefined,
} );

// A host whose operations are spies that succeed with empty output. Tests
// override the ones they exercise.
export function createFakeHost( sitesRoot = '/sites' ): StudioAgentHost {
	return {
		sitesRoot,
		userAgent: 'WordPressStudio/test',
		sites: {
			resolve: vi.fn( async () => fakeSite ),
			findByFolder: vi.fn( async () => undefined ),
			all: vi.fn( async () => [ fakeSite ] ),
			list: vi.fn( async () => '[]' ),
			status: vi.fn( async () => '' ),
			create: vi.fn( async () => {} ),
			start: vi.fn( async () => {} ),
			stop: vi.fn( async () => {} ),
			delete: vi.fn( async () => {} ),
			isRunning: vi.fn( async () => true ),
			import: vi.fn( async () => commandOutput() ),
			export: vi.fn( async () => commandOutput() ),
			wpCli: vi.fn( async () => ( { exitCode: 0, stdout: '', stderr: '' } ) ),
		},
		previews: {
			list: vi.fn( async () => '[]' ),
			create: vi.fn( async () => commandOutput() ),
			update: vi.fn( async () => commandOutput() ),
			delete: vi.fn( async () => commandOutput() ),
		},
		sync: {
			push: vi.fn( async () => commandOutput() ),
			pull: vi.fn( async () => commandOutput() ),
		},
		wpcom: {
			sites: vi.fn( async () => [] ),
		},
		tracks: {
			record: vi.fn( async () => {} ),
		},
	};
}
