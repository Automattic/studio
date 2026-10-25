import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AlertDialog, Dialog, DialogContent, DialogTitle, replaceOpenDialogs } from '@/lib/ui';

function Settings( { canClose = true, confirming = false } ) {
	const [ open, setOpen ] = useState( true );
	return (
		<>
			<Dialog replaceable open={ open } onOpenChange={ ( next ) => canClose && setOpen( next ) }>
				<DialogContent>
					<DialogTitle>Settings</DialogTitle>
				</DialogContent>
			</Dialog>
			<AlertDialog open={ confirming }>
				<DialogContent>
					<DialogTitle>Confirm</DialogTitle>
				</DialogContent>
			</AlertDialog>
		</>
	);
}

describe( 'replaceOpenDialogs', () => {
	it( 'runs once the replaceable dialog has closed', () => {
		const next = vi.fn();
		render( <Settings /> );

		act( () => void replaceOpenDialogs( next ) );

		expect( screen.queryByRole( 'dialog', { name: 'Settings' } ) ).not.toBeInTheDocument();
		expect( next ).toHaveBeenCalledOnce();
	} );

	it( 'leaves a dialog that keeps its place, and drops the request when one stays open', () => {
		const next = vi.fn();
		const { rerender } = render( <Settings confirming /> );
		expect( replaceOpenDialogs( next ) ).toBe( false );

		rerender( <Settings canClose={ false } /> );
		act( () => void replaceOpenDialogs( next ) );
		fireEvent.pointerDown( screen.getByRole( 'dialog', { name: 'Settings' } ) );

		expect( screen.getByRole( 'dialog', { name: 'Settings' } ) ).toBeVisible();
		expect( next ).not.toHaveBeenCalled();
	} );
} );
