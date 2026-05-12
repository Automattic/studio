import { describe, expect, it, vi } from 'vitest';
import {
	buildWidgetContextDisplayMessage,
	buildWidgetContextPrompt,
	summarizeWidgetList,
} from './widget-context';
import type { DeskWidget } from '@/ui-desks/widgets/types';

vi.mock( '@wordpress/i18n', () => ( {
	__: ( text: string ) => text,
	_n: ( single: string, plural: string, count: number ) => ( count === 1 ? single : plural ),
	sprintf: ( format: string, ...args: Array< string | number > ) =>
		args.reduce< string >(
			( message, arg, index ) =>
				message
					.replace( `%${ index + 1 }$s`, String( arg ) )
					.replace( `%${ index + 1 }$d`, String( arg ) ),
			format
		),
} ) );

vi.mock( '@/ui-desks/widgets/registry', () => ( {
	getWidgetDefinition: ( type: string ) =>
		type === 'note'
			? {
					name: () => 'Note',
					isWidgetProps: ( props: unknown ) =>
						props !== null && typeof props === 'object' && 'text' in props,
					getSummary: ( props: { text: string } ) => props.text,
			  }
			: undefined,
} ) );

describe( 'widget chat context', () => {
	it( 'serializes attached widgets into the agent prompt', () => {
		const prompt = buildWidgetContextPrompt( 'What should change?', [
			createWidget( 'note-1', { text: 'Draft intro' } ),
		] );

		expect( prompt ).toContain( 'Use the following Studio canvas selection as context.' );
		expect( prompt ).toContain( '"widgetId":"note-1"' );
		expect( prompt ).toContain( '"widgetProps":{"text":"Draft intro"}' );
		expect( prompt ).toContain( 'User request:\nWhat should change?' );
	} );

	it( 'summarizes visible widget labels for the display message', () => {
		const widgets = [
			createWidget( 'note-1', { text: 'Draft intro' } ),
			createWidget( 'note-2', { text: 'Pull quote' } ),
			createWidget( 'note-3', { text: 'CTA' } ),
			createWidget( 'note-4', { text: 'Footer' } ),
		];

		expect( summarizeWidgetList( widgets ) ).toBe(
			'Note: Draft intro, Note: Pull quote, Note: CTA + 1 more'
		);
		expect( buildWidgetContextDisplayMessage( 'Review these', widgets ) ).toBe(
			'Review these\n\nSelected context: Note: Draft intro, Note: Pull quote, Note: CTA + 1 more'
		);
	} );
} );

function createWidget( id: string, widgetProps: Record< string, unknown > ): DeskWidget {
	return {
		id,
		type: 'note',
		x: 10,
		y: 20,
		shapeProps: {
			w: 200,
			h: 160,
		},
		widgetProps,
	} as DeskWidget;
}
