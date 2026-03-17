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
