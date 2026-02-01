/**
 * Agent Detection
 *
 * Detects available ACP agents using the official registry and checking system PATH.
 */

import { exec } from 'child_process';
import fs from 'fs';
import nodePath from 'path';
import { promisify } from 'util';
import { getResourcesPath } from 'src/storage/paths';
import { BUILTIN_AGENTS } from '../config/agents';
import { getAcpRegistry, getAgentCommand, type RegistryAgent } from './acp-registry';
import type { AgentConfig, AgentStatus } from '../types';

const execAsync = promisify( exec );

function getNvmBinPaths( home: string ): string[] {
	const paths: string[] = [];
	const nvmDir = process.env.NVM_DIR ?? nodePath.join( home, '.nvm' );
	const versionsDir = nodePath.join( nvmDir, 'versions', 'node' );

	if ( process.env.NVM_BIN ) {
		paths.push( process.env.NVM_BIN );
	}

	try {
		if ( fs.existsSync( versionsDir ) ) {
			const entries = fs.readdirSync( versionsDir, { withFileTypes: true } );
			for ( const entry of entries ) {
				if ( ! entry.isDirectory() ) {
					continue;
				}
				paths.push( nodePath.join( versionsDir, entry.name, 'bin' ) );
			}
		}
	} catch {
		// Ignore filesystem errors and fall back to default paths
	}

	return paths;
}

function getSupplementalPaths( home: string ): string[] {
	const pnpmHome = process.env.PNPM_HOME ?? nodePath.join( home, '.local', 'share', 'pnpm' );
	return [
		nodePath.join( home, '.asdf', 'bin' ),
		nodePath.join( home, '.asdf', 'shims' ),
		pnpmHome,
		nodePath.join( home, '.pnpm' ),
		nodePath.join( home, '.bun', 'bin' ),
		nodePath.join( home, '.deno', 'bin' ),
	];
}

/**
 * Get the Studio bin directory path.
 * This contains stub scripts like the telex CLI stub.
 */
function getStudioBinPath(): string {
	try {
		const resourcesPath = getResourcesPath();
		return nodePath.join( resourcesPath, 'bin' );
	} catch {
		// In child processes or tests, fall back to the development bin directory
		return nodePath.join( __dirname, '..', '..', '..', '..', 'bin' );
	}
}

/**
 * Get the augmented PATH for agent detection.
 * On macOS/Linux, GUI apps don't inherit shell PATH, so we add common paths.
 */
function getAugmentedPath(): string {
	const basePath = process.env.PATH ?? '';
	const home = process.env.HOME ?? '';
	const studioBinPath = getStudioBinPath();

	if ( process.platform === 'darwin' ) {
		const additionalPaths = [
			studioBinPath, // Studio bin directory with stub scripts (highest priority)
			'/usr/local/bin',
			'/opt/homebrew/bin',
			'/opt/local/bin',
			`${ home }/.local/bin`,
			`${ home }/.npm-global/bin`,
			`${ home }/.cargo/bin`,
			`${ home }/go/bin`,
			// Common Node.js version managers
			`${ home }/.volta/bin`,
			`${ home }/.fnm/current/bin`,
			...getNvmBinPaths( home ),
			...getSupplementalPaths( home ),
		];
		return `${ additionalPaths.join( ':' ) }:${ basePath }`;
	}

	if ( process.platform === 'linux' ) {
		const additionalPaths = [
			studioBinPath, // Studio bin directory with stub scripts (highest priority)
			'/usr/local/bin',
			`${ home }/.local/bin`,
			`${ home }/.npm-global/bin`,
			`${ home }/.cargo/bin`,
			`${ home }/go/bin`,
			// Common Node.js version managers
			`${ home }/.volta/bin`,
			`${ home }/.fnm/current/bin`,
			...getNvmBinPaths( home ),
			...getSupplementalPaths( home ),
		];
		return `${ additionalPaths.join( ':' ) }:${ basePath }`;
	}

	if ( process.platform === 'win32' ) {
		// Windows uses semicolon as PATH separator
		return `${ studioBinPath };${ basePath }`;
	}

	return basePath;
}

