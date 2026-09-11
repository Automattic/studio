import { describe, expect, it } from 'vitest';
import {
	parseComposerFocus,
	parseConversationAlignment,
	parseConversationAnchor,
	parseConversationOccurrence,
	resolveCapturePresentation,
} from './presentation.ts';

describe( 'presentation CLI values', () => {
	it( 'parses semantic composer and conversation values', () => {
		expect( parseComposerFocus( 'focused' ) ).toBe( 'focused' );
		expect( parseConversationAlignment( 'center' ) ).toBe( 'center' );
		expect( parseConversationOccurrence( 'last' ) ).toBe( 'last' );
		expect( parseConversationAnchor( 'start' ) ).toEqual( {
			kind: 'edge',
			edge: 'start',
		} );
		expect( parseConversationAnchor( 'last-message' ) ).toEqual( {
			kind: 'message',
			position: 'last',
		} );
		expect( parseConversationAnchor( 'message:updated design' ) ).toEqual( {
			kind: 'message-text',
			text: 'updated design',
		} );
	} );

	it( 'rejects malformed presentation values', () => {
		expect( () => parseComposerFocus( 'yes' ) ).toThrow( 'focused or blurred' );
		expect( () => parseConversationAlignment( 'middle' ) ).toThrow(
			'start, center, end, or nearest'
		);
		expect( () => parseConversationOccurrence( 'second' ) ).toThrow( 'first or last' );
		expect( () => parseConversationAnchor( 'message:' ) ).toThrow( 'message:<text>' );
		expect( () => parseConversationAnchor( 'assistant' ) ).toThrow( 'first-message' );
	} );
} );

describe( 'scenario presentation defaults', () => {
	it( 'focuses the agreed draft for a new agent session', () => {
		expect( resolveCapturePresentation( 'agent-new-session', {} ) ).toEqual( {
			composerText:
				'Create a homepage for Meridian Coffee with a bold editorial hero, featured roasts, and a mobile-friendly menu.',
			composerFocus: 'focused',
		} );
	} );

	it( 'pins populated agent conversations to the latest content', () => {
		for ( const scenario of [
			'agent-working-preview',
			'agent-complete-preview',
			'agent-long-conversation',
		] as const ) {
			expect( resolveCapturePresentation( scenario, {} ) ).toEqual( {
				conversationAnchor: { kind: 'edge', edge: 'end' },
			} );
		}
	} );

	it( 'uses semantic interactions to expose selective sync and responsive comparison states', () => {
		expect( resolveCapturePresentation( 'connected-site-controls', {} ) ).toEqual( {
			actions: [ { kind: 'set-local-site-url-label', label: 'meridian.local' } ],
		} );
		expect( resolveCapturePresentation( 'selective-sync', {} ) ).toEqual( {
			actions: [ { kind: 'open-selective-pull' } ],
		} );
		expect( resolveCapturePresentation( 'responsive-preview', {} ) ).toEqual( {
			actions: [ { kind: 'show-responsive-comparison' } ],
		} );
	} );

	it( 'lets CLI values override scenario framing independently', () => {
		expect(
			resolveCapturePresentation( 'agent-new-session', {
				composerText: 'Draft supplied by the caller.',
				composerFocus: 'blurred',
			} )
		).toEqual( {
			composerText: 'Draft supplied by the caller.',
			composerFocus: 'blurred',
		} );

		expect(
			resolveCapturePresentation( 'agent-complete-preview', {
				conversationAnchor: { kind: 'message-text', text: 'ready to review' },
				conversationAlignment: 'start',
				conversationOccurrence: 'last',
			} )
		).toEqual( {
			conversationAnchor: { kind: 'message-text', text: 'ready to review' },
			conversationAlignment: 'start',
			conversationOccurrence: 'last',
		} );
	} );

	it( 'defaults text anchors to a centered first match', () => {
		expect(
			resolveCapturePresentation( 'add-site', {
				conversationAnchor: { kind: 'message-text', text: 'homepage' },
			} )
		).toEqual( {
			conversationAnchor: { kind: 'message-text', text: 'homepage' },
			conversationAlignment: 'center',
			conversationOccurrence: 'first',
		} );
	} );

	it( 'rejects modifiers that do not have a compatible anchor', () => {
		expect( () =>
			resolveCapturePresentation( 'add-site', { conversationAlignment: 'center' } )
		).toThrow( 'requires --conversation-anchor' );
		expect( () =>
			resolveCapturePresentation( 'add-site', {
				conversationAnchor: { kind: 'edge', edge: 'end' },
				conversationAlignment: 'center',
			} )
		).toThrow( 'cannot be used with a start or end anchor' );
		expect( () =>
			resolveCapturePresentation( 'add-site', {
				conversationAnchor: { kind: 'message', position: 'last' },
				conversationOccurrence: 'last',
			} )
		).toThrow( 'requires a message:<text> anchor' );
	} );
} );
