import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceReveal, useSmoothStreamingText } from './use-smooth-streaming-text';

describe( 'advanceReveal', () => {
	it( 'holds a half-typed word while the reply is live', () => {
		const next = advanceReveal( { visible: 0, pending: 0 }, 'Hello world', 0.05, true );
		expect( next.visible ).toBe( 0 );
		expect( next.pending ).toBeGreaterThan( 0 );
	} );

	it( 'cuts right before whitespace once the budget reaches past a word', () => {
		const next = advanceReveal( { visible: 0, pending: 8 }, 'Hello brave world', 0, true );
		expect( next.visible ).toBe( 5 );
		expect( next.pending ).toBeCloseTo( 3 );
	} );

	it( 'never shows the trailing partial word while live', () => {
		const next = advanceReveal( { visible: 0, pending: 100 }, 'Hello world', 0, true );
		expect( next.visible ).toBe( 5 );
	} );

	it( 'reveals the whole text once the reply has ended', () => {
		const next = advanceReveal( { visible: 5, pending: 100 }, 'Hello world', 0, false );
		expect( next ).toEqual( { visible: 11, pending: 0 } );
	} );

	it( 'shows long unbroken tokens in slices instead of stalling', () => {
		const url = 'https://example.com/a/very/long/path/without/spaces';
		const next = advanceReveal( { visible: 0, pending: 30 }, `${ url } next`, 0, true );
		expect( next.visible ).toBe( 30 );
	} );

	it( 'counts newlines as word boundaries', () => {
		const next = advanceReveal( { visible: 0, pending: 12 }, 'One\n\nTwo three', 0, true );
		expect( next.visible ).toBe( 8 );
	} );

	it( 'caps a single frame so a backgrounded tab does not dump its backlog', () => {
		const target = 'a'.repeat( 400 ) + ' ' + 'b'.repeat( 400 );
		const next = advanceReveal( { visible: 0, pending: 0 }, target, 5, false );
		expect( next.visible ).toBeLessThan( target.length );
	} );
} );

describe( 'useSmoothStreamingText', () => {
	afterEach( () => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	} );

	it( 'shows finished text immediately and never schedules a frame', () => {
		const raf = vi.fn();
		vi.stubGlobal( 'requestAnimationFrame', raf );
		const { result } = renderHook( () => useSmoothStreamingText( 'Already done', false ) );
		expect( result.current ).toBe( 'Already done' );
		expect( raf ).not.toHaveBeenCalled();
	} );

	it( 'reveals live text word by word and drains the rest once the reply ends', () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal( 'requestAnimationFrame', ( callback: FrameRequestCallback ) => {
			frames.push( callback );
			return frames.length;
		} );
		vi.stubGlobal( 'cancelAnimationFrame', vi.fn() );
		vi.spyOn( performance, 'now' ).mockReturnValue( 0 );

		const { result, rerender } = renderHook(
			( { text, isLive }: { text: string; isLive: boolean } ) =>
				useSmoothStreamingText( text, isLive ),
			{ initialProps: { text: 'Hello brave new world', isLive: true } }
		);
		expect( result.current ).toBe( '' );

		let now = 0;
		const runFrame = () => {
			now += 100;
			const frame = frames.shift();
			expect( frame ).toBeDefined();
			act( () => frame?.( now ) );
		};

		runFrame();
		expect( result.current ).toBe( 'Hello' );
		runFrame();
		expect( result.current ).toBe( 'Hello' );
		runFrame();
		// "world" is still the trailing partial word, so it waits.
		expect( result.current ).toBe( 'Hello brave new' );

		rerender( { text: 'Hello brave new world', isLive: false } );
		for ( let guard = 0; frames.length > 0 && guard < 10; guard += 1 ) {
			runFrame();
		}
		expect( result.current ).toBe( 'Hello brave new world' );
		expect( frames ).toHaveLength( 0 );
	} );

	it( 'shows a re-keyed finished message whole instead of replaying it', () => {
		const { result, rerender } = renderHook(
			( { text, isLive }: { text: string; isLive: boolean } ) =>
				useSmoothStreamingText( text, isLive ),
			{ initialProps: { text: 'Short reply', isLive: false } }
		);
		rerender( { text: 'A completely different and much longer message', isLive: false } );
		expect( result.current ).toBe( 'A completely different and much longer message' );
	} );
} );
