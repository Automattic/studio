import { assertDeskConfig } from '@studio/common/lib/desk-config';
import { describe, expect, it } from 'vitest';
import { DRAWING_WIDGET_TYPE } from '@/ui-desks/widgets/drawing/types';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
import { POST_COLLECTION_WIDGET_TYPE } from '@/ui-desks/widgets/post-collection/types';
import { SITE_CARD_WIDGET_TYPE } from '@/ui-desks/widgets/site-card/types';
import { SITE_PREVIEW_WIDGET_TYPE } from '@/ui-desks/widgets/site-preview/types';
import { THEME_WIDGET_TYPE } from '@/ui-desks/widgets/theme/types';
import { createDefaultSiteDeskConfig } from './default-desk';

describe( 'default desk configs', () => {
	it( 'creates a valid first-run site desk', () => {
		const desk = createDefaultSiteDeskConfig();

		expect( () => assertDeskConfig( desk ) ).not.toThrow();
		expect( Number.isNaN( Date.parse( desk.updatedAt ) ) ).toBe( false );
		expect( desk.widgets.map( ( widget ) => widget.id ) ).toEqual( [
			'site-card',
			'home-preview',
			'site-notes',
			'recent-posts',
			'active-theme',
		] );
		expect( desk.widgets.map( ( widget ) => widget.type ) ).toEqual( [
			SITE_CARD_WIDGET_TYPE,
			SITE_PREVIEW_WIDGET_TYPE,
			NOTE_WIDGET_TYPE,
			POST_COLLECTION_WIDGET_TYPE,
			THEME_WIDGET_TYPE,
		] );
		expect( desk.widgets.some( ( widget ) => widget.type === DRAWING_WIDGET_TYPE ) ).toBe( false );
	} );

	it( 'seeds the site desk with editable notes and site-aware widgets', () => {
		const desk = createDefaultSiteDeskConfig();

		expect( desk.widgets.find( ( widget ) => widget.id === 'site-notes' ) ).toMatchObject( {
			type: NOTE_WIDGET_TYPE,
			widgetProps: {
				text: 'Ideas / TODO',
				tone: 'yellow',
			},
		} );
		expect( desk.widgets.find( ( widget ) => widget.id === 'home-preview' ) ).toMatchObject( {
			type: SITE_PREVIEW_WIDGET_TYPE,
			widgetProps: {
				path: '/',
			},
		} );
		expect( desk.widgets.find( ( widget ) => widget.id === 'recent-posts' ) ).toMatchObject( {
			type: POST_COLLECTION_WIDGET_TYPE,
			widgetProps: {
				query: {
					postType: 'post',
					perPage: 5,
					status: 'publish',
					orderby: 'date',
					order: 'desc',
				},
			},
		} );
	} );
} );