/**
 * Check if a command exists in the system PATH.
 */
async function commandExists( command: string ): Promise< boolean > {
	try {
		const checkCommand = process.platform === 'win32' ? `where ${ command }` : `which ${ command }`;

		await execAsync( checkCommand, {
			timeout: 5000,
			env: {
				...process.env,
				PATH: getAugmentedPath(),
			},
		} );

		return true;
	} catch {
		return false;
	}
}

// Cache npx availability check
let npxAvailable: boolean | null = null;

/**
 * Check if npx is available (for agents distributed via npm packages).
 */
async function isNpxAvailable(): Promise< boolean > {
	if ( npxAvailable !== null ) {
		return npxAvailable;
	}
	npxAvailable = await commandExists( 'npx' );
	return npxAvailable;
}

/**
 * Convert a registry agent to our AgentConfig format.
 */
function registryAgentToConfig(
	agent: RegistryAgent,
	options: {
		isInstalled: boolean;
		isAvailable: boolean;
		commandInfoOverride?: {
			command: string;
			args: string[];
			env?: Record< string, string >;
		} | null;
	}
): AgentConfig {
	const commandInfo = options.commandInfoOverride ?? getAgentCommand( agent );

	return {
		id: agent.id,
		name: agent.name,
		description: agent.description,
		provider: 'acp',
		icon: agent.icon,
		command: commandInfo?.command,
		args: commandInfo?.args,
		env: commandInfo?.env,
		isInstalled: options.isInstalled,
		status: options.isAvailable ? 'available' : 'unavailable',
		// Note: codex-acp is the ACP wrapper and uses standard stdio, not TTY.
		// Only the interactive codex CLI needs TTY, but we don't use that directly.
		requiresTty: false,
	};
}

/**
 * Alternative binary commands for agents (by agent ID).
 * These are checked first before falling back to npx.
 *
 * Note: Do NOT include standard CLI tools as alternatives for ACP adapters.
 * For example, `codex` (OpenAI CLI) does NOT speak ACP - you need `codex-acp`
 * or `npx @zed-industries/codex-acp`. Same for `claude` vs `claude-code-acp`.
 */
const ALTERNATIVE_BINARIES: Record< string, string[] > = {
	'factory-droid': [ 'factory-droid', 'droid' ],
	'codex-acp': [ 'codex-acp' ],
	'claude-code-acp': [ 'claude-code-acp' ],
	opencode: [ 'opencode' ],
};

/**
 * Required arguments for specific agents.
 * Some agents need subcommands to start the ACP server.
 */
const AGENT_ARGS: Record< string, string[] > = {
	opencode: [ 'acp' ],
};

/**
 * NPX package fallbacks for agents where the registry only lists binary distribution
 * but an npm package also exists.
 */
const NPX_PACKAGE_FALLBACKS: Record< string, string > = {
	'codex-acp': '@zed-industries/codex-acp',
};

/**
 * Detect if a registry agent is available on this system.
 */
