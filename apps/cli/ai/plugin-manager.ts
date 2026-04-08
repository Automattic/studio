import { execFile as execFileCb } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { __ } from '@wordpress/i18n';
import { getAppdataDirectory } from 'cli/lib/server-files';

const execFile = promisify( execFileCb );

// --- Types ---

export interface ResolvedPlugins {
	pluginEntries: Array< { type: 'local'; path: string } >;
	mcpServers: Record< string, McpServerConfig >;
}

export interface PluginInfo {
	name: string;
	version: string | null;
	source: 'cloned' | 'linked';
	path: string;
	linkTarget?: string;
}

interface PluginManifest {
	name: string;
	repo: string;
	branch?: string; // Override branch to clone when no release tags exist
}

interface PluginMeta {
	installedVersion: string;
	installedAt: string;
}

interface PluginJson {
	name: string;
	mcp?: {
		command: string;
		args: string[];
	};
}

interface McpServerConfig {
	type?: 'stdio';
	command: string;
	args: string[];
	env?: Record< string, string >;
}

// --- Constants ---

const DEFAULT_PLUGINS: PluginManifest[] = [
	{ name: 'data-liberation', repo: 'Automattic/data-liberation-agent', branch: 'feature/plugin' },
];

const META_FILENAME = '.studio-plugin-meta.json';

// --- Helpers ---

export function getAiPluginsDirectory(): string {
	return path.join( getAppdataDirectory(), 'ai-plugins' );
}

function pluginNameToEnvVar( name: string ): string {
	return `STUDIO_PLUGIN_${ name.replace( /-/g, '_' ).toUpperCase() }_PATH`;
}

function pluginNameToMcpServerName( name: string ): string {
	return name.replace( /-/g, '_' );
}

function parseSemver( tag: string ): { major: number; minor: number; patch: number } | null {
	const match = tag.match( /^v?(\d+)\.(\d+)\.(\d+)$/ );
	if ( ! match ) {
		return null;
	}
	return {
		major: parseInt( match[ 1 ], 10 ),
		minor: parseInt( match[ 2 ], 10 ),
		patch: parseInt( match[ 3 ], 10 ),
	};
}

function compareSemver(
	a: { major: number; minor: number; patch: number },
	b: { major: number; minor: number; patch: number }
): number {
	if ( a.major !== b.major ) {
		return b.major - a.major;
	}
	if ( a.minor !== b.minor ) {
		return b.minor - a.minor;
	}
	return b.patch - a.patch;
}

// --- Plugin Manager ---

export class AiPluginManager {
	async isGitAvailable(): Promise< boolean > {
		try {
			await execFile( 'git', [ '--version' ] );
			return true;
		} catch {
			return false;
		}
	}

	async getLatestReleaseTag( repo: string ): Promise< string | null > {
		try {
			const { stdout } = await execFile( 'git', [
				'ls-remote',
				'--tags',
				`https://github.com/${ repo }.git`,
			] );

			const tags: Array< {
				tag: string;
				semver: { major: number; minor: number; patch: number };
			} > = [];

			for ( const line of stdout.split( '\n' ) ) {
				const match = line.match( /refs\/tags\/(v?\d+\.\d+\.\d+)$/ );
				if ( match ) {
					const semver = parseSemver( match[ 1 ] );
					if ( semver ) {
						tags.push( { tag: match[ 1 ], semver } );
					}
				}
			}

			if ( tags.length === 0 ) {
				return null;
			}

			tags.sort( ( a, b ) => compareSemver( a.semver, b.semver ) );
			return tags[ 0 ].tag;
		} catch {
			return null;
		}
	}

	async install(
		manifest: PluginManifest = DEFAULT_PLUGINS[ 0 ]
	): Promise< { installed: boolean; version?: string; durationMs?: number } > {
		const startTime = Date.now();
		const pluginsDir = getAiPluginsDirectory();
		const pluginDir = path.join( pluginsDir, manifest.name );

		// Check git availability
		if ( ! ( await this.isGitAvailable() ) ) {
			return { installed: false };
		}

		// Check if already installed or linked (lstat doesn't follow symlinks)
		try {
			await fs.lstat( pluginDir );
			return { installed: false };
		} catch {
			// Directory doesn't exist, proceed with install
		}

		const latestTag = await this.getLatestReleaseTag( manifest.repo );

		await fs.mkdir( pluginsDir, { recursive: true } );

		const cloneArgs = [
			'clone',
			'--depth',
			'1',
			`https://github.com/${ manifest.repo }.git`,
			pluginDir,
		];
		const cloneBranch = latestTag ?? manifest.branch;
		if ( cloneBranch ) {
			cloneArgs.splice( 3, 0, '--branch', cloneBranch );
		}
		await execFile( 'git', cloneArgs );

		// npm install + build (cleanup on failure)
		try {
			await execFile( 'npm', [ 'install', '--ignore-scripts' ], {
				cwd: pluginDir,
			} );

			try {
				await execFile( 'npm', [ 'run', 'build' ], { cwd: pluginDir } );
			} catch {
				// Build script may not exist — that's OK
			}
		} catch ( error ) {
			await fs.rm( pluginDir, { recursive: true, force: true } );
			throw error;
		}

		const meta: PluginMeta = {
			installedVersion: latestTag ?? 'unknown',
			installedAt: new Date().toISOString(),
		};
		await fs.writeFile( path.join( pluginDir, META_FILENAME ), JSON.stringify( meta, null, '\t' ) );

		const durationMs = Date.now() - startTime;
		return { installed: true, version: latestTag ?? undefined, durationMs };
	}

