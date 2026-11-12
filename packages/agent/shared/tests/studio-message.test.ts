import { describe, expect, it } from 'vitest';
import { validationLines } from '@studio/agent/shared/studio-message';

describe( 'validationLines', () => {
	// eval36-37: a theme.json write checked each template and part, a line each.
	it.each( [
		{
			case: 'the files whose every block is valid on one line, before the others',
			summaries: [
				'parts/footer.html: 2/2 blocks valid',
				'templates/index.html: 8/9 blocks valid',
				'parts/header.html: 10/10 blocks valid',
			],
			lines: [
				'Block validation: every block valid in parts/footer.html 2/2, parts/header.html 10/10',
				'Block validation: templates/index.html: 8/9 blocks valid',
				'a problem',
			],
		},
		{
			case: 'one valid file, and one with a note on what Studio saved, as they read',
			summaries: [
				'parts/footer.html: 2/2 blocks valid',
				'parts/header.html: 2/2 blocks valid\nStudio changed parts/header.html after the write.',
			],
			lines: [
				'Block validation: parts/footer.html: 2/2 blocks valid',
				'Block validation: parts/header.html: 2/2 blocks valid\nStudio changed parts/header.html after the write.',
				'a problem',
			],
		},
	] )( 'states $case', ( { summaries, lines } ) => {
		expect( validationLines( { summaries, problems: [ 'a problem' ] } ) ).toEqual( lines );
	} );
} );
