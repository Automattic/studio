import { describe, expect, it } from 'vitest';
import {
	buildBrief,
	buildPullRequestBody,
	describeAgentEvent,
	summarizeAgentRun,
	extractReleaseNotes,
	findImageLinks,
	findOutOfScope,
	parseChanges,
	parseStatusPaths,
	shouldRun,
	summarizeCapture,
	mergeCaptures,
	findDesktopShots,
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
			commit: 'accef9218c458ce243862646b7b2f427f43193e2',
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
		expect( brief ).toContain( '## Screenshot check (Studio 2.2.0 at accef9218)' );
	} );
} );

describe( 'the agent’s run', () => {
	it( 'shows what the agent says and the tools it calls, one line each', () => {
		const lines = describeAgentEvent( {
			type: 'assistant',
			message: {
				content: [
					{ type: 'text', text: 'Reading the brief.\nThen the pages.' },
					{ type: 'tool_use', name: 'Read', input: { file_path: 'docs-refresh-output/brief.md' } },
					{ type: 'tool_use', name: 'Bash', input: { command: 'git log -3' } },
				],
			},
		} );
		expect( lines ).toEqual( [
			'Reading the brief.',
			'> Read docs-refresh-output/brief.md',
			'> Bash git log -3',
		] );
		expect( describeAgentEvent( { type: 'user', message: { content: [] } } ) ).toEqual( [] );
	} );

	it( 'adds up a run that ended more than once', () => {
		const run = summarizeAgentRun( [
			{ subtype: 'success', is_error: false, num_turns: 80, total_cost_usd: 5.5, result: 'Done.' },
			{
				subtype: 'success',
				is_error: false,
				num_turns: 1,
				total_cost_usd: 5.97,
				result: 'Still done.',
			},
		] );
		expect( run ).toMatchObject( { ok: true, reason: null, turns: 81, costUsd: 5.97 } );
		expect( run.result ).toBe( 'Done.\n\nStill done.' );
	} );

	it( 'fails a run that reached its budget, errored or left no result', () => {
		expect(
			summarizeAgentRun( [ { subtype: 'error_max_budget_usd', is_error: true, num_turns: 40 } ] )
		).toMatchObject( { ok: false, reason: expect.stringContaining( 'budget' ) } );
		expect(
			summarizeAgentRun( [ { subtype: 'error_during_execution', is_error: true } ] ).reason
		).toContain( 'error_during_execution' );
		expect( summarizeAgentRun( [] ).ok ).toBe( false );
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

describe( 'the Studio Desktop pass', () => {
	it( 'names the shots only Studio Desktop can capture', () => {
		expect(
			findDesktopShots( [
				{ shots: [ { name: 'site-menu' }, { name: 'annotate-note', desktopOnly: true } ] },
				{ shots: [ { name: 'settings-studio-cli', desktopOnly: true } ] },
				{},
			] )
		).toEqual( [ 'annotate-note', 'settings-studio-cli' ] );
	} );

	it( 'replaces the shots the browser skipped with what Studio Desktop found', () => {
		const merged = mergeCaptures( [
			{
				studioVersion: '2.2.0',
				shots: [
					{ script: 'signed-in', name: 'account-menu', status: 'ok', files: [] },
					{ script: 'signed-in', name: 'annotate-note', status: 'skipped', files: [] },
				],
			},
			{
				studioVersion: '2.2.0',
				shots: [
					{ script: 'signed-in', name: 'annotate-note', status: 'failed', error: 'Timeout' },
				],
			},
		] );
		expect( merged.shots ).toHaveLength( 2 );
		expect( summarizeCapture( merged ).failed ).toEqual( [
			{ name: 'annotate-note', script: 'signed-in', error: 'Timeout' },
		] );
	} );
} );

describe( 'shots a failure kept from running', () => {
	const capture = summarizeCapture( {
		shots: [
			{ script: 'site-menu', name: 'site-menu', status: 'failed', error: 'Timeout' },
			{ script: 'site-menu', name: 'site-menu-export', status: 'notRun', files: [] },
			{
				script: 'workspace',
				name: 'model-menu',
				status: 'ok',
				files: [ { file: 'docs/user/screenshots/images/model-menu.webp', status: 'changed' } ],
			},
		],
	} );

	it( 'are listed in the brief, and are a reason to run', () => {
		expect( capture.notRun ).toEqual( [ { name: 'site-menu-export', script: 'site-menu' } ] );
		expect( shouldRun( { changes: [], capture: { ...capture, failed: [], changed: [] } } ) ).toBe(
			true
		);
		const brief = buildBrief( {
			target: 'trunk',
			source: 'merged since abc',
			changes: [],
			dependencyUpdates: 0,
			capture,
		} );
		expect( brief ).toContain( '### Not run: an earlier shot of the same script failed' );
		expect( brief ).toContain( '- `site-menu-export` (site-menu)' );
	} );

	it( 'says an image changed size instead of an undefined pixel count', () => {
		const brief = buildBrief( {
			target: 'trunk',
			source: 'merged since abc',
			changes: [],
			dependencyUpdates: 0,
			capture,
		} );
		expect( brief ).toContain( 'model-menu.webp` (workspace): the image changed size' );
		expect( brief ).not.toContain( 'undefined' );
	} );
} );
