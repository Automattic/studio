export interface SlashCommandDef {
	name: string;
	description: string;
}

export const AI_CHAT_MODEL_COMMAND = '/model';
export const AI_CHAT_EXIT_COMMAND = '/exit';

export const AI_CHAT_SLASH_COMMANDS: SlashCommandDef[] = [
	{ name: 'model', description: 'Switch the AI model' },
	{ name: 'exit', description: 'Exit the chat' },
];
