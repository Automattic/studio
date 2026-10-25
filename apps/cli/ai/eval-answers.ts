import { z } from 'zod';
import type { AskUserHandler } from 'cli/ai/types';

// A case's scripted user. Each answer is a reply the user gives to any
// question it fits: one whose text matches `when` (a regex, case-insensitive;
// every question without it), and that takes the reply: a typed answer where
// the question allows one, otherwise one of its option labels. The first
// answer that fits is given, so answers do not depend on the order the agent
// asks in; a question none fits is cancelled.
export const evalAnswersSchema = z.array(
	z.object( { label: z.string(), when: z.string().optional() } )
);

export type EvalAnswers = z.infer< typeof evalAnswersSchema >;

export interface AskedQuestion {
	question: string;
	options: string[];
	answer: string;
}

export function createScriptedUser( answers: EvalAnswers ): {
	onAskUser: AskUserHandler;
	questions: AskedQuestion[];
} {
	const questions: AskedQuestion[] = [];
	const onAskUser: AskUserHandler = async ( asked ) =>
		Object.fromEntries(
			asked.map( ( { question, options, allowFreeForm } ) => {
				const labels = options.map( ( option ) => option.label );
				const answer =
					answers.find(
						( { label, when } ) =>
							( ! when || new RegExp( when, 'i' ).test( question ) ) &&
							( allowFreeForm || labels.includes( label ) )
					)?.label ?? 'Cancel';
				questions.push( { question, options: labels, answer } );
				return [ question, answer ];
			} )
		);
	return { onAskUser, questions };
}
