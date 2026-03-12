import { AI_INSTRUCTIONS_MANIFEST } from '@studio/common/ai-instructions';

export type InstructionFileType = 'agents' | 'studio';

export interface InstructionFileConfig {
	id: InstructionFileType;
	fileName: string;
	displayName: string;
	description: string;
}

export const INSTRUCTION_FILES: Record< InstructionFileType, InstructionFileConfig > = {
	agents: {
		id: 'agents',
		fileName: 'AGENTS.md',
		displayName: 'AGENTS.md',
		description: 'Instructions for Codex, Goose, and other AI agents',
	},
	studio: {
		id: 'studio',
		fileName: 'STUDIO.md',
		displayName: 'STUDIO.md',
		description: 'Detailed Studio-specific WordPress development instructions',
	},
};

export const INSTRUCTION_FILE_TYPES: InstructionFileType[] = [ 'agents', 'studio' ];

/**
 * Template version - increment when making significant changes to instructions.
 * Format: YYYYMMDD.revision (e.g., 20250312.1)
 */
export const AGENT_INSTRUCTIONS_VERSION = AI_INSTRUCTIONS_MANIFEST.version;

/**
 * Versioned content for each instruction file, keyed by file type.
 */
export const DEFAULT_INSTRUCTIONS_MAP: Record< InstructionFileType, string > = {
	agents: `<!-- Studio Instructions Version: ${ AGENT_INSTRUCTIONS_VERSION } -->\n${
		AI_INSTRUCTIONS_MANIFEST.instructions.find( ( f ) => f.id === 'agents' )!.content
	}`,
	studio: `<!-- Studio Instructions Version: ${ AGENT_INSTRUCTIONS_VERSION } -->\n${
		AI_INSTRUCTIONS_MANIFEST.instructions.find( ( f ) => f.id === 'studio' )!.content
	}`,
};

/**
 * Backward compatibility: the AGENTS.md file content with version header.
 */
export const DEFAULT_AGENT_INSTRUCTIONS = DEFAULT_INSTRUCTIONS_MAP.agents;
