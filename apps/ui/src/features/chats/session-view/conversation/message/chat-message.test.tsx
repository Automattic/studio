import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantText } from '@/features/chats/session-view/conversation/message';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';

describe( 'Chat message actions', () => {
	it( 'copies the complete response through the host and shows feedback', async () => {
		const connector = createFakeConnector();
		renderWithProviders(
			<AssistantText
				text="Last fragment"
				messageText={ 'First fragment\n\nLast fragment' }
				copyText={ 'First fragment\n\nLast fragment' }
			/>,
			{ connector }
		);
		fireEvent.click( await screen.findByRole( 'button', { name: 'Copy message' } ) );
		await waitFor( () =>
			expect( connector.copyText ).toHaveBeenCalledWith( 'First fragment\n\nLast fragment' )
		);
		await waitFor( () =>
			expect( screen.getAllByRole( 'status' ).map( ( status ) => status.textContent ) ).toContain(
				'Copied'
			)
		);
	} );
} );
