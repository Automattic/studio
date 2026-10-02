import { Type } from 'typebox';
import { defineTool } from './define-tool';
import type { AskUserHandler } from 'cli/ai/types';

// Factory because the tool closes over the host's `askUser` handler.
export function createAskUserQuestionTool( onAskUser: AskUserHandler ) {
	return defineTool(
		'AskUserQuestion',
		'Ask the user 1–4 multiple-choice questions and wait for their answers. Use this whenever you need a clarification, preference, or selection from the user — instead of asking inline in prose. Each question must include 2–4 short option labels with a one-sentence description for each. The system automatically appends a free-form "Other" option, so do NOT add one yourself. Returns a map of question text → selected option label (or the user\'s typed answer if they chose "Other"). Set `multiSelect: true` when several options can apply; the answer is then the picked labels joined with ", ".',
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
					multiSelect: Type.Optional(
						Type.Boolean( { description: 'Let the user pick several options.' } )
					),
				} ),
				{ description: '1-4 questions to ask in a single batch.' }
			),
		},
		async ( args ) => {
			const questions: Parameters< AskUserHandler >[ 0 ] = args.questions.map( ( q ) => ( {
				question: q.question,
				options: q.options,
				multiSelect: q.multiSelect,
				allowFreeForm: true,
			} ) );
			const answers = await onAskUser( questions );
			return {
				content: [ { type: 'text' as const, text: JSON.stringify( answers ) } ],
			};
		}
	);
}
