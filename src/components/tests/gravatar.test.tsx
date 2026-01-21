import { render, screen } from '@testing-library/react';
import { vi, describe, test, expect, beforeEach } from 'vitest';
import { Gravatar } from 'src/components/gravatar';
import { useGravatarUrl } from 'src/hooks/use-gravatar-url';

vi.mock( 'src/hooks/use-auth', () => ( {
	useAuth: () => ( { user: { email: 'antonio.sejas@automattic.com' } } ),
} ) );

vi.mock( 'src/hooks/use-gravatar-url', () => ( {
	useGravatarUrl: vi.fn(),
} ) );

describe( 'Gravatar', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	test( 'Gravatar renders the image when gravatarUrl is available', () => {
		vi.mocked( useGravatarUrl ).mockReturnValue(
			'https://www.gravatar.com/avatar/efc7b0f52253614d24531995d89c6d3dcf36bedcf6357a28f034c2597d84266b?d=https://s0.wp.com/i/studio-app/profile-icon.png'
		);

		render( <Gravatar /> );

		const image = screen.getByAltText( 'User avatar' );
		expect( image ).toBeVisible();
		expect( image ).toHaveAttribute(
			'src',
			'https://www.gravatar.com/avatar/efc7b0f52253614d24531995d89c6d3dcf36bedcf6357a28f034c2597d84266b?d=https://s0.wp.com/i/studio-app/profile-icon.png'
		);
	} );

	test( 'Gravatar does not render the image when there is no email', () => {
		vi.mocked( useGravatarUrl ).mockReturnValue( '' );

		render( <Gravatar /> );

		const image = screen.queryByAltText( 'User avatar' );
		expect( image ).not.toBeInTheDocument();
	} );
} );
