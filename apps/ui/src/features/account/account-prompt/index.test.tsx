import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { AccountPromptDialog } from './index';

function Prompt() {
	const [ open, setOpen ] = useState( true );
	return (
		<>
			<button onClick={ () => setOpen( true ) }>Share</button>
			<AccountPromptDialog
				open={ open }
				onOpenChange={ setOpen }
				title="Do more with WordPress.com"
				description="Log in to share your site."
				source="unknown"
			/>
		</>
	);
}

describe( 'AccountPromptDialog', () => {
	it( 'keeps a login started before the prompt was closed and reopened from starting again', async () => {
		const connector = createFakeConnector( { user: null } );
		connector.authenticate.mockReturnValue( new Promise( () => {} ) );
		renderWithProviders( <Prompt />, { connector } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Log in' } ) );
		await waitFor( () => expect( connector.authenticate ).toHaveBeenCalledTimes( 1 ) );
		expect( screen.getByText( 'Log in to share your site.' ) ).toBeVisible();

		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		fireEvent.click( screen.getByRole( 'button', { name: 'Share' } ) );

		const logIn = await screen.findByRole( 'button', { name: 'Log in' } );
		expect( logIn ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( logIn );
		expect( connector.authenticate ).toHaveBeenCalledTimes( 1 );
	} );
} );
