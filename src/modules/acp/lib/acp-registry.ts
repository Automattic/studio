/**
 * ACP Registry Client
 *
 * Fetches and caches the official ACP agent registry from:
 * https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json
 */

import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Distribution types for ACP agents.
 */
export interface NpxDistribution {
	package: string;
	args?: string[];
	env?: Record< string, string >;
}

export interface BinaryTarget {
	archive: string;
	cmd: string;
	args?: string[];
	env?: Record< string, string >;
}

export interface BinaryDistribution {
	'darwin-aarch64'?: BinaryTarget;
	'darwin-arm64'?: BinaryTarget;
	'darwin-x86_64'?: BinaryTarget;
	'darwin-x64'?: BinaryTarget;
	'linux-aarch64'?: BinaryTarget;
	'linux-arm64'?: BinaryTarget;
	'linux-x86_64'?: BinaryTarget;
	'linux-x64'?: BinaryTarget;
	'windows-aarch64'?: BinaryTarget;
	'windows-arm64'?: BinaryTarget;
	'windows-x86_64'?: BinaryTarget;
	'windows-x64'?: BinaryTarget;
}

export interface AgentDistribution {
	npx?: NpxDistribution;
	binary?: BinaryDistribution;
}

/**
 * Agent entry from the ACP registry.
 */
export interface RegistryAgent {
	id: string;
	name: string;
	version: string;
	description: string;
	repository?: string;
	authors: string[];
	license: string;
	icon?: string;
	distribution: AgentDistribution;
}

/**
 * The full ACP registry structure.
 */
export interface AcpRegistry {
	version: string;
	agents: RegistryAgent[];
	extensions: unknown[];
}

/**
 * Cached registry with timestamp.
 */
interface CachedRegistry {
	fetchedAt: number;
	registry: AcpRegistry;
}

// In-memory cache
let registryCache: CachedRegistry | null = null;

/**
 * Get the cache file path.
 */
function getCacheFilePath(): string {
	const userDataPath = app.getPath( 'userData' );
	return path.join( userDataPath, 'acp-registry-cache.json' );
}

/**
 * Load registry from disk cache.
 */
async function loadFromDiskCache(): Promise< CachedRegistry | null > {
	try {
		const cacheFile = getCacheFilePath();
		const data = await fs.readFile( cacheFile, 'utf-8' );
		return JSON.parse( data ) as CachedRegistry;
	} catch {
		return null;
	}
}

/**
 * Save registry to disk cache.
 */
async function saveToDiskCache( cached: CachedRegistry ): Promise< void > {
	try {
		const cacheFile = getCacheFilePath();
		await fs.writeFile( cacheFile, JSON.stringify( cached, null, 2 ) );
	} catch ( error ) {
		console.warn( 'Failed to save ACP registry cache:', error );
	}
}

/**
 * Fetch the registry from the CDN.
 */
async function fetchRegistry(): Promise< AcpRegistry > {
	const response = await fetch( REGISTRY_URL, {
		headers: {
			Accept: 'application/json',
			'User-Agent': 'WordPress-Studio/1.0',
		},
	} );

	if ( ! response.ok ) {
		throw new Error(
			`Failed to fetch ACP registry: ${ response.status } ${ response.statusText }`
		);
	}

	return ( await response.json() ) as AcpRegistry;
}

/**
 * Get the ACP registry, using cache if available and fresh.
 */
export async function getAcpRegistry(): Promise< AcpRegistry > {
	const now = Date.now();

	// Check in-memory cache first
	if ( registryCache && now - registryCache.fetchedAt < CACHE_TTL_MS ) {
		return registryCache.registry;
	}

	// Check disk cache
	const diskCache = await loadFromDiskCache();
	if ( diskCache && now - diskCache.fetchedAt < CACHE_TTL_MS ) {
		registryCache = diskCache;
		return diskCache.registry;
	}

	// Fetch fresh registry
	try {
		const registry = await fetchRegistry();
		const cached: CachedRegistry = {
			fetchedAt: now,
			registry,
		};

		registryCache = cached;
		await saveToDiskCache( cached );

		return registry;
	} catch ( error ) {
		// If fetch fails but we have stale cache, use it
		if ( diskCache ) {
			console.warn( 'Using stale ACP registry cache due to fetch error:', error );
			registryCache = diskCache;
			return diskCache.registry;
		}

		throw error;
	}
}

/**
 * Get the current platform key for binary distributions.
 */
export function getPlatformKey(): keyof BinaryDistribution | null {
	const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';

	switch ( process.platform ) {
		case 'darwin':
			return `darwin-${ arch }` as keyof BinaryDistribution;
		case 'linux':
			return `linux-${ arch }` as keyof BinaryDistribution;
		case 'win32':
			return `windows-${ arch }` as keyof BinaryDistribution;
		default:
			return null;
	}
}

function getPlatformKeys(): Array< keyof BinaryDistribution > {
	const keys: Array< keyof BinaryDistribution > = [];
	const isArm = process.arch === 'arm64';

	if ( process.platform === 'darwin' ) {
		keys.push( isArm ? 'darwin-aarch64' : 'darwin-x86_64' );
		keys.push( isArm ? 'darwin-arm64' : 'darwin-x64' );
	}

	if ( process.platform === 'linux' ) {
		keys.push( isArm ? 'linux-aarch64' : 'linux-x86_64' );
		keys.push( isArm ? 'linux-arm64' : 'linux-x64' );
	}

	if ( process.platform === 'win32' ) {
		keys.push( isArm ? 'windows-aarch64' : 'windows-x86_64' );
		keys.push( isArm ? 'windows-arm64' : 'windows-x64' );
	}

	return keys;
}

/**
 * Get the command and args to run an agent.
 *
 * Returns null if the agent can't be run on this platform.
 */
export function getAgentCommand(
	agent: RegistryAgent
): { command: string; args: string[]; env?: Record< string, string > } | null {
	const { distribution } = agent;

	// Prefer npx distribution (more portable)
	if ( distribution.npx ) {
		return {
			command: 'npx',
			// Use --yes to auto-accept package installation (avoids "Ok to proceed?" prompt)
			// Use --quiet to suppress npx's own output (spinners, install messages)
			args: [ '--yes', '--quiet', distribution.npx.package, ...( distribution.npx.args ?? [] ) ],
			env: distribution.npx.env,
		};
	}

	// Fall back to binary distribution
	if ( distribution.binary ) {
		const platformKeys = getPlatformKeys();
		if ( platformKeys.length === 0 ) {
			return null;
		}

		const target = platformKeys.map( ( key ) => distribution.binary?.[ key ] ).find( Boolean );
		if ( ! target ) {
			return null;
		}

		// For now, assume the binary is installed and in PATH
		// TODO: Implement binary download and management
		const binaryName = path.basename( target.cmd ).replace( /^\.\//, '' );

		return {
			command: binaryName,
			args: target.args ?? [],
			env: target.env,
		};
	}

	return null;
}

/**
 * Force refresh the registry cache.
 */
export async function refreshRegistry(): Promise< AcpRegistry > {
	registryCache = null;

	try {
		await fs.unlink( getCacheFilePath() );
	} catch {
		// Ignore if file doesn't exist
	}

	return getAcpRegistry();
}

/**
 * Get a specific agent by ID from the registry.
 */
export async function getRegistryAgent( agentId: string ): Promise< RegistryAgent | null > {
	const registry = await getAcpRegistry();
	return registry.agents.find( ( a ) => a.id === agentId ) ?? null;
}
