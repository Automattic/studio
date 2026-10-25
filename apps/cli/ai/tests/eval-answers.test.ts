import { describe, expect, it } from 'vitest';
import { createScriptedUser, type EvalAnswers } from 'cli/ai/eval-answers';
import type { AskUserQuestion } from 'cli/ai/types';

const confirmation = ( question: string ): AskUserQuestion => ( {
	question,
	options: [
		{ label: 'Yes, go ahead', description: '' },
		{ label: 'No', description: '' },
	],
	allowFreeForm: false,
} );

const openQuestion = ( question: string ): AskUserQuestion => ( {
	question,
	options: [
		{ label: 'Install Jetpack', description: '' },
		{ label: 'Skip the form', description: '' },
	],
	allowFreeForm: true,
} );

const userWhoDelegates: EvalAnswers = [
	{ when: 'Classic Theme', label: 'No' },
	{ label: 'Whatever you think is best.' },
];

describe( 'createScriptedUser', () => {
	it.each( [
		{
			name: 'the answer whose question it matches',
			answers: userWhoDelegates,
			asked: [ confirmation( 'Make "yoga" a classic theme?' ) ],
			expected: [ 'No' ],
		},
		{
			name: 'a typed answer to a question that takes one, whatever its order',
			answers: userWhoDelegates,
			asked: [
				openQuestion( 'Should I install Jetpack for the contact form?' ),
				confirmation( 'Make "yoga" a classic theme?' ),
			],
			expected: [ 'Whatever you think is best.', 'No' ],
		},
		{
			name: 'cancel where the only answer is not one of its options',
			answers: userWhoDelegates,
			asked: [ confirmation( 'Push the local site "Lotus" to example.com?' ) ],
			expected: [ 'Cancel' ],
		},
		{
			name: 'the same answer to every question it fits',
			answers: [ { label: 'Cancel' } ],
			asked: [ openQuestion( 'Which site?' ), openQuestion( 'Which theme?' ) ],
			expected: [ 'Cancel', 'Cancel' ],
		},
		{
			name: 'cancel with no answers',
			answers: [],
			asked: [ openQuestion( 'Update this site or create a new one?' ) ],
			expected: [ 'Cancel' ],
		},
	] )( 'gives $name', async ( { answers, asked, expected } ) => {
		const user = createScriptedUser( answers );
		const given = await user.onAskUser( asked );
		expect( asked.map( ( { question } ) => given[ question ] ) ).toEqual( expected );
		expect( user.questions.map( ( { answer } ) => answer ) ).toEqual( expected );
	} );
} );
