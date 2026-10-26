import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { InstructionsEditor } from './instructions-editor';

const SAVED = 'Answer in French.';

async function setup() {
	const connector = createFakeConnector( {}, { getAgentInstructions: async () => SAVED } );
	const view = renderWithProviders( <InstructionsEditor />, { connector } );
	const textbox = await screen.findByRole( 'textbox', { name: 'WordPress Studio instructions' } );
	const type = ( value: string ) => fireEvent.change( textbox, { target: { value } } );
	return { ...view, type };
}

const debounce = () => act( () => vi.advanceTimersByTimeAsync( 800 ) );

describe( 'Agent instructions editor', () => {
	beforeEach( () => {
		vi.useFakeTimers( { shouldAdvanceTime: true } );
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'saves once after the user stops typing, not on every keystroke', async () => {
		const { connector, type } = await setup();
		type( 'Answer in Spanish' );
		type( 'Answer in Spanish.' );
		expect( connector.saveAgentInstructions ).not.toHaveBeenCalled();
		await debounce();
		expect( connector.saveAgentInstructions ).toHaveBeenCalledExactlyOnceWith(
			'Answer in Spanish.',
			{ editSession: undefined }
		);
	} );

	it( 'does not save while the content still matches what is stored', async () => {
		const { connector, type } = await setup();
		type( SAVED );
		await debounce();
		expect( connector.saveAgentInstructions ).not.toHaveBeenCalled();
	} );

	it( 'flushes a pending edit with its edit session when the panel closes mid-debounce', async () => {
		const { connector, type, unmount } = await setup();
		type( 'Half-typed thought' );
		unmount();
		await waitFor( () =>
			expect( connector.saveAgentInstructions ).toHaveBeenCalledExactlyOnceWith(
				'Half-typed thought',
				{ editSession: { previousContent: SAVED } }
			)
		);
	} );

	it( 'reports the edit session on close after the debounce already saved', async () => {
		const { connector, type, unmount } = await setup();
		type( 'Answer in Spanish.' );
		await debounce();
		unmount();
		await waitFor( () =>
			expect( connector.saveAgentInstructions.mock.calls ).toEqual( [
				[ 'Answer in Spanish.', { editSession: undefined } ],
				[ 'Answer in Spanish.', { editSession: { previousContent: SAVED } } ],
			] )
		);
	} );

	it( 'does not report an edit session when the user only looked at the tab', async () => {
		const { connector, unmount } = await setup();
		unmount();
		await act( () => vi.advanceTimersByTimeAsync( 800 ) );
		expect( connector.saveAgentInstructions ).not.toHaveBeenCalled();
	} );

	it( 'surfaces a save failure', async () => {
		const { connector, type } = await setup();
		connector.saveAgentInstructions.mockRejectedValueOnce( new Error( 'Disk full' ) );
		type( 'Answer in Spanish.' );
		await debounce();
		expect(
			await screen.findByText( 'Saving the instructions failed. Please try again.' )
		).toBeVisible();
	} );
} );
