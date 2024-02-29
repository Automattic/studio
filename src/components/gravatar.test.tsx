import { render, screen, waitFor } from '@testing-library/react';
import { Gravatar } from './gravatar';

jest.mock( '../hooks/use-auth', () => ( {
	useAuth: () => ( { user: { email: 'antonio.sejas@automattic.com' } } ),
} ) );

jest.mock( '../hooks/use-sha256', () => ( {
	useSha256: () =>
		jest
			.fn()
			.mockResolvedValue( 'efc7b0f52253614d24531995d89c6d3dcf36bedcf6357a28f034c2597d84266b' ),
} ) );

describe( 'Gravatar', () => {
	test( 'Gravatar renders the image when gravatarUrl is available', async () => {
		render( <Gravatar /> );
		await waitFor( () => {
			const image = screen.getByAltText( 'Avatar' );
			expect( image ).toBeInTheDocument();
			expect( image ).toHaveAttribute(
				'src',
				'https://www.gravatar.com/avatar/efc7b0f52253614d24531995d89c6d3dcf36bedcf6357a28f034c2597d84266b?d=https://s0.wp.com/i/studio-app/profile-icon.png'
			);
		} );
	} );

	test( 'Gravatar does not render the image when there is no email', async () => {
		jest.mock( '../hooks/use-auth', () => ( {
			useAuth: () => ( { user: undefined } ),
		} ) );
		render( <Gravatar /> );
		await waitFor( () => {
			const image = screen.queryByAltText( 'Avatar' );
			expect( image ).not.toBeInTheDocument();
		} );
	} );
} );
