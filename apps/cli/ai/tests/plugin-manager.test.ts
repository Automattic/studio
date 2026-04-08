import { execFile as execFileCb } from 'child_process';
import fs from 'fs/promises';
import { vi } from 'vitest';
import { AiPluginManager, getAiPluginsDirectory } from 'cli/ai/plugin-manager';
import type { Stats } from 'fs';

// --- Mocks ---

vi.mock( 'child_process', () => {
	const execFileMock = vi.fn();
	return {
		default: { execFile: execFileMock },
		execFile: execFileMock,
	};
} );

vi.mock( 'fs/promises', () => ( {
	default: {
		access: vi.fn(),
		lstat: vi.fn(),
		readFile: vi.fn(),
		writeFile: vi.fn(),
		mkdir: vi.fn(),
		rm: vi.fn(),
		symlink: vi.fn(),
		unlink: vi.fn(),
		readlink: vi.fn(),
		stat: vi.fn(),
	},
} ) );

vi.mock( 'cli/lib/server-files', () => ( {
	getAppdataDirectory: () => '/mock/appdata/Studio',
} ) );

vi.mock( '@wordpress/i18n', () => ( {
	__: ( str: string ) => str,
} ) );

const mockedExecFile = vi.mocked( execFileCb );
const mockedFs = vi.mocked( fs );

function mockExecFileSuccess( stdout = '', stderr = '' ) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	( mockedExecFile as any ).mockImplementation(
		(
			_cmd: string,
			_args: string[],
			_opts: unknown,
			callback?: ( ...args: unknown[] ) => void
		) => {
			if ( typeof _opts === 'function' ) {
				callback = _opts as ( ...args: unknown[] ) => void;
			}
			if ( callback ) {
				callback( null, { stdout, stderr } );
			}
		}
	);
}

function mockExecFileFailure( error = new Error( 'command failed' ) ) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	( mockedExecFile as any ).mockImplementation(
		(
			_cmd: string,
			_args: string[],
			_opts: unknown,
			callback?: ( ...args: unknown[] ) => void
		) => {
			if ( typeof _opts === 'function' ) {
				callback = _opts as ( ...args: unknown[] ) => void;
			}
			if ( callback ) {
				callback( error );
			}
		}
	);
}

