/**
 * @vitest-environment node
 */
import { IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import { normalize, join } from 'path';
import * as Sentry from '@sentry/electron/main';
import { recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import { readFile } from 'atomically';
import { vi } from 'vitest';
import {
	createSite,
	isFullscreen,
	importSite,
	getXdebugEnabledSite,
	copySite,
	loadThemeDetails,
} from 'src/ipc-handlers';
import { bumpStat, StatsGroup, StatsMetric } from 'src/lib/bump-stats';
import { importBackup, defaultImporterOptions } from 'src/lib/import-export/import/import-manager';
import { BackupArchiveInfo } from 'src/lib/import-export/import/types';
import { getMainWindow } from 'src/main-window';
import { SiteServer } from 'src/site-server';
import { resolveDefaultSiteDirectory } from 'src/storage/paths';
import { loadUserData } from 'src/storage/user-data';
import type { UserData } from 'src/storage/storage-types';

vi.mock('fs');
vi.mock('fs-extra');
vi.mock('@studio/common/lib/fs-utils');
vi.mock('@sentry/electron/main', () => ({
	captureException: vi.fn(),
	captureMessage: vi.fn(),
}));
vi.mock('src/storage/paths', () => ({
	getResourcesPath: vi.fn().mockReturnValue('/mock/resources'),
	getUserDataFilePath: vi.fn().mockReturnValue('/mock/userdata.json'),
	getUserDataLockFilePath: vi.fn().mockReturnValue('/mock/userdata.json.lock'),
	getUserDataCertificatesPath: vi.fn().mockReturnValue('/mock/certificates'),
	getServerFilesPath: vi.fn().mockReturnValue('/mock/server/files'),
	getCliPath: vi.fn().mockReturnValue('/mock/cli/path'),
	getBundledNodeBinaryPath: vi.fn().mockReturnValue('/mock/node/binary'),
	getSiteThumbnailPath: vi.fn().mockReturnValue('/mock/thumbnail.png'),
	resolveDefaultSiteDirectory: vi.fn().mockResolvedValue('/mock/default/site/path'),
}));
vi.mock('src/storage/user-data', () => ({
	loadUserData: vi.fn().mockResolvedValue({ sites: [] }),
	saveUserData: vi.fn().mockResolvedValue(undefined),
	lockAppdata: vi.fn().mockResolvedValue(undefined),
	unlockAppdata: vi.fn().mockResolvedValue(undefined),
	updateAppdata: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('src/site-server');
vi.mock('src/lib/wordpress-setup', () => ({
	setupWordPressFilesOnly: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('src/main-window');
vi.mock('src/lib/import-export/import/import-manager');
vi.mock(import('src/lib/bump-stats'), async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		bumpStat: vi.fn(),
		bumpAggregatedUniqueStat: vi.fn().mockResolvedValue(undefined),
	};
});
vi.mock('atomically');
vi.mock('src/lib/get-image-data', () => ({
	getImageData: vi.fn().mockResolvedValue('data:image/png;base64,mock'),
}));

vi.mock('@studio/common/lib/port-finder', () => ({
	portFinder: {
		getOpenPort: vi.fn().mockResolvedValue(9999),
	},
}));

const mockSiteDetails: StoppedSiteDetails = {
	id: 'mock-cli-site-id',
	name: 'Test',
	path: '/test',
	port: 9999,
	phpVersion: '8.3',
	running: false,
	adminPassword: 'mock-password',
	isWpAutoUpdating: false,
	customDomain: undefined,
	enableHttps: undefined,
};

vi.mocked(SiteServer.create).mockResolvedValue({
	server: {
		start: vi.fn(),
		details: mockSiteDetails,
		updateSiteDetails: vi.fn(),
		updateCachedThumbnail: vi.fn().mockResolvedValue(undefined),
	} as unknown as SiteServer,
	details: mockSiteDetails,
});

vi.mocked(SiteServer.register, { partial: true }).mockImplementation((details) => ({
	start: vi.fn(),
	details,
	updateSiteDetails: vi.fn(),
	updateCachedThumbnail: vi.fn().mockResolvedValue(undefined),
}));

const mockUserData = {
	sites: [],
};
if ('__setFileContents' in fs) {
	(
		fs as typeof fs & { __setFileContents: (path: string, contents: string | string[]) => void }
	).__setFileContents(
		normalize('/path/to/app/appData/App Name/appdata-v1.json'),
		JSON.stringify(mockUserData)
	);
}
vi.mocked(readFile).mockResolvedValue(Buffer.from(JSON.stringify(mockUserData)));

const mockIpcMainInvokeEvent = {
	sender: { isDestroyed: vi.fn().mockReturnValue(false) },
	// Double assert the type with `unknown` to simplify mocking this value
} as unknown as IpcMainInvokeEvent;

describe('createSite', () => {
	it('should delegate to CLI and return site details', async () => {
		const userData = await createSite(mockIpcMainInvokeEvent, '/test', {
			siteName: 'Test',
			wpVersion: '6.4',
		});

		expect(userData).toEqual({
			adminPassword: 'mock-password',
			id: 'mock-cli-site-id',
			name: 'Test',
			path: '/test',
			phpVersion: '8.3',
			port: 9999,
			running: false,
			customDomain: undefined,
			enableHttps: undefined,
			isWpAutoUpdating: false,
		});

		expect(SiteServer.create).toHaveBeenCalledWith(
			expect.objectContaining({
				path: '/test',
				name: 'Test',
				wpVersion: '6.4',
			}),
			expect.any(Object)
		);
	});
});

describe('isFullscreen', () => {
	it('should return false when window is not in fullscreen', async () => {
		vi.mocked(getMainWindow, { partial: true }).mockResolvedValue({
			isFullScreen: () => false,
		});

		const result = await isFullscreen(mockIpcMainInvokeEvent);

		expect(result).toBe(false);
	});

	it('should return true when window is in fullscreen', async () => {
		vi.mocked(getMainWindow, { partial: true }).mockResolvedValue({
			isFullScreen: () => true,
		});

		const result = await isFullscreen(mockIpcMainInvokeEvent);

		expect(result).toBe(true);
	});
});

describe('importSite', () => {
	const mockBackupFile: BackupArchiveInfo = {
		path: '/path/to/backup.zip',
		type: 'doo',
	};

	beforeEach(() => {
		vi.mocked(importBackup).mockReset();
		vi.mocked(bumpStat).mockReset();
	});

	it('should throw error if site is not found', async () => {
		vi.mocked(SiteServer.get).mockReturnValue(undefined);

		await expect(
			importSite(mockIpcMainInvokeEvent, {
				id: 'non-existent-id',
				backupFile: mockBackupFile,
			})
		).rejects.toThrow('Site not found.');
	});

	it('should import backup successfully and bump success stats', async () => {
		const mockSite = {
			details: {
				id: 'test-site',
				name: 'Test',
				path: '/test',
				port: 9999,
				phpVersion: '8.3',
				running: false,
			},
			meta: {},
			start: vi.fn(),
			stop: vi.fn(),
			updateSiteDetails: vi.fn(),
			executeWpCliCommand: vi
				.fn()
				.mockResolvedValue({ stdout: 'New Site Title', stderr: '', exitCode: 0 }),
		};
		vi.mocked(SiteServer.get, { partial: true }).mockReturnValue(
			mockSite as unknown as Partial<SiteServer>
		);
		vi.mocked(importBackup, { partial: true }).mockResolvedValue({
			meta: {
				phpVersion: '8.3',
			},
		});

		const result = await importSite(mockIpcMainInvokeEvent, {
			id: 'test-site',
			backupFile: mockBackupFile,
		});

		expect(importBackup).toHaveBeenCalledWith(
			mockBackupFile,
			mockSite.details,
			expect.any(Function),
			defaultImporterOptions
		);
		expect(mockSite.details.phpVersion).toBe('8.3');
		expect(result).toBe(mockSite.details);

		expect(bumpStat).toHaveBeenNthCalledWith(
			1,
			StatsGroup.STUDIO_IMPORT,
			StatsMetric.UNKNOWN_IMPORTER
		);
	});

	it('should capture exception in Sentry and bump failure stats when import fails', async () => {
		const mockError = new Error('Import failed');
		const mockSite = {
			details: {
				id: 'test-site',
				name: 'Test',
				path: '/test',
				port: 9999,
				phpVersion: '8.3',
				running: false,
			},
			meta: {},
			start: vi.fn(),
			stop: vi.fn(),
			updateSiteDetails: vi.fn(),
			executeWpCliCommand: vi
				.fn()
				.mockResolvedValue({ stdout: 'New Site Title', stderr: '', exitCode: 0 }),
		};
		vi.mocked(SiteServer.get, { partial: true }).mockReturnValue(
			mockSite as unknown as Partial<SiteServer>
		);
		vi.mocked(importBackup).mockRejectedValue(mockError);

		await expect(
			importSite(mockIpcMainInvokeEvent, {
				id: 'test-site',
				backupFile: mockBackupFile,
			})
		).rejects.toThrow('Import failed');

		expect(Sentry.captureException).toHaveBeenCalledWith(mockError);

		// Verify failure stats were bumped
		expect(bumpStat).toHaveBeenCalledWith(StatsGroup.STUDIO_IMPORT, StatsMetric.FAILURE);
	});
});

describe('copySite', () => {
	it('uses the resolved default site directory for the new path', async () => {
		const sourceSite = {
			details: {
				id: 'source-site-id',
				name: 'Source Site',
				path: '/source/path',
				port: 9998,
				phpVersion: '8.3',
				running: false,
				adminPassword: 'source-password',
				themeDetails: { name: 'Theme', path: '/themes/theme' },
			},
		};

		vi.mocked(SiteServer.get, { partial: true }).mockReturnValue(
			sourceSite as unknown as SiteServer
		);
		vi.mocked(recursiveCopyDirectory).mockResolvedValue(undefined);
		vi.mocked(resolveDefaultSiteDirectory).mockResolvedValue('/mock/default/site/path');
		vi.mocked(fs.existsSync).mockReturnValue(false);

		const result = await copySite(
			mockIpcMainInvokeEvent,
			'source-site-id',
			'new-site-id',
			'MySite'
		);

		const expectedDestination = normalize(join('/mock/default/site/path', 'mysite'));
		expect(resolveDefaultSiteDirectory).toHaveBeenCalled();
		expect(recursiveCopyDirectory).toHaveBeenCalledWith(
			sourceSite.details.path,
			expectedDestination
		);
		expect(result.path).toBe(expectedDestination);
	});
});

describe('getXdebugEnabledSite', () => {
	it('should return null when no site has Xdebug enabled', async () => {
		const mockUserDataWithoutXdebug: UserData = {
			sites: [
				{
					id: 'site-1',
					name: 'Site 1',
					path: '/path/to/site-1',
					enableXdebug: false,
					running: false as const,
					port: 9999,
					phpVersion: '8.3',
				},
				{
					id: 'site-2',
					name: 'Site 2',
					path: '/path/to/site-2',
					running: false as const,
					port: 9999,
					phpVersion: '8.3',
				},
			],
			snapshots: [],
		};
		vi.mocked(loadUserData).mockResolvedValue(mockUserDataWithoutXdebug);
		vi.mocked(fs.existsSync).mockReturnValue(true);

		const result = await getXdebugEnabledSite(mockIpcMainInvokeEvent);

		expect(result).toBeNull();
	});

	it('should return the site that has Xdebug enabled', async () => {
		const mockUserDataWithXdebug: UserData = {
			sites: [
				{
					id: 'site-1',
					name: 'Site 1',
					path: '/path/to/site-1',
					enableXdebug: false,
					running: false as const,
					port: 9999,
					phpVersion: '8.3',
				},
				{
					id: 'site-2',
					name: 'Site 2',
					path: '/path/to/site-2',
					enableXdebug: true,
					running: true as const,
					port: 9999,
					phpVersion: '8.3',
					url: 'https://site-2.test',
				},
			],
			snapshots: [],
		};
		vi.mocked(loadUserData).mockResolvedValue(mockUserDataWithXdebug);
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(SiteServer.get, { partial: true }).mockReturnValue({
			details: {
				id: 'site-2',
				name: 'Site 2',
				path: '/path/to/site-2',
				running: true,
				enableXdebug: true,
				phpVersion: '8.3',
				port: 9999,
				url: 'https://site-2.test',
			},
		});

		const result = await getXdebugEnabledSite(mockIpcMainInvokeEvent);

		expect(result).toEqual({
			id: 'site-2',
			name: 'Site 2',
			path: '/path/to/site-2',
			running: true,
			enableXdebug: true,
			phpVersion: '8.3',
			port: 9999,
			url: 'https://site-2.test',
		});
	});

	it('should return the first site when multiple have Xdebug enabled', async () => {
		const mockUserDataWithMultipleXdebug: UserData = {
			sites: [
				{
					id: 'site-1',
					name: 'Site 1',
					path: '/path/to/site-1',
					enableXdebug: true,
					running: false as const,
					port: 9999,
					phpVersion: '8.3',
				},
				{
					id: 'site-2',
					name: 'Site 2',
					path: '/path/to/site-2',
					enableXdebug: true,
					running: false as const,
					port: 9999,
					phpVersion: '8.3',
				},
			],
			snapshots: [],
		};
		vi.mocked(loadUserData).mockResolvedValue(mockUserDataWithMultipleXdebug);
		vi.mocked(fs.existsSync).mockReturnValue(true);
		vi.mocked(SiteServer.get, { partial: true }).mockReturnValue({
			details: {
				id: 'site-1',
				name: 'Site 1',
				path: '/path/to/site-1',
				running: false,
				enableXdebug: true,
				phpVersion: '8.3',
				port: 9999,
			},
		});

		const result = await getXdebugEnabledSite(mockIpcMainInvokeEvent);

		expect(result).toEqual({
			id: 'site-1',
			name: 'Site 1',
			path: '/path/to/site-1',
			running: false,
			enableXdebug: true,
			phpVersion: '8.3',
			port: 9999,
		});
	});
});

describe('loadThemeDetails', () => {
	it('should update thumbnail but not persist theme details when theme has not changed', async () => {
		const themeDetails = { name: 'Twenty Twenty-Four', path: '/themes/twentytwentyfour' };
		const mockServer = {
			details: {
				id: 'test-site-id',
				running: true,
				themeDetails,
			},
			getThemeDetails: vi.fn().mockResolvedValue(themeDetails),
			persistThemeDetails: vi.fn().mockResolvedValue(undefined),
			updateCachedThumbnail: vi.fn().mockResolvedValue(undefined),
		};
		vi.mocked(SiteServer.get).mockReturnValue(mockServer as unknown as SiteServer);

		await loadThemeDetails(mockIpcMainInvokeEvent, 'test-site-id');

		expect(mockServer.persistThemeDetails).not.toHaveBeenCalled();
		expect(mockServer.updateCachedThumbnail).toHaveBeenCalled();
	});

	it('should persist theme details and update thumbnail when theme has changed', async () => {
		const oldThemeDetails = { name: 'Twenty Twenty-Four', path: '/themes/twentytwentyfour' };
		const newThemeDetails = { name: 'Twenty Twenty-Five', path: '/themes/twentytwentyfive' };
		const mockServer = {
			details: {
				id: 'test-site-id',
				running: true,
				themeDetails: oldThemeDetails,
			},
			getThemeDetails: vi.fn().mockResolvedValue(newThemeDetails),
			persistThemeDetails: vi.fn().mockResolvedValue(undefined),
			updateCachedThumbnail: vi.fn().mockResolvedValue(undefined),
		};
		vi.mocked(SiteServer.get).mockReturnValue(mockServer as unknown as SiteServer);

		await loadThemeDetails(mockIpcMainInvokeEvent, 'test-site-id');

		expect(mockServer.persistThemeDetails).toHaveBeenCalled();
		expect(mockServer.updateCachedThumbnail).toHaveBeenCalled();
	});
});
