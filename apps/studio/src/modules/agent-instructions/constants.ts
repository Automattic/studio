import { AGENTS_MD_FILE_NAME, AGENTS_MD_TEMPLATE } from '@studio/common/lib/agents-md';

export type InstructionFileType = 'agents';

export interface InstructionFileConfig {
	id: InstructionFileType;
	fileName: string;
	displayName: string;
	description: string;
}

export const INSTRUCTION_FILES: Record< InstructionFileType, InstructionFileConfig > = {
	agents: {
		id: 'agents',
		fileName: AGENTS_MD_FILE_NAME,
		displayName: AGENTS_MD_FILE_NAME,
		description: 'Instructions for Codex, Goose, and other AI agents',
	},
};

export const INSTRUCTION_FILE_TYPES: InstructionFileType[] = [ 'agents' ];

/**
 * Template version - increment when making significant changes to instructions.
 * Format: YYYYMMDD.revision (e.g., 20250131.1)
 */
export const AGENT_INSTRUCTIONS_VERSION = '20250131.1';

export const DEFAULT_AGENT_INSTRUCTIONS = `<!-- Studio Instructions Version: ${ AGENT_INSTRUCTIONS_VERSION } -->\n${ AGENTS_MD_TEMPLATE }`;
