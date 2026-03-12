// Content is inlined at build time by Vite's ?raw imports
import agentsMdContent from './AGENTS.md?raw';
import studioMdContent from './STUDIO.md?raw';
import studioCliSkillContent from './skills/studio-cli.md?raw';

export interface AiInstructionFile {
	id: string;
	fileName: string;
	displayName: string;
	description: string;
	/** Where this file gets installed relative to the site root */
	installPath: string;
	/** The markdown content, inlined at build time */
	content: string;
}

export interface AiSkillEntry {
	id: string;
	name: string;
	description: string;
	/** "local" = bundled in this folder, "remote" = fetched from URL */
	source: 'local' | 'remote';
	/** For local: relative path within this folder. For remote: URL */
	location: string;
	/** Where this gets installed relative to site root */
	installPath: string;
	/** The skill content, inlined at build time for local skills */
	content: string;
}

export interface AiInstructionsManifest {
	version: string;
	instructions: AiInstructionFile[];
	skills: AiSkillEntry[];
}

export const AI_INSTRUCTIONS_MANIFEST: AiInstructionsManifest = {
	version: '20250312.1',
	instructions: [
		{
			id: 'agents',
			fileName: 'AGENTS.md',
			displayName: 'AGENTS.md',
			description: 'Instructions for Codex, Goose, and other AI agents',
			installPath: 'AGENTS.md',
			content: agentsMdContent,
		},
		{
			id: 'studio',
			fileName: 'STUDIO.md',
			displayName: 'STUDIO.md',
			description: 'Detailed Studio-specific WordPress development instructions',
			installPath: 'STUDIO.md',
			content: studioMdContent,
		},
	],
	skills: [
		{
			id: 'studio-cli',
			name: 'studio-cli',
			description:
				'Use the Studio CLI to manage local WordPress sites, authentication, and preview sites.',
			source: 'local',
			location: 'skills/studio-cli.md',
			installPath: '.agents/skills/studio-cli/SKILL.md',
			content: studioCliSkillContent,
		},
		// Example remote skill (future):
		// {
		// 	id: 'wp-block-development',
		// 	name: 'wp-block-development',
		// 	description: 'WordPress block development patterns',
		// 	source: 'remote',
		// 	location: 'https://github.com/WordPress/agent-skills/blob/main/skills/block-development.md',
		// 	installPath: '.agents/skills/wp-block-development/SKILL.md',
		// 	content: '',
		// },
	],
};
