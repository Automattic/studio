import type { CreateElicitationRequest, CreateElicitationResponse } from '@agentclientprotocol/sdk';
import type { AskUserQuestion } from 'cli/ai/types';

type FormElicitation = Extract< CreateElicitationRequest, { mode: 'form' } >;
type RequestedSchema = FormElicitation[ 'requestedSchema' ];

function questionKey( index: number ): string {
	return `q${ index + 1 }`;
}

/**
 * Builds the ACP form for the agent's AskUserQuestion batch: one property per
 * question, its options as the allowed values. A form has no "Other" choice,
 * so free-form answers are not offered here.
 */
export function buildQuestionSchema( questions: AskUserQuestion[] ): RequestedSchema {
	const properties: NonNullable< RequestedSchema[ 'properties' ] > = {};
	questions.forEach( ( question, index ) => {
		const oneOf = question.options.map( ( option ) => ( {
			const: option.label,
			title: option.label,
			description: option.description,
		} ) );
		properties[ questionKey( index ) ] = question.multiSelect
			? {
					type: 'array',
					title: question.question,
					description: question.question,
					items: { anyOf: oneOf },
			  }
			: {
					type: 'string',
					title: question.question,
					description: question.question,
					enum: oneOf.map( ( option ) => option.const ),
					oneOf,
			  };
	} );
	return {
		type: 'object',
		properties,
		required: questions.map( ( _, index ) => questionKey( index ) ),
	};
}

/**
 * Maps the client's form response back to AskUserQuestion's answer shape:
 * question text → chosen label, several labels joined with ", ".
 */
export function readQuestionAnswers(
	questions: AskUserQuestion[],
	response: CreateElicitationResponse
): Record< string, string > {
	if ( response.action !== 'accept' ) {
		return {};
	}
	const content = ( response as { content?: Record< string, unknown > | null } ).content ?? {};
	const answers: Record< string, string > = {};
	questions.forEach( ( question, index ) => {
		const value = content[ questionKey( index ) ];
		const answer = Array.isArray( value )
			? value.filter( ( entry ) => typeof entry === 'string' ).join( ', ' )
			: typeof value === 'string'
			? value
			: '';
		if ( answer ) {
			answers[ question.question ] = answer;
		}
	} );
	return answers;
}
