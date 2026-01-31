/**
 * Instruction file types supported by Studio.
 */
export type InstructionFileType = 'claude' | 'agents';

export interface InstructionFileConfig {
	id: InstructionFileType;
	fileName: string;
	displayName: string;
	description: string;
}

/**
 * Configuration for each instruction file type.
 */
export const INSTRUCTION_FILES: Record< InstructionFileType, InstructionFileConfig > = {
	claude: {
		id: 'claude',
		fileName: 'CLAUDE.md',
		displayName: 'CLAUDE.md',
		description: 'Instructions for Claude Code',
	},
	agents: {
		id: 'agents',
		fileName: 'AGENTS.md',
		displayName: 'AGENTS.md',
		description: 'Instructions for Codex, Goose, and other AI agents',
	},
};

/**
 * All instruction file types in display order.
 */
export const INSTRUCTION_FILE_TYPES: InstructionFileType[] = [ 'claude', 'agents' ];

/**
 * Legacy export for backwards compatibility.
 */
export const AGENTS_FILE_NAME = 'AGENTS.md';

export const DEFAULT_AGENT_INSTRUCTIONS = `# Studio Agent Instructions

This project is managed with WordPress Studio.

## Studio CLI
- Command: \`studio\`
- Use \`studio --help\` to see all commands.
- The CLI uses the current directory as the site path (override with \`--path\`).
- Common examples:
  - \`studio site list\`
  - \`studio site status --path "<site path>"\`
  - \`studio site start --path "<site path>"\`
  - \`studio site stop --path "<site path>"\`
  - \`studio site stop --all\`
  - \`studio preview list\`
  - \`studio preview create --path "<site path>"\`
  - \`studio preview update <host> --path "<site path>"\`
  - \`studio preview delete <host>\`
  - \`studio wp --path "<site path>" <wp-cli args>\`
  - \`studio chat\` - Interactive chat with WordPress AI
  - \`studio chat "your message"\` - Single-shot chat message

## Telex CLI
- Command: \`telex\`
- Telex is a sandboxed AI environment for building WordPress assets.
- Use \`telex --help\` to see all commands.

### Generate
- \`telex gen block <name>\` - Generate a new block
- \`telex gen plugin <name>\` - Generate a new plugin
- \`telex gen theme <name>\` - Generate a new theme

### Edit
- \`telex edit block <name>\` - Edit an existing block conversationally
- \`telex edit plugin <name>\` - Edit an existing plugin conversationally
- \`telex edit theme <name>\` - Edit an existing theme conversationally

### Chat
- \`telex chat\` - Start a conversational session for building and editing
- Telex chat understands your project context and can make changes interactively.
`;
