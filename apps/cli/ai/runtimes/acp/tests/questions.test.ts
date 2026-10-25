import { describe, expect, it } from 'vitest';
import { buildQuestionSchema, readQuestionAnswers } from 'cli/ai/runtimes/acp/questions';
import type { AskUserQuestion } from 'cli/ai/types';

const questions: AskUserQuestion[] = [
	{
		question: 'Which style?',
		options: [
			{ label: 'Minimal', description: 'Lots of white space.' },
			{ label: 'Bold', description: 'Strong colors.' },
		],
	},
	{
		question: 'Which pages?',
		multiSelect: true,
		options: [
			{ label: 'About', description: 'Who you are.' },
			{ label: 'Contact', description: 'How to reach you.' },
		],
	},
];

describe( 'buildQuestionSchema', () => {
	it( 'turns each question into a required form field with its options', () => {
		const schema = buildQuestionSchema( questions );
		expect( schema.required ).toEqual( [ 'q1', 'q2' ] );
		expect( schema.properties?.q1 ).toMatchObject( {
			type: 'string',
			title: 'Which style?',
			enum: [ 'Minimal', 'Bold' ],
			oneOf: [
				{ const: 'Minimal', title: 'Minimal', description: 'Lots of white space.' },
				{ const: 'Bold', title: 'Bold', description: 'Strong colors.' },
			],
		} );
		expect( schema.properties?.q2 ).toMatchObject( {
			type: 'array',
			title: 'Which pages?',
			items: { anyOf: [ { const: 'About' }, { const: 'Contact' } ] },
		} );
	} );
} );

describe( 'readQuestionAnswers', () => {
	it( 'maps form values back to question text, joining several picks', () => {
		expect(
			readQuestionAnswers( questions, {
				action: 'accept',
				content: { q1: 'Bold', q2: [ 'About', 'Contact' ] },
			} )
		).toEqual( { 'Which style?': 'Bold', 'Which pages?': 'About, Contact' } );
	} );

	it( 'leaves out questions the user did not answer', () => {
		expect(
			readQuestionAnswers( questions, { action: 'accept', content: { q1: 'Minimal' } } )
		).toEqual( { 'Which style?': 'Minimal' } );
	} );

	it( 'returns no answers when the user declines or cancels', () => {
		expect( readQuestionAnswers( questions, { action: 'decline' } ) ).toEqual( {} );
		expect( readQuestionAnswers( questions, { action: 'cancel' } ) ).toEqual( {} );
	} );
} );
