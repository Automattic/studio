/**
 * Strips AI provider SDKs that Studio never loads from the bundled CLI's node_modules.
 *
 * Studio's model registry only exposes the Anthropic and OpenAI families
 * (tools/common/ai/models.ts), and @earendil-works/pi-ai loads every other provider
 * lazily via dynamic import (pi-ai/dist/providers/register-builtins.js) — the SDKs are
 * imported only inside provider modules that Studio never reaches, and a missing module
 * degrades gracefully through the lazy loader. The unused providers (Mistral, AWS Bedrock,
 * Google) ship deep, verbose trees: @mistralai/mistralai alone contains ~200-char
 * auto-generated filenames that, nested under pi-coding-agent/node_modules, push paths past
 * Windows' 260-char limit and crash the Squirrel maker. Removing them fixes that and reclaims
 * tens of MB.
 *
 * Removal is keyed on directory name, so it strips both the hoisted copy and any nested
 * duplicates wherever npm placed them in the tree.
 */

import { existsSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';

// Package directories (relative to any node_modules) to remove. Whole AWS/Mistral scopes are
// safe because nothing in the Anthropic/OpenAI path depends on them; @google/genai is named
// specifically to avoid touching unrelated @google/* packages.
const UNUSED_PROVIDER_DIRS = [
	'@mistralai',
	'@aws-sdk',
	'@aws-crypto',
	'@smithy',
	join( '@google', 'genai' ),
];

// Returns the directories that should have been removed but couldn't, so the caller can decide
// how to react (the Forge hook fails the Windows build on any leftover — see pruneUnusedProviders).
function removeTargets( nodeModulesDir: string ): string[] {
	const failed: string[] = [];
	for ( const target of UNUSED_PROVIDER_DIRS ) {
		const dir = join( nodeModulesDir, target );
		try {
			if ( ! statSync( dir ).isDirectory() ) {
				continue;
			}
		} catch {
			continue; // not present in this node_modules
		}
		try {
			rmSync( dir, { recursive: true, force: true } );
			console.log( `Removed ${ target } from ${ nodeModulesDir }` );
		} catch ( e ) {
			// Don't abort here: on a transient lock (Windows AV, permissions) other targets may
			// still be removable, and the caller decides whether a leftover is fatal.
			console.warn(
				`Could not remove ${ target } from ${ nodeModulesDir }: ${
					e instanceof Error ? e.message : String( e )
				}`
			);
			failed.push( dir );
		}
	}
	return failed;
}

/**
 * Walks the dependency tree and prunes the unused providers from every node_modules it finds —
 * the hoisted one and any nested under packages such as pi-coding-agent. Returns the directories
 * that were targeted but couldn't be removed; on Windows a non-empty result is fatal, because a
 * leftover provider tree resurfaces as the very `PathTooLongException` this prune prevents.
 */
export function pruneUnusedProviders( nodeModulesDir: string ): string[] {
	// Most packages have no nested node_modules; recursion bottoms out here. Check existence
	// up front so the common case is a cheap stat rather than a thrown-and-caught ENOENT.
	if ( ! existsSync( nodeModulesDir ) ) {
		return [];
	}

	let entries;
	try {
		entries = readdirSync( nodeModulesDir, { withFileTypes: true } );
	} catch {
		return []; // unreadable (permissions, races) — skip rather than abort packaging
	}

	const failed = removeTargets( nodeModulesDir );

	for ( const entry of entries ) {
		if ( ! entry.isDirectory() ) {
			continue;
		}
		const packageDir = join( nodeModulesDir, entry.name );
		// Scoped packages (@scope/*) nest a level deeper before their own node_modules.
		if ( entry.name.startsWith( '@' ) ) {
			let scopedEntries;
			try {
				scopedEntries = readdirSync( packageDir, { withFileTypes: true } );
			} catch {
				continue;
			}
			for ( const scoped of scopedEntries ) {
				if ( scoped.isDirectory() ) {
					failed.push( ...pruneUnusedProviders( join( packageDir, scoped.name, 'node_modules' ) ) );
				}
			}
			continue;
		}
		failed.push( ...pruneUnusedProviders( join( packageDir, 'node_modules' ) ) );
	}

	return failed;
}
