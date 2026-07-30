import { Type } from 'typebox';
import { defineTool } from './define-tool';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { AskUserQuestion } from 'cli/ai/types';
import type { TSchema } from 'typebox';

// Factory because the tool closes over `onAskUser` (the active AiChatUI
// instance), same pattern as `wpcom-request.ts` closing over token + siteId.
export function createAskUserQuestionTool(
	onAskUser: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >
): AgentTool< TSchema > {
	return defineTool(
		'AskUserQuestion',
		'Ask the user 1–4 multiple-choice questions and wait for their answers. Use this whenever you need a clarification, preference, or selection from the user — instead of asking inline in prose. Each question must include 2–4 short option labels with a one-sentence description for each. The system automatically appends a free-form "Other" option, so do NOT add one yourself. Returns a map of question text → selected option label (or the user\'s typed answer if they chose "Other").',
		{
			questions: Type.Array(
				Type.Object( {
					question: Type.String( { description: 'The question to ask the user.' } ),
					options: Type.Array(
						Type.Object( {
							label: Type.String( { description: 'Short option label (1-5 words).' } ),
							description: Type.String( {
								description: 'One-sentence explanation of what this option means.',
							} ),
						} ),
						{ description: '2-4 predefined options for the user to choose from.' }
					),
				} ),
				{ description: '1-4 questions to ask in a single batch.' }
			),
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
}