async function detectRegistryAgent( agent: RegistryAgent ): Promise< AgentConfig > {
	const commandInfo = getAgentCommand( agent );
	const npxFallback = NPX_PACKAGE_FALLBACKS[ agent.id ];

	// If no distribution and no npx fallback, agent is unavailable
	if ( ! commandInfo && ! npxFallback ) {
		return registryAgentToConfig( agent, { isInstalled: false, isAvailable: false } );
	}

	let isInstalled = false;
	let isAvailable = false;
	let resolvedCommandInfo = commandInfo ?? {
		command: 'npx',
		args: [ '--yes', '--quiet', npxFallback! ],
		env: {},
	};

	// First, check if there's a locally installed binary (preferred over npx)
	const alternativeBinaries = ALTERNATIVE_BINARIES[ agent.id ] ?? [];
	for ( const cmd of alternativeBinaries ) {
		if ( await commandExists( cmd ) ) {
			isInstalled = true;
			isAvailable = true;
			// Use the local binary instead of npx
			resolvedCommandInfo = {
				command: cmd,
				args: AGENT_ARGS[ agent.id ] ?? [],
				env: commandInfo?.env,
			};
			break;
		}
	}

	// If no local binary found, check npx fallback
	if ( ! isInstalled ) {
		const isNpxBased = resolvedCommandInfo.command === 'npx';
		if ( isNpxBased ) {
			isAvailable = await isNpxAvailable();
		} else {
			// Binary-based agent - check if binary exists
			if ( await commandExists( resolvedCommandInfo.command ) ) {
				isInstalled = true;
				isAvailable = true;
			} else if ( npxFallback ) {
				// Binary not found, try npx fallback
				if ( await isNpxAvailable() ) {
					isAvailable = true;
					resolvedCommandInfo = {
						command: 'npx',
						args: [ '--yes', '--quiet', npxFallback ],
						env: commandInfo?.env,
					};
				}
			}
		}
	}

	return registryAgentToConfig( agent, {
		isInstalled,
		isAvailable,
		commandInfoOverride: resolvedCommandInfo,
	} );
}

// Temporary filter: only show these agents (comment out others for now)
const ENABLED_AGENT_IDS = [
	'wpcom', // WordPress AI
	'anthropic-builtin', // Built-in Assistant
	'claude-code-acp', // Claude Code
	'opencode', // OpenCode
	'codex-acp', // Codex
];

/**
 * Detect all available ACP agents.
 *
 * Combines built-in agents with agents from the ACP registry.
 */
export async function detectInstalledAgents(): Promise< AgentConfig[] > {
	// Start with built-in agents (always available)
	// Filter to only enabled agents
	const agents: AgentConfig[] = BUILTIN_AGENTS.filter( ( agent ) =>
		ENABLED_AGENT_IDS.includes( agent.id )
	);

	try {
		// Fetch registry and detect each agent
		const registry = await getAcpRegistry();
		// Filter to only enabled ACP agents
		const enabledRegistryAgents = registry.agents.filter( ( agent ) =>
			ENABLED_AGENT_IDS.includes( agent.id )
		);
		const detectionPromises = enabledRegistryAgents.map( detectRegistryAgent );
		const detectedAgents = await Promise.all( detectionPromises );

		agents.push( ...detectedAgents );
	} catch ( error ) {
		console.error( 'Failed to fetch ACP registry:', error );
		// Continue with just built-in agents if registry fetch fails
	}

	return agents;
}

/**
 * Detect a specific agent by ID.
 */
export async function detectAgentById( agentId: string ): Promise< AgentConfig | null > {
	// Check built-in agents first
	const builtinAgent = BUILTIN_AGENTS.find( ( a ) => a.id === agentId );
	if ( builtinAgent ) {
		return {
			...builtinAgent,
			isInstalled: true,
			status: 'available',
		};
	}

	// Check registry
	try {
		const registry = await getAcpRegistry();
		const registryAgent = registry.agents.find( ( a ) => a.id === agentId );

		if ( registryAgent ) {
			return detectRegistryAgent( registryAgent );
		}
	} catch ( error ) {
		console.error( 'Failed to detect agent from registry:', error );
	}

	return null;
}

/**
 * Get the status of all agents.
 */
export async function getAgentStatusDict(): Promise< Record< string, AgentStatus > > {
	const agents = await detectInstalledAgents();

	const statusDict: Record< string, AgentStatus > = {};

	for ( const agent of agents ) {
		statusDict[ agent.id ] = agent.status ?? 'unavailable';
	}

	return statusDict;
}

/**
 * Refresh agent detection.
 */
export async function refreshAgentDetection(): Promise< AgentConfig[] > {
	// Reset npx cache
	npxAvailable = null;
	return detectInstalledAgents();
}

/**
 * Export the augmented PATH for use by the process manager.
 */
export { getAugmentedPath };
