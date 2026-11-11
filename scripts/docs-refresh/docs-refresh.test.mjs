import { describe, expect, it } from 'vitest';
import {
	buildBrief,
	buildPullRequestBody,
	extractReleaseNotes,
	findImageLinks,
	findOutOfScope,
	parseChanges,
	parseStatusPaths,
	shouldRun,
	summarizeCapture,
} from './docs-refresh.mjs';

const NOTES = `Unreleased
==========

2.2.0
=====
<!-- Release notes generated using configuration in .github/release.yml at HEAD -->
* Add responsive site preview controls #5543
* build(deps): bump @hono/node-server from 2.0.12 to 2.1.5 #5542

2.1.1
=====
* Fix the update notice #5400
`;

const NO_CAPTURE = summarizeCapture( {} );

describe( 'extractReleaseNotes', () => {
	it( 'returns only the lines under the version', () => {
		const notes = extractReleaseNotes( NOTES, '2.2.0' );
		expect( notes ).toContain( '#5543' );
		expect( notes ).not.toContain( '#5400' );
		expect( notes ).not.toContain( '2.1.1' );
	} );

	it( 'returns an empty section and tells a missing one apart', () => {
		expect( extractReleaseNotes( NOTES, 'Unreleased' ) ).toBe( '' );
		expect( extractReleaseNotes( NOTES, '9.9.9' ) ).toBeNull();
	} );
} );

describe( 'parseChanges', () => {
	it( 'reads release notes, leaving dependency updates out', () => {
		expect( parseChanges( extractReleaseNotes( NOTES, '2.2.0' ) ) ).toEqual( {
			changes: [ { title: 'Add responsive site preview controls', pr: 5543 } ],
			dependencyUpdates: 1,
		} );
	} );

	it( 'reads squash-merge subjects', () => {
		expect(
			parseChanges(
				"Preview: open the preview itself (#5870)\nBump sharp to 0.35.5\nMerge branch 'trunk' into release/2.2.0\nA direct commit"
			)
		).toEqual( {
			changes: [
				{ title: 'Preview: open the preview itself', pr: 5870 },
				{ title: 'A direct commit' },
			],
			dependencyUpdates: 1,
		} );
	} );
} );

describe( 'summarizeCapture', () => {
	it( 'keeps the shots that changed, are new or failed', () => {
		const capture = summarizeCapture( {
			studioVersion: '2.2.0',
			shots: [
				{
					name: 'same',
					script: 'a',
					status: 'ok',
					files: [ { file: 'same.webp', status: 'unchanged' } ],
				},
				{
					name: 'moved',
					script: 'a',
					status: 'ok',
					files: [
						{ file: 'moved.webp', status: 'changed', diffPixels: 42, diff: 'diffs/moved.png' },
					],
				},
				{
					name: 'fresh',
					script: 'b',
					status: 'ok',
					files: [ { file: 'fresh.webp', status: 'new' } ],
				},
				{ name: 'broken', script: 'b', status: 'failed', files: [], error: 'No such button' },
				{ name: 'desktop', script: 'b', status: 'skipped', files: [] },
			],
		} );
		expect( capture.changed.map( ( shot ) => shot.file ) ).toEqual( [ 'moved.webp' ] );
		expect( capture.added.map( ( shot ) => shot.file ) ).toEqual( [ 'fresh.webp' ] );
		expect( capture.failed ).toEqual( [
			{ name: 'broken', script: 'b', error: 'No such button' },
		] );
	} );
} );

describe( 'shouldRun', () => {
	it( 'skips the agent only when nothing changed and nobody asked', () => {
		expect( shouldRun( { changes: [], capture: NO_CAPTURE, instruction: '' } ) ).toBe( false );
		expect(
			shouldRun( { changes: [ { title: 'x' } ], capture: NO_CAPTURE, instruction: '' } )
		).toBe( true );
		expect(
			shouldRun( { changes: [], capture: NO_CAPTURE, instruction: 'Recheck sync.md' } )
		).toBe( true );
		expect(
			shouldRun( {
				changes: [],
				capture: { ...NO_CAPTURE, failed: [ { name: 'broken' } ] },
				instruction: '',
			} )
		).toBe( true );
	} );
} );

describe( 'buildBrief', () => {
	it( 'lists the changes and the shots to look at', () => {
		const brief = buildBrief( {
			target: '2.2.0',
			source: 'release notes for 2.2.0',
			changes: [ { title: 'Add responsive site preview controls', pr: 5543 } ],
			dependencyUpdates: 1,
			capture: {
				studioVersion: '2.2.0',
				changed: [ { file: 'moved.webp', script: 'a', diffPixels: 42, diff: 'diffs/moved.png' } ],
				added: [],
				failed: [ { name: 'broken', script: 'b', error: 'No such button' } ],
			},
			instruction: '',
		} );
		expect( brief ).toContain( '- Add responsive site preview controls (#5543)' );
		expect( brief ).toContain( '`moved.webp` (a): 42 pixels differ' );
		expect( brief ).toContain( '`broken` (b): No such button' );
		expect( brief ).not.toContain( 'Instruction from' );
	} );
} );

describe( 'the checks on the agent’s work', () => {
	it( 'reads paths out of git status, renames included', () => {
		expect(
			parseStatusPaths( ' M docs/user/docs/a.md\n?? AGENTS.md\nR  docs/user/b.md -> apps/b.md\n' )
		).toEqual( [ 'docs/user/docs/a.md', 'AGENTS.md', 'docs/user/b.md', 'apps/b.md' ] );
	} );

	it( 'flags changes outside docs/user that were not there before', () => {
		expect(
			findOutOfScope(
				[
					'docs/user/docs/a.md',
					'AGENTS.md',
					'tools/capture-harness/scenes/moire/.baked/scene.json',
				],
				[ 'tools/capture-harness/scenes/moire/.baked/scene.json' ]
			)
		).toEqual( [ 'AGENTS.md' ] );
	} );

	it( 'finds the local images a page shows', () => {
		expect(
			findImageLinks(
				'![Add site](../../../screenshots/images/add-site.webp)\n![Badge](https://example.com/badge.svg) [a link](sites.md)'
			)
		).toEqual( [ '../../../screenshots/images/add-site.webp' ] );
	} );
} );

describe( 'buildPullRequestBody', () => {
	it( 'follows the pull request template and carries the agent’s summary', () => {
		const body = buildPullRequestBody( {
			target: '2.2.0',
			summary: 'Updated sites.md for the responsive preview.',
			capture: { ...NO_CAPTURE, changed: [ { file: 'moved.webp' } ] },
			buildUrl: 'https://buildkite.com/automattic/studio/builds/1',
		} );
		for ( const heading of [
			'## Related issues',
			'## How AI was used in this PR',
			'## Proposed Changes',
			'## Testing Instructions',
			'## Pre-merge Checklist',
		] ) {
			expect( body ).toContain( heading );
		}
		expect( body ).toContain( 'Updated sites.md for the responsive preview.' );
		expect( body ).toContain( '`moved.webp`: changed' );
	} );
} );
