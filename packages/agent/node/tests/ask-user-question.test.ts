import { describe, expect, it } from 'vitest';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createAskUserQuestionTool } from '@studio/agent/node/tools/ask-user-question';
import { bindTool } from '@studio/agent/node/tools/define-tool';

const asked = {
	questions: [
		{
			question: 'Where should I build the site?',
			options: [
				{ label: 'This site', description: '' },
				{ label: 'A new site', description: '' },
			],
		},
		{
			question: 'Which look?',
			options: [
				{ label: 'Warm', description: '' },
				{ label: 'Cool', description: '' },
			],
		},
	],
};

describe( 'AskUserQuestion', () => {
	it.each( [
		{
			name: 'returns the answers when every question is answered',
			answers: { 'Where should I build the site?': 'This site', 'Which look?': 'Warm' },
			text: '{"Where should I build the site?":"This site","Which look?":"Warm"}',
			terminate: undefined,
		},
		{
			name: 'ends the turn when the user closes a question unanswered',
			answers: { 'Which look?': 'Warm' },
			text: 'The user closed without answering: Where should I build the site? The turn ends here, and the user replies when ready. Answered: {"Which look?":"Warm"}',
			terminate: true,
		},
		{
			name: 'ends the turn when an answer is blank',
			answers: { 'Where should I build the site?': ' ', 'Which look?': '' },
			text: 'The user closed without answering: Where should I build the site? Which look? The turn ends here, and the user replies when ready. Answered: {"Where should I build the site?":" ","Which look?":""}',
			terminate: true,
		},
	] )( '$name', async ( { answers, text, terminate } ) => {
		const tool = createAskUserQuestionTool( async () => answers as Record< string, string > );
		const result = await bindTool( tool, createFakeHost() ).execute( 'call-1', asked as never );
		expect( result.content ).toEqual( [ { type: 'text', text } ] );
		expect( result.terminate ).toBe( terminate );
	} );

	it( 'shows the user one free-form option, the one Studio adds', async () => {
		let shown: unknown;
		const tool = createAskUserQuestionTool( async ( questions ) => {
			shown = questions[ 0 ].options.map( ( option ) => option.label );
			return { 'Which look?': 'Warm' };
		} );
		await bindTool( tool, createFakeHost() ).execute( 'call-1', {
			questions: [
				{
					question: 'Which look?',
					options: [
						{ label: 'Warm', description: '' },
						{ label: ' other ', description: '' },
						{ label: 'Other colors', description: '' },
					],
				},
			],
		} as never );
		expect( shown ).toEqual( [ 'Warm', 'Other colors' ] );
	} );
} );