	async checkForUpdates(
		manifest: PluginManifest = DEFAULT_PLUGINS[ 0 ]
	): Promise< { available: boolean; currentVersion?: string; latestVersion?: string } > {
		const pluginDir = path.join( getAiPluginsDirectory(), manifest.name );

		// Skip if env override
		const envVar = pluginNameToEnvVar( manifest.name );
		if ( process.env[ envVar ] ) {
			return { available: false };
		}

		// Skip if not installed
		try {
			await fs.access( pluginDir );
		} catch {
			return { available: false };
		}

		// Skip if linked
		try {
			const stat = await fs.lstat( pluginDir );
			if ( stat.isSymbolicLink() ) {
				return { available: false };
			}
		} catch {
			return { available: false };
		}

		// Skip if no git
		const gitAvailable = await this.isGitAvailable();
		if ( ! gitAvailable ) {
			return { available: false };
		}

		// Read current version
		let currentVersion: string | undefined;
		try {
			const metaContent = await fs.readFile( path.join( pluginDir, META_FILENAME ), 'utf-8' );
			const meta: PluginMeta = JSON.parse( metaContent );
			currentVersion = meta.installedVersion;
		} catch {
			return { available: false };
		}

		// Get latest
		const latestTag = await this.getLatestReleaseTag( manifest.repo );
		if ( ! latestTag ) {
			return { available: false, currentVersion };
		}

		const currentSemver = parseSemver( currentVersion ?? '' );
		const latestSemver = parseSemver( latestTag );

		if ( ! currentSemver || ! latestSemver ) {
			return { available: false, currentVersion, latestVersion: latestTag };
		}

		const comparison = compareSemver( currentSemver, latestSemver );
		return {
			available: comparison > 0,
			currentVersion,
			latestVersion: latestTag,
		};
	}

	async update(
		manifest: PluginManifest = DEFAULT_PLUGINS[ 0 ]
	): Promise< { updated: boolean; oldVersion?: string; newVersion?: string; error?: string } > {
		// Git pre-flight check
		const gitAvailable = await this.isGitAvailable();
		if ( ! gitAvailable ) {
			return {
				updated: false,
				error: __( 'Git is required to install AI plugins. Install git and try again.' ),
			};
		}

		const pluginDir = path.join( getAiPluginsDirectory(), manifest.name );

		// Read current version
		let oldVersion: string | undefined;
		try {
			const metaContent = await fs.readFile( path.join( pluginDir, META_FILENAME ), 'utf-8' );
			const meta: PluginMeta = JSON.parse( metaContent );
			oldVersion = meta.installedVersion;
		} catch {
			return { updated: false, error: __( 'Plugin is not installed.' ) };
		}

		// Get latest tag
		const latestTag = await this.getLatestReleaseTag( manifest.repo );
		if ( ! latestTag ) {
			return { updated: false, oldVersion, error: __( 'Could not determine latest version.' ) };
		}

		try {
			// Fetch tags and checkout
			await execFile( 'git', [ 'fetch', '--tags' ], { cwd: pluginDir } );
			await execFile( 'git', [ 'checkout', latestTag ], { cwd: pluginDir } );

			// npm install + build
			await execFile( 'npm', [ 'install', '--ignore-scripts' ], {
				cwd: pluginDir,
			} );
			try {
				await execFile( 'npm', [ 'run', 'build' ], { cwd: pluginDir } );
			} catch {
				// Build script may not exist — that's OK
			}

			// Update meta
			const meta: PluginMeta = {
				installedVersion: latestTag,
				installedAt: new Date().toISOString(),
			};
			await fs.writeFile(
				path.join( pluginDir, META_FILENAME ),
				JSON.stringify( meta, null, '\t' )
			);

			return { updated: true, oldVersion, newVersion: latestTag };
		} catch ( error ) {
			const message = error instanceof Error ? error.message : String( error );
			return { updated: false, oldVersion, error: message };
		}
	}

