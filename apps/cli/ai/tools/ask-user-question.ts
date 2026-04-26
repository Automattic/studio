import { z } from 'zod/v4';
import { tool } from './define-tool';
import type { SdkMcpToolDefinition } from 'cli/ai/sdk-message-types';
import type { AskUserQuestion } from 'cli/ai/security';

/**
 * Builds an `AskUserQuestion` tool definition.
 *
 * The Claude Agent SDK used to ship `AskUserQuestion` as a preset tool that
 * the runtime intercepted via `canUseTool` to route to `onAskUser`. With the
 * unified pi runtime there is no preset, so we register this tool directly
 * whenever an `onAskUser` callback is provided (i.e. a UI is connected). The
 * tool name, input schema, and option-picker UX are unchanged.
 *
 * Why the factory shape: the tool needs the runtime-supplied `onAskUser`
 * callback (which closes over the active `AiChatUI` instance) — same pattern
 * as `wpcom-request.ts`, which closes over a token + siteId.
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
