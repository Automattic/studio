import { assertDeskConfig } from '@studio/common/lib/desk-config';
import { describe, expect, it } from 'vitest';
import { BOOKMARK_WIDGET_TYPE } from '@/ui-desks/widgets/bookmark/types';
import { DRAWING_WIDGET_TYPE } from '@/ui-desks/widgets/drawing/types';
import { EMBED_WIDGET_TYPE } from '@/ui-desks/widgets/embed/types';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
import { SITE_CARD_WIDGET_TYPE } from '@/ui-desks/widgets/site-card/types';
import { SITE_PREVIEW_WIDGET_TYPE } from '@/ui-desks/widgets/site-preview/types';
import { THEME_WIDGET_TYPE } from '@/ui-desks/widgets/theme/types';
import { createDefaultSiteDeskConfig, defaultUserDesk } from './default-desk';

describe( 'default desk configs', () => {
	it( 'creates a valid first-run user desk that guides new users', () => {
		expect( () => assertDeskConfig( defaultUserDesk ) ).not.toThrow();
		expect( Number.isNaN( Date.parse( defaultUserDesk.updatedAt ) ) ).toBe( false );
		expect( defaultUserDesk.viewport ).toEqual( {
			x: 20,
			y: 11,
			z: 1,
		} );
		expect( defaultUserDesk.widgets.map( ( widget ) => widget.id ) ).toEqual( [
			'create-site-note',
			'welcome-note',
			'studio-tour-video',
			'chat-note',
			'sites-note',
			'418a66ef-52f8-4f32-a819-f0dc1cc9e32a',
		] );
		expect( defaultUserDesk.widgets.map( ( widget ) => widget.type ) ).toEqual( [
			NOTE_WIDGET_TYPE,
			NOTE_WIDGET_TYPE,
			EMBED_WIDGET_TYPE,
			NOTE_WIDGET_TYPE,
			NOTE_WIDGET_TYPE,
			DRAWING_WIDGET_TYPE,
		] );
		expect(
			defaultUserDesk.widgets.find( ( widget ) => widget.id === 'studio-tour-video' )
		).toMatchObject( {
			type: EMBED_WIDGET_TYPE,
			widgetProps: {
				url: 'https://www.youtube.com/watch?v=2MV17Qzj_T0',
			},
		} );
		expect(
			defaultUserDesk.widgets.find(
				( widget ) => widget.id === '418a66ef-52f8-4f32-a819-f0dc1cc9e32a'
			)
		).toMatchObject( {
			type: DRAWING_WIDGET_TYPE,
			widgetProps: {
				svg: expect.stringContaining( 'tl-container' ),
			},
		} );
	} );

	it( 'creates a valid first-run site desk', () => {
		const desk = createDefaultSiteDeskConfig( 'https://example.test' );

		expect( () => assertDeskConfig( desk ) ).not.toThrow();
		expect( Number.isNaN( Date.parse( desk.updatedAt ) ) ).toBe( false );
		expect( desk.viewport ).toEqual( {
			x: 440.72744922694875,
			y: 53.85707696744839,
			z: 0.6035527097673408,
		} );
		expect( desk.widgets.map( ( widget ) => widget.id ) ).toEqual( [
			'site-card',
			'active-theme',
			'home-preview',
			'site-notes',
			'2f456fe8-0351-49ec-b816-3629382036a3',
			'5efaab75-bd70-4332-bdf1-e1183e78331f',
			'e60190a0-d2df-4c16-b283-eb19ed8e4839',
		] );
		expect( desk.widgets.map( ( widget ) => widget.type ) ).toEqual( [
			SITE_CARD_WIDGET_TYPE,
			THEME_WIDGET_TYPE,
			SITE_PREVIEW_WIDGET_TYPE,
			NOTE_WIDGET_TYPE,
			NOTE_WIDGET_TYPE,
			BOOKMARK_WIDGET_TYPE,
			NOTE_WIDGET_TYPE,
		] );
		expect( desk.widgets.some( ( widget ) => widget.type === DRAWING_WIDGET_TYPE ) ).toBe( false );
	} );

	it( 'uses Lola desk content with a dynamic bookmark URL', () => {
		const desk = createDefaultSiteDeskConfig( 'https://example.test' );

		expect( desk.widgets.find( ( widget ) => widget.id === 'site-notes' ) ).toMatchObject( {
			type: NOTE_WIDGET_TYPE,
			widgetProps: {
				text: 'Site Preview',
				tone: 'neon-blue',
				textSize: 2,
			},
		} );
		expect( desk.widgets.find( ( widget ) => widget.id === 'home-preview' ) ).toMatchObject( {
			type: SITE_PREVIEW_WIDGET_TYPE,
			x: 634.5565745594427,
			y: 98.47227110772417,
			shapeProps: {
				w: 754.6531489796062,
				h: 603.3094530012401,
			},
			widgetProps: {
				path: '/',
			},
		} );
		expect(
			desk.widgets.find( ( widget ) => widget.id === '5efaab75-bd70-4332-bdf1-e1183e78331f' )
		).toMatchObject( {
			type: BOOKMARK_WIDGET_TYPE,
			widgetProps: {
				url: 'https://example.test/',
			},
		} );
	} );

	it( 'keeps an existing trailing slash on the dynamic bookmark URL', () => {
		const desk = createDefaultSiteDeskConfig( 'https://example.test/' );

		expect(
			desk.widgets.find( ( widget ) => widget.id === '5efaab75-bd70-4332-bdf1-e1183e78331f' )
		).toMatchObject( {
			widgetProps: {
				url: 'https://example.test/',
			},
		} );
	} );
} );