	async resolvePlugins(): Promise< ResolvedPlugins > {
		const result: ResolvedPlugins = {
			pluginEntries: [],
			mcpServers: {},
		};

		for ( const manifest of DEFAULT_PLUGINS ) {
			const resolved = await this.resolvePlugin( manifest );
			if ( resolved ) {
				result.pluginEntries.push( { type: 'local', path: resolved.path } );
				if ( resolved.mcpServer ) {
					const serverName = pluginNameToMcpServerName( manifest.name );
					result.mcpServers[ serverName ] = resolved.mcpServer;
				}
			}
		}

		return result;
	}

	async getPluginInfo(
		manifest: PluginManifest = DEFAULT_PLUGINS[ 0 ]
	): Promise< PluginInfo | null > {
		const pluginDir = path.join( getAiPluginsDirectory(), manifest.name );

		// Check env override
		const envVar = pluginNameToEnvVar( manifest.name );
		const envPath = process.env[ envVar ];
		if ( envPath ) {
			try {
				await fs.access( envPath );
				return {
					name: manifest.name,
					version: null,
					source: 'linked',
					path: envPath,
				};
			} catch {
				return null;
			}
		}

		// Check if directory exists
		try {
			await fs.access( pluginDir );
		} catch {
			return null;
		}

		// Check if symlink
		const stat = await fs.lstat( pluginDir );
		if ( stat.isSymbolicLink() ) {
			const linkTarget = await fs.readlink( pluginDir );
			return {
				name: manifest.name,
				version: null,
				source: 'linked',
				path: pluginDir,
				linkTarget,
			};
		}

		// Read meta for version
		let version: string | null = null;
		try {
			const metaContent = await fs.readFile( path.join( pluginDir, META_FILENAME ), 'utf-8' );
			const meta: PluginMeta = JSON.parse( metaContent );
			version = meta.installedVersion;
		} catch {
			// No meta file
		}

		return {
			name: manifest.name,
			version,
			source: 'cloned',
			path: pluginDir,
		};
	}

	async linkPlugin( pluginName: string, targetPath: string ): Promise< void > {
		// Validate target is a directory
		const stat = await fs.stat( targetPath );
		if ( ! stat.isDirectory() ) {
			throw new Error( `${ targetPath } is not a directory.` );
		}

		// Validate .claude-plugin/plugin.json exists in target
		const pluginJsonPath = path.join( targetPath, '.claude-plugin', 'plugin.json' );
		try {
			await fs.access( pluginJsonPath );
		} catch {
			throw new Error(
				__(
					'No .claude-plugin/plugin.json found at the target path. Is this a valid Studio AI plugin?'
				)
			);
		}

		const pluginsDir = getAiPluginsDirectory();
		const pluginDir = path.join( pluginsDir, pluginName );

		// Ensure plugins directory exists
		await fs.mkdir( pluginsDir, { recursive: true } );

		// Remove existing if present
		try {
			await fs.rm( pluginDir, { recursive: true, force: true } );
		} catch {
			// Doesn't exist, that's fine
		}

		// Create symlink
		await fs.symlink( targetPath, pluginDir );
	}

	async unlinkPlugin( pluginName: string ): Promise< void > {
		const pluginDir = path.join( getAiPluginsDirectory(), pluginName );

		// Validate it's a symlink
		try {
			const stat = await fs.lstat( pluginDir );
			if ( ! stat.isSymbolicLink() ) {
				throw new Error(
					__( 'Plugin is not linked. Use a different method to remove cloned plugins.' )
				);
			}
		} catch ( error ) {
			if ( error instanceof Error && error.message.includes( 'not linked' ) ) {
				throw error;
			}
			throw new Error( __( 'Plugin is not installed.' ) );
		}

		await fs.unlink( pluginDir );
	}

	/**
	 * Discover slash commands from installed plugins' skills directories.
	 * Reads YAML frontmatter (name + description) from each SKILL.md.
	 */
	async discoverSkillCommands(): Promise< Array< { name: string; description: string } > > {
		const commands: Array< { name: string; description: string } > = [];

		for ( const manifest of DEFAULT_PLUGINS ) {
			const pluginDir = await this.resolvePluginPath( manifest );
			if ( ! pluginDir ) {
				continue;
			}

			const skillsDir = path.join( pluginDir, 'skills' );
			let entries: string[];
			try {
				entries = await fs.readdir( skillsDir );
			} catch {
				continue;
			}

			for ( const entry of entries ) {
				const skillPath = path.join( skillsDir, entry, 'SKILL.md' );
				try {
					const content = await fs.readFile( skillPath, 'utf-8' );
					const frontmatterMatch = content.match( /^---\n([\s\S]*?)\n---/ );
					if ( ! frontmatterMatch ) {
						continue;
					}

					const frontmatter = frontmatterMatch[ 1 ];
					const nameMatch = frontmatter.match( /^name:\s*(.+)$/m );
					const descMatch = frontmatter.match( /^description:\s*(.+)$/m );
					if ( nameMatch && descMatch ) {
						commands.push( {
							name: nameMatch[ 1 ].trim(),
							description: `(${ manifest.name }) ${ descMatch[ 1 ].trim() }`,
						} );
					}
				} catch {
					// Skill file not readable, skip
				}
			}
		}

		return commands;
	}

