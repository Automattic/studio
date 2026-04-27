import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { vi } from 'vitest';
import { Gravatar } from 'src/components/gravatar';
import { useGravatarUrl } from 'src/hooks/use-gravatar-url';
import { store } from 'src/stores';
import { authSelectors } from 'src/stores/auth-slice';

vi.mock( 'src/stores/auth-slice', async () => {
	const actual = await vi.importActual( 'src/stores/auth-slice' );
	return {
		...actual,
		authSelectors: {
			selectIsAuthenticated: vi.fn( () => true ),
			selectUser: vi.fn( () => ( {
				id: 1,
				email: 'antonio.sejas@automattic.com',
				displayName: 'Antonio',
			} ) ),
		},
	};
} );

vi.mock( 'src/hooks/use-gravatar-url', () => ( {
	useGravatarUrl: vi.fn(),
} ) );

describe( 'Gravatar', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( authSelectors.selectUser ).mockReturnValue( {
			id: 1,
			email: 'antonio.sejas@automattic.com',
			displayName: 'Antonio',
		} );
	} );

	test( 'Gravatar renders the image when gravatarUrl is available', () => {
		vi.mocked( useGravatarUrl ).mockReturnValue(
			'https://www.gravatar.com/avatar/efc7b0f52253614d24531995d89c6d3dcf36bedcf6357a28f034c2597d84266b?d=https://s0.wp.com/i/studio-app/profile-icon.png'
		);

		render(
			<Provider store={ store }>
				<Gravatar />
			</Provider>
		);

		const image = screen.getByAltText( 'User avatar' );
		expect( image ).toBeVisible();
		expect( image ).toHaveAttribute(
			'src',
			'https://www.gravatar.com/avatar/efc7b0f52253614d24531995d89c6d3dcf36bedcf6357a28f034c2597d84266b?d=https://s0.wp.com/i/studio-app/profile-icon.png'
		);
	} );

	test( 'Gravatar does not render the image when there is no email', () => {
		vi.mocked( useGravatarUrl ).mockReturnValue( '' );

		render(
			<Provider store={ store }>
				<Gravatar />
			</Provider>
		);

		const image = screen.queryByAltText( 'User avatar' );
		expect( image ).not.toBeInTheDocument();
	} );
} );
