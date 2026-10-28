import { Type } from 'typebox';
import { defineTool, READ_ONLY, type StudioToolDefinition } from './define-tool';
import type { AskUserQuestion } from '@studio/agent/node/types';

// Factory because the tool closes over `onAskUser` (the active AiChatUI
// instance).
/** What a call says when the user closes its questions without answering; the turn ends on it. */
export const closedWithoutAnswering = ( questions: string[] ) =>
	`The user closed without answering: ${ questions.join(
		' '
	) } The turn ends here, and the user replies when ready.`;

export function createAskUserQuestionTool(
	onAskUser: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >
): StudioToolDefinition {
	return defineTool(
		'AskUserQuestion',
		'Ask the user 1–4 multiple-choice questions and wait for their answers. Use this whenever you need a clarification, preference, or selection from the user — instead of asking inline in prose. Each question has 2–4 short option labels, each with a one-sentence description; the user can also reply in their own words, or skip the question. Returns a map of question text → selected option label (or the user\'s typed answer, or that they skipped it). Set `multiSelect: true` when several options can apply; the answer is then the picked labels joined with ", ".',
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
			const questions: AskUserQuestion[] = args.questions.map( ( q ) => ( {
				question: q.question,
				// Studio adds the free-form option itself, so one passed in is a duplicate.
				options: q.options.filter( ( option ) => option.label.trim().toLowerCase() !== 'other' ),
				multiSelect: q.multiSelect,
				allowFreeForm: true,
			} ) );
			const answers = await onAskUser( questions );
			const dismissed = questions.filter( ( { question } ) => ! answers[ question ]?.trim() );
			// A question the user closes without answering hands the turn back
			// to them: what comes next is theirs to say.
			if ( dismissed.length ) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `${ closedWithoutAnswering( dismissed.map( ( { question } ) => question ) ) }${
								Object.keys( answers ).length ? ` Answered: ${ JSON.stringify( answers ) }` : ''
							}`,
						},
					],
					terminate: true,
				};
			}
			return {
				content: [ { type: 'text' as const, text: JSON.stringify( answers ) } ],
			};
		},
		{ annotations: READ_ONLY }
	);
}
