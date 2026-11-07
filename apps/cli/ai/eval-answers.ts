import { z } from 'zod';
import type { AskUserHandler } from '@studio/agent/node/types';

// A case's scripted user. Each answer is a reply the user gives to any
// question it fits: one whose text matches `when` (a regex, case-insensitive;
// every question without it), and that takes the reply: a typed answer where
// the question allows one, otherwise one of its option labels. The first
// answer that fits is given, so answers do not depend on the order the agent
// asks in; a question none fits is dismissed, as a user does who closes the
// picker, and is left out of the answers.
export const evalAnswersSchema = z.array(
	z.object( { label: z.string(), when: z.string().optional() } )
);

export type EvalAnswers = z.infer< typeof evalAnswersSchema >;

// The answer recorded for a question the scripted user dismissed.
export const DISMISSED = '(dismissed)';

export interface AskedQuestion {
	question: string;
	options: string[];
	answer: string;
}

export function createScriptedUser( answers: EvalAnswers ): {
	onAskUser: AskUserHandler;
	reply: ( question: string ) => string | undefined;
	questions: AskedQuestion[];
} {
	const questions: AskedQuestion[] = [];
	// The first answer that fits the question, of the labels when it takes one of them.
	const answerTo = ( question: string, labels?: string[] ) =>
		answers.find(
			( { label, when } ) =>
				( ! when || new RegExp( when, 'i' ).test( question ) ) &&
				( ! labels || labels.includes( label ) )
		)?.label;
	const onAskUser: AskUserHandler = async ( asked ) =>
		Object.fromEntries(
			asked.flatMap( ( { question, options, allowFreeForm } ) => {
				const labels = options.map( ( option ) => option.label );
				const answer = answerTo( question, allowFreeForm ? undefined : labels );
				questions.push( { question, options: labels, answer: answer ?? DISMISSED } );
				return answer === undefined ? [] : [ [ question, answer ] ];
			} )
		);
	// A question the agent asked in its reply, which the user answers by typing.
	const reply = ( question: string ) => {
		const answer = answerTo( question );
		questions.push( { question, options: [], answer: answer ?? DISMISSED } );
		return answer;
	};
	return { onAskUser, reply, questions };
}
