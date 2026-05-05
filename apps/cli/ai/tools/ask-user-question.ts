import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { AskUserQuestion } from 'cli/ai/agent';

/**
 * Builds an `AskUserQuestion` tool definition.
 *
 * Why this exists separately from Claude's version: on the Anthropic runtime,
 * `AskUserQuestion` is bundled into the `claude_code` SDK preset and isn't
 * exposed as a standalone tool we can import or share. The Anthropic runtime
 * intercepts the preset tool's invocation via `canUseTool` (see
 * `runtimes/anthropic.ts`) and routes to `onAskUser` from there. The OpenAI
 * runtime has no preset to lean on, so we reimplement the same shape here:
 * same tool name (`AskUserQuestion`), same questions/options input schema,
 * same `onAskUser` → `AiChatUI.askUser` → option picker UX. The two
 * implementations are interchangeable from the user's perspective.
 *
 * Why the factory shape: the tool needs the runtime-supplied `onAskUser`
 * callback (which closes over the active `AiChatUI` instance) — same pattern
 * as `wpcom-request.ts`, which closes over a token + siteId.
 *
 * Currently consumed only by the OpenAI runtime; the Anthropic runtime relies
 * on the SDK preset's built-in tool of the same name.
 */
export function createAskUserQuestionTool(
	onAskUser: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >
): SdkMcpToolDefinition {
	const definition = tool(
		'AskUserQuestion',
		'Ask the user 1–4 multiple-choice questions and wait for their answers. Use this whenever you need a clarification, preference, or selection from the user — instead of asking inline in prose. Each question must include 2–4 short option labels with a one-sentence description for each. The system automatically appends a free-form "Other" option, so do NOT add one yourself. Returns a map of question text → selected option label (or the user\'s typed answer if they chose "Other").',
		{
			questions: z
				.array(
					z.object( {
						question: z.string().describe( 'The question to ask the user.' ),
						options: z
							.array(
								z.object( {
									label: z.string().describe( 'Short option label (1-5 words).' ),
									description: z
										.string()
										.describe( 'One-sentence explanation of what this option means.' ),
								} )
							)
							.describe( '2-4 predefined options for the user to choose from.' ),
					} )
				)
				.describe( '1-4 questions to ask in a single batch.' ),
		},
		async ( args ) => {
			const questions: AskUserQuestion[] = args.questions.map( ( q ) => ( {
				question: q.question,
				options: q.options,
				allowFreeForm: true,
			} ) );
			const answers = await onAskUser( questions );
			return {
				content: [ { type: 'text' as const, text: JSON.stringify( answers ) } ],
			};
		}
	);
	return definition as unknown as SdkMcpToolDefinition;
}
