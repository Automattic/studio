import { describe, expect, it } from 'vitest';
import { summarizeTiming, type ModelRequestRecord } from 'cli/ai/eval-timing';

function request( overrides: Partial< ModelRequestRecord > = {} ): ModelRequestRecord {
	return {
		startedAtMs: 0,
		endedAtMs: 1000,
		durationMs: 1000,
		contextTokens: 12000,
		outputTokens: 200,
		stopReason: 'toolUse',
		hasText: false,
		toolCalls: 1,
		...overrides,
	};
}

describe( 'summarizeTiming', () => {
	it( 'sums model time and finds the peak context', () => {
		const summary = summarizeTiming(
			[
				request( { durationMs: 1500, contextTokens: 12000 } ),
				request( { durationMs: 2500, contextTokens: 48000 } ),
			],
			[]
		);
		expect( summary.modelMs ).toBe( 4000 );
		expect( summary.requests ).toBe( 2 );
		expect( summary.peakContextTokens ).toBe( 48000 );
	} );

	it( 'counts parallel tool calls once in wall time', () => {
		const summary = summarizeTiming(
			[],
			[
				{ toolName: 'site_start', startedAtMs: 0, endedAtMs: 4000 },
				{ toolName: 'Skill', startedAtMs: 0, endedAtMs: 20 },
				{ toolName: 'wp_cli', startedAtMs: 6000, endedAtMs: 6500 },
			]
		);
		expect( summary.toolWallMs ).toBe( 4500 );
	} );

	it( 'groups tools by name, slowest total first, with their output size', () => {
		const summary = summarizeTiming(
			[],
			[
				{ toolName: 'wp_cli', startedAtMs: 0, endedAtMs: 500, outputChars: 10, checksMs: 100 },
				{ toolName: 'site_start', startedAtMs: 500, endedAtMs: 4500, outputChars: 30 },
				{ toolName: 'wp_cli', startedAtMs: 4500, endedAtMs: 5700, outputChars: 20, checksMs: 300 },
			]
		);
		expect( Object.keys( summary.tools ) ).toEqual( [ 'site_start', 'wp_cli' ] );
		expect( summary.tools.wp_cli ).toEqual( {
			calls: 2,
			totalMs: 1700,
			maxMs: 1200,
			outputChars: 30,
			checksMs: 400,
		} );
		expect( summary.checksMs ).toBe( 400 );
	} );

	it( 'skips tool calls that never finished', () => {
		const summary = summarizeTiming( [], [ { toolName: 'generate_site', startedAtMs: 0 } ] );
		expect( summary.toolWallMs ).toBe( 0 );
		expect( summary.tools ).toEqual( {} );
	} );

	it( 'counts a stop with neither text nor a tool call as an empty stop', () => {
		const summary = summarizeTiming(
			[
				request( { stopReason: 'stop', hasText: false, toolCalls: 0, outputTokens: 4098 } ),
				request( { stopReason: 'stop', hasText: true, toolCalls: 0 } ),
				request( { stopReason: 'toolUse', hasText: false, toolCalls: 1 } ),
			],
			[]
		);
		expect( summary.emptyStops ).toBe( 1 );
	} );
} );
