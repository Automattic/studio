import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
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
	it( 'offers WordPress.com and a different provider without starting authentication for the latter', async () => {
		const connector = createFakeConnector( { user: null } );
		const chooseProvider = vi.fn();
		renderWithProviders(
			<AccountPromptDialog
				open
				onOpenChange={ () => {} }
				title="Put your feedback to work"
				description="Connect an AI provider to turn your notes and ideas into changes to your site."
				source="assistant_tab"
				onSkip={ chooseProvider }
				secondaryLabel="Choose a different provider"
			/>,
			{ connector }
		);
		fireEvent.click( await screen.findByRole( 'button', { name: 'Choose a different provider' } ) );
		expect( chooseProvider ).toHaveBeenCalledOnce();
		expect( connector.authenticate ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Continue with WordPress.com' } ) );
		await waitFor( () =>
			expect( connector.authenticate ).toHaveBeenCalledWith( true, 'assistant_tab' )
		);
	} );

	it( 'keeps a login started before the prompt was closed and reopened from starting again', async () => {
		const connector = createFakeConnector( { user: null } );
		connector.authenticate.mockReturnValue( new Promise( () => {} ) );
		renderWithProviders( <Prompt />, { connector } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Log in to WordPress.com' } ) );
		await waitFor( () => expect( connector.authenticate ).toHaveBeenCalledTimes( 1 ) );

		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		fireEvent.click( screen.getByRole( 'button', { name: 'Share' } ) );

		const logIn = await screen.findByRole( 'button', { name: 'Log in to WordPress.com' } );
		expect( logIn ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( logIn );
		expect( connector.authenticate ).toHaveBeenCalledTimes( 1 );
	} );
} );
