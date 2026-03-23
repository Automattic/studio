export type InstructionFileType = 'agents' | 'claude' | 'studio';

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
	claude: {
		id: 'claude',
		fileName: 'CLAUDE.md',
		displayName: 'CLAUDE.md',
		description: 'Reference for Claude Code to read AGENTS.md',
	},
	studio: {
		id: 'studio',
		fileName: 'STUDIO.md',
		displayName: 'STUDIO.md',
		description: 'Detailed Studio-specific WordPress development instructions',
	},
};

export const INSTRUCTION_FILE_TYPES: InstructionFileType[] = [ 'agents', 'claude', 'studio' ];
