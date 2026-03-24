import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AutocompleteItem } from '@mariozechner/pi-tui';
import type { AiProviderId } from 'cli/ai/providers';

const CLAUDE_CODE_PLUGIN_PROVIDERS: AiProviderId[] = [ 'anthropic-claude', 'anthropic-api-key' ];

export function isClaudeCodePluginProvider( provider?: AiProviderId ): boolean {
	return provider !== undefined && CLAUDE_CODE_PLUGIN_PROVIDERS.includes( provider );
}

interface InstalledPluginEntry {
	scope: string;
	installPath: string;
}

interface InstalledPluginsManifest {
	version: number;
	plugins: Record< string, InstalledPluginEntry[] >;
}

function readInstalledPlugins(): InstalledPluginEntry[] {
	const manifestPath = path.join( os.homedir(), '.claude', 'plugins', 'installed_plugins.json' );
	try {
		const content = fs.readFileSync( manifestPath, 'utf8' );
		const manifest: InstalledPluginsManifest = JSON.parse( content );
		const entries: InstalledPluginEntry[] = [];

		for ( const pluginEntries of Object.values( manifest.plugins ) ) {
			for ( const entry of pluginEntries ) {
				if ( entry.installPath && fs.existsSync( entry.installPath ) ) {
					entries.push( entry );
				}
			}
		}

		return entries;
	} catch {
		return [];
	}
}

export function getClaudeCodePlugins(): Array< { type: 'local'; path: string } > {
	return readInstalledPlugins().map( ( entry ) => ( {
		type: 'local' as const,
		path: entry.installPath,
	} ) );
}

function parseFrontmatter( content: string ): { name?: string; description?: string } {
	const match = content.match( /^---\s*\n([\s\S]*?)\n---/ );
	if ( ! match ) {
		return {};
	}

	const frontmatter = match[ 1 ];
	const nameMatch = frontmatter.match( /^name:\s*["']?([^"'\n]+)["']?\s*$/m );
	const descMatch = frontmatter.match( /^description:\s*["']?([^"'\n]+)["']?\s*$/m );

	return {
		name: nameMatch?.[ 1 ]?.trim(),
		description: descMatch?.[ 1 ]?.trim(),
	};
}

function readPluginName( pluginPath: string ): string | undefined {
	const pluginJsonPath = path.join( pluginPath, '.claude-plugin', 'plugin.json' );
	try {
		const content = fs.readFileSync( pluginJsonPath, 'utf8' );
		const json = JSON.parse( content );
		return typeof json.name === 'string' ? json.name : undefined;
	} catch {
		return undefined;
	}
}

function scanSkills( pluginPath: string, pluginName: string ): AutocompleteItem[] {
	const skillsDir = path.join( pluginPath, 'skills' );
	const items: AutocompleteItem[] = [];

	let skillDirs: string[];
	try {
		skillDirs = fs.readdirSync( skillsDir );
	} catch {
		return items;
	}

	for ( const skillDir of skillDirs ) {
		const skillPath = path.join( skillsDir, skillDir, 'SKILL.md' );
		try {
			const content = fs.readFileSync( skillPath, 'utf8' );
			const { name, description } = parseFrontmatter( content );
			if ( name ) {
				items.push( {
					value: `${ pluginName }:${ name }`,
					label: name,
					description: `(${ pluginName }) ${ description ?? '' }`.trim(),
				} );
			}
		} catch {
			// Skip unreadable skills
		}
	}

	return items;
}

function scanMarkdownDir(
	pluginPath: string,
	dirName: string,
	pluginName: string
): AutocompleteItem[] {
	const dir = path.join( pluginPath, dirName );
	const items: AutocompleteItem[] = [];

	let files: string[];
	try {
		files = fs.readdirSync( dir ).filter( ( f ) => f.endsWith( '.md' ) );
	} catch {
		return items;
	}

	for ( const file of files ) {
		const filePath = path.join( dir, file );
		try {
			const content = fs.readFileSync( filePath, 'utf8' );
			const { name, description } = parseFrontmatter( content );
			const baseName = name ?? path.basename( file, '.md' );
			items.push( {
				value: `${ pluginName }:${ baseName }`,
				label: `${ pluginName }:${ baseName }`,
				description: description ?? '',
			} );
		} catch {
			// Skip unreadable files
		}
	}

	return items;
}

export function getClaudeCodeSkillCommands(): AutocompleteItem[] {
	const entries = readInstalledPlugins();
	const items: AutocompleteItem[] = [];

	for ( const entry of entries ) {
		const pluginName = readPluginName( entry.installPath );
		if ( ! pluginName ) {
			continue;
		}

		items.push(
			...scanSkills( entry.installPath, pluginName ),
			...scanMarkdownDir( entry.installPath, 'commands', pluginName ),
			...scanMarkdownDir( entry.installPath, 'agents', pluginName )
		);
	}

	return items;
}