	/**
	 * Load a skill's full SKILL.md content by name.
	 * Returns the full markdown content (after frontmatter) and plugin metadata, or null if not found.
	 */
	async loadSkillContent(
		skillName: string
	): Promise< { content: string; pluginName: string; mcpPrefix: string } | null > {
		for ( const manifest of DEFAULT_PLUGINS ) {
			const pluginDir = await this.resolvePluginPath( manifest );
			if ( ! pluginDir ) {
				continue;
			}

			const skillPath = path.join( pluginDir, 'skills', skillName, 'SKILL.md' );
			try {
				const content = await fs.readFile( skillPath, 'utf-8' );
				// Strip YAML frontmatter, return the body
				const body = content.replace( /^---\n[\s\S]*?\n---\n*/, '' );
				return {
					content: body.trim(),
					pluginName: manifest.name,
					mcpPrefix: `mcp__${ pluginNameToMcpServerName( manifest.name ) }__`,
				};
			} catch {
				continue;
			}
		}

		return null;
	}


	getDefaultPlugins(): PluginManifest[] {
		return [ ...DEFAULT_PLUGINS ];
	}

	private async resolvePluginPath( manifest: PluginManifest ): Promise< string | null > {
		const envVar = pluginNameToEnvVar( manifest.name );
		const envPath = process.env[ envVar ];
		if ( envPath ) {
			return envPath;
		}

		const pluginDir = path.join( getAiPluginsDirectory(), manifest.name );
		try {
			await fs.access( pluginDir );
		} catch {
			return null;
		}

		const stat = await fs.lstat( pluginDir );
		if ( stat.isSymbolicLink() ) {
			return fs.readlink( pluginDir );
		}

		return pluginDir;
	}

	// --- Private methods ---

	private async resolvePlugin(
		manifest: PluginManifest
	): Promise< { path: string; mcpServer?: McpServerConfig } | null > {
		const pluginDir = path.join( getAiPluginsDirectory(), manifest.name );

		// Check env override first
		const envVar = pluginNameToEnvVar( manifest.name );
		const envPath = process.env[ envVar ];
		if ( envPath ) {
			try {
				await fs.access( envPath );
				return this.loadPluginConfig( envPath, true );
			} catch {
				return null;
			}
		}

		// Check if directory exists
		try {
			await fs.access( pluginDir );
		} catch {
			return null;
		}

		// Follow symlink if needed — linked plugins use source (tsx), not stale dist
		let resolvedPath = pluginDir;
		let isLinked = false;
		try {
			const stat = await fs.lstat( pluginDir );
			if ( stat.isSymbolicLink() ) {
				resolvedPath = await fs.readlink( pluginDir );
				isLinked = true;
			}
		} catch {
			return null;
		}

		return this.loadPluginConfig( resolvedPath, isLinked );
	}

	private async loadPluginConfig(
		pluginPath: string,
		isLinked = false
	): Promise< { path: string; mcpServer?: McpServerConfig } | null > {
		// Try to read plugin.json
		let pluginJson: PluginJson | undefined;
		try {
			const content = await fs.readFile(
				path.join( pluginPath, '.claude-plugin', 'plugin.json' ),
				'utf-8'
			);
			pluginJson = JSON.parse( content );
		} catch {
			// No plugin.json, still return the path
		}

		// Determine MCP server config
		// Linked plugins always use plugin.json's mcp command (tsx from source) to avoid stale dist builds.
		// Cloned plugins prefer compiled dist for faster startup.
		// SDK McpStdioServerConfig has no cwd field, so use absolute paths.
		let mcpServer: McpServerConfig | undefined;
		const pluginEnv = { ...process.env, HOME: process.env.HOME ?? '' };

		if ( ! isLinked ) {
			const distMcpPath = path.join( pluginPath, 'dist', 'mcp-server.js' );
			try {
				await fs.access( distMcpPath );
				mcpServer = {
					command: 'node',
					args: [ distMcpPath ],
					env: pluginEnv,
				};
			} catch {
				// No compiled dist
			}
		}

		if ( ! mcpServer && pluginJson?.mcp ) {
			const resolvedArgs = pluginJson.mcp.args.map( ( arg ) =>
				arg.includes( '/' ) ? path.resolve( pluginPath, arg ) : arg
			);
			mcpServer = {
				command: pluginJson.mcp.command,
				args: resolvedArgs,
				env: pluginEnv,
			};
		}

		return { path: pluginPath, mcpServer };
	}
}