describe( 'AiPluginManager', () => {
	let manager: AiPluginManager;

	beforeEach( () => {
		vi.resetAllMocks();
		manager = new AiPluginManager();
		// Default: fs.access rejects (file not found)
		mockedFs.access.mockRejectedValue( new Error( 'ENOENT' ) );
		mockedFs.mkdir.mockResolvedValue( undefined );
		mockedFs.writeFile.mockResolvedValue( undefined );
		mockedFs.rm.mockResolvedValue( undefined );
		mockedFs.symlink.mockResolvedValue( undefined );
		mockedFs.unlink.mockResolvedValue( undefined );
		// Clean env
		delete process.env.STUDIO_PLUGIN_DATA_LIBERATION_PATH;
	} );

	describe( 'getAiPluginsDirectory', () => {
		it( 'returns the correct path', () => {
			expect( getAiPluginsDirectory() ).toBe( '/mock/appdata/Studio/ai-plugins' );
		} );
	} );

	describe( 'isGitAvailable', () => {
		it( 'returns true when git is available', async () => {
			mockExecFileSuccess( 'git version 2.40.0' );
			const result = await manager.isGitAvailable();
			expect( result ).toBe( true );
		} );

		it( 'returns false when git is not available', async () => {
			mockExecFileFailure();
			const result = await manager.isGitAvailable();
			expect( result ).toBe( false );
		} );
	} );

	describe( 'getLatestReleaseTag', () => {
		it( 'parses tags and returns the latest semver tag', async () => {
			const lsRemoteOutput = [
				'abc123\trefs/tags/v1.0.0',
				'def456\trefs/tags/v1.1.0',
				'ghi789\trefs/tags/v2.0.0',
				'jkl012\trefs/tags/v1.2.3',
			].join( '\n' );

			mockExecFileSuccess( lsRemoteOutput );
			const result = await manager.getLatestReleaseTag( 'Automattic/data-liberation-agent' );
			expect( result ).toBe( 'v2.0.0' );
		} );

		it( 'handles tags without v prefix', async () => {
			const lsRemoteOutput = [ 'abc123\trefs/tags/1.0.0', 'def456\trefs/tags/2.1.0' ].join( '\n' );

			mockExecFileSuccess( lsRemoteOutput );
			const result = await manager.getLatestReleaseTag( 'Automattic/test-repo' );
			expect( result ).toBe( '2.1.0' );
		} );

		it( 'ignores peeled tags with ^{} suffix', async () => {
			const lsRemoteOutput = [ 'abc123\trefs/tags/v1.0.0', 'def456\trefs/tags/v1.0.0^{}' ].join(
				'\n'
			);

			mockExecFileSuccess( lsRemoteOutput );
			const result = await manager.getLatestReleaseTag( 'Automattic/test-repo' );
			expect( result ).toBe( 'v1.0.0' );
		} );

		it( 'returns null when no tags exist', async () => {
			mockExecFileSuccess( '' );
			const result = await manager.getLatestReleaseTag( 'Automattic/test-repo' );
			expect( result ).toBeNull();
		} );

		it( 'returns null when git command fails', async () => {
			mockExecFileFailure();
			const result = await manager.getLatestReleaseTag( 'Automattic/test-repo' );
			expect( result ).toBeNull();
		} );
	} );

	describe( 'resolvePlugins', () => {
		it( 'returns empty when no plugins are installed', async () => {
			// fs.access rejects by default (not installed)
			const result = await manager.resolvePlugins();
			expect( result.pluginEntries ).toHaveLength( 0 );
			expect( Object.keys( result.mcpServers ) ).toHaveLength( 0 );
		} );

		it( 'resolves an installed plugin with dist MCP server', async () => {
			const pluginDir = '/mock/appdata/Studio/ai-plugins/data-liberation';

			// fs.access succeeds for plugin dir and dist/mcp-server.js
			mockedFs.access.mockImplementation( async ( p ) => {
				const pathStr = String( p );
				if ( pathStr === pluginDir || pathStr === pluginDir + '/dist/mcp-server.js' ) {
					return undefined;
				}
				throw new Error( 'ENOENT' );
			} );

			// lstat: not a symlink
			mockedFs.lstat.mockResolvedValue( {
				isSymbolicLink: () => false,
			} as Stats );

			// No plugin.json
			mockedFs.readFile.mockRejectedValue( new Error( 'ENOENT' ) );

			const result = await manager.resolvePlugins();
			expect( result.pluginEntries ).toHaveLength( 1 );
			expect( result.pluginEntries[ 0 ] ).toEqual( {
				type: 'local',
				path: pluginDir,
			} );
			expect( result.mcpServers.data_liberation.command ).toBe( 'node' );
			expect( result.mcpServers.data_liberation.args[ 0 ] ).toContain( 'dist/mcp-server.js' );
		} );
	} );

	describe( 'getPluginInfo', () => {
		it( 'returns null when plugin is not installed', async () => {
			const result = await manager.getPluginInfo();
			expect( result ).toBeNull();
		} );

		it( 'returns correct info for a cloned plugin', async () => {
			const pluginDir = '/mock/appdata/Studio/ai-plugins/data-liberation';

			mockedFs.access.mockResolvedValue( undefined );
			mockedFs.lstat.mockResolvedValue( {
				isSymbolicLink: () => false,
			} as Stats );
			mockedFs.readFile.mockResolvedValue(
				JSON.stringify( { installedVersion: 'v1.2.0', installedAt: '2026-01-01T00:00:00Z' } )
			);

			const result = await manager.getPluginInfo();
			expect( result ).toEqual( {
				name: 'data-liberation',
				version: 'v1.2.0',
				source: 'cloned',
				path: pluginDir,
			} );
		} );

		it( 'returns correct info for a linked plugin', async () => {
			const pluginDir = '/mock/appdata/Studio/ai-plugins/data-liberation';
			const linkTarget = '/Users/dev/my-plugin';

			mockedFs.access.mockResolvedValue( undefined );
			mockedFs.lstat.mockResolvedValue( {
				isSymbolicLink: () => true,
			} as Stats );
			mockedFs.readlink.mockResolvedValue( linkTarget );

			const result = await manager.getPluginInfo();
			expect( result ).toEqual( {
				name: 'data-liberation',
				version: null,
				source: 'linked',
				path: pluginDir,
				linkTarget,
			} );
		} );

		it( 'returns info from env var override', async () => {
			const envPath = '/custom/plugin/path';
			process.env.STUDIO_PLUGIN_DATA_LIBERATION_PATH = envPath;

			mockedFs.access.mockResolvedValue( undefined );

			const result = await manager.getPluginInfo();
			expect( result ).toEqual( {
				name: 'data-liberation',
				version: null,
				source: 'linked',
				path: envPath,
			} );
		} );
	} );

	describe( 'linkPlugin', () => {
		it( 'throws when .claude-plugin/plugin.json is missing at target path', async () => {
			mockedFs.stat.mockResolvedValue( { isDirectory: () => true } as Stats );
			mockedFs.access.mockRejectedValue( new Error( 'ENOENT' ) );

			await expect( manager.linkPlugin( 'my-plugin', '/some/path' ) ).rejects.toThrow(
				'.claude-plugin/plugin.json'
			);
		} );

		it( 'throws when target is not a directory', async () => {
			mockedFs.stat.mockResolvedValue( { isDirectory: () => false } as Stats );

			await expect( manager.linkPlugin( 'my-plugin', '/some/file' ) ).rejects.toThrow(
				'is not a directory'
			);
		} );

		it( 'creates symlink when .claude-plugin/plugin.json exists', async () => {
			mockedFs.stat.mockResolvedValue( { isDirectory: () => true } as Stats );
			mockedFs.access.mockResolvedValue( undefined );

			await manager.linkPlugin( 'my-plugin', '/some/path' );

			expect( mockedFs.symlink ).toHaveBeenCalledWith(
				'/some/path',
				'/mock/appdata/Studio/ai-plugins/my-plugin'
			);
		} );
	} );

	describe( 'unlinkPlugin', () => {
		it( 'throws when the plugin is not a symlink', async () => {
			mockedFs.lstat.mockResolvedValue( {
				isSymbolicLink: () => false,
			} as Stats );

			await expect( manager.unlinkPlugin( 'my-plugin' ) ).rejects.toThrow( 'not linked' );
		} );

		it( 'throws when the plugin is not installed', async () => {
			mockedFs.lstat.mockRejectedValue( new Error( 'ENOENT' ) );

			await expect( manager.unlinkPlugin( 'my-plugin' ) ).rejects.toThrow( 'not installed' );
		} );

		it( 'removes the symlink', async () => {
			mockedFs.lstat.mockResolvedValue( {
				isSymbolicLink: () => true,
			} as Stats );

			await manager.unlinkPlugin( 'my-plugin' );

			expect( mockedFs.unlink ).toHaveBeenCalledWith( '/mock/appdata/Studio/ai-plugins/my-plugin' );
		} );
	} );

	describe( 'getDefaultPlugins', () => {
		it( 'returns a copy of the default plugins array', () => {
			const plugins = manager.getDefaultPlugins();
			expect( plugins ).toEqual( [
				{ name: 'data-liberation', repo: 'Automattic/data-liberation-agent', branch: 'feature/plugin' },
			] );
			// Ensure it's a copy
			plugins.push( { name: 'test', repo: 'test/test' } );
			expect( manager.getDefaultPlugins() ).toHaveLength( 1 );
		} );
	} );

	describe( 'install', () => {
		it( 'returns not installed when git is not available', async () => {
			mockExecFileFailure();
			const result = await manager.install();
			expect( result.installed ).toBe( false );
		} );

		it( 'returns not installed when plugin directory already exists', async () => {
			// First call: git --version succeeds
			// Then fs.access succeeds (directory exists)
			mockExecFileSuccess( 'git version 2.40.0' );
			mockedFs.access.mockResolvedValue( undefined );

			const result = await manager.install();
			expect( result.installed ).toBe( false );
		} );
	} );

	describe( 'checkForUpdates', () => {
		it( 'returns not available when env override is set', async () => {
			process.env.STUDIO_PLUGIN_DATA_LIBERATION_PATH = '/custom/path';
			const result = await manager.checkForUpdates();
			expect( result.available ).toBe( false );
		} );

		it( 'returns not available when plugin is not installed', async () => {
			const result = await manager.checkForUpdates();
			expect( result.available ).toBe( false );
		} );
	} );
} );
