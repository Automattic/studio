// Mirror of HeadlessEvent from CLI — keep in sync with apps/cli/ai/headless-types.ts
export type StudioCodeEvent =
	| { type: 'ready'; providers: string[]; model: string }
	| { type: 'text_delta'; text: string }
	| { type: 'text_complete' }
	| { type: 'tool_use_start'; id: string; name: string; input: Record< string, unknown > }
	| { type: 'tool_result'; id: string; name: string; output: string; isError: boolean }
	| {
			type: 'permission_request';
			id: string;
			toolName: string;
			input: Record< string, unknown >;
			description: string;
	  }
	| { type: 'turn_complete'; turnCount: number; cost: number; sessionId: string }
	| { type: 'error'; message: string; code?: string }
	| { type: 'slash_commands'; commands: { name: string; description: string }[] };

// Mirror of HeadlessCommand from CLI
export type StudioCodeCommand =
	| { type: 'message'; text: string }
	| { type: 'permission_response'; id: string; allowed: boolean }
	| { type: 'cancel' }
	| { type: 'slash_command'; command: string; args?: string };

export type AiEngine = 'studio-code' | 'wpcom-assistant';
