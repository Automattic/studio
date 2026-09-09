import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useSaveUserPreferences } from '@/data/queries/use-user-preferences';
import { StudioCodeUpsell } from './studio-code-upsell';

const navigate = vi.fn();

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => navigate,
} ) );

vi.mock( '@/data/queries/use-agentic-features', () => ( {
	useAgenticFeatures: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useSaveUserPreferences: vi.fn(),
} ) );

describe( 'StudioCodeUpsell', () => {
	const savePreferences = vi.fn(
		( _partial, options?: { onSuccess?: () => void } ) => options?.onSuccess?.()
	);

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( useSaveUserPreferences, { partial: true } ).mockReturnValue( {
			isPending: false,
			mutate: savePreferences as never,
		} );
	} );

	it( 'turns agentic features back on and opens the chat', () => {
		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: true,
			chatEnabled: false,
			chatPromptsSignIn: false,
			reason: null,
			isReady: true,
		} );
		render( <StudioCodeUpsell siteId="site-1" /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Turn on agentic chat' } ) );

		expect( savePreferences ).toHaveBeenCalledWith(
			{ agenticFeaturesEnabled: true },
			expect.anything()
		);
		expect( navigate ).toHaveBeenCalledWith( {
			to: '/sites/$siteId/new',
			params: { siteId: 'site-1' },
		} );
	} );

	it( 'stays out of the way while chat is on or the app is offline', () => {
		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: true,
			chatEnabled: true,
			chatPromptsSignIn: false,
			reason: null,
			isReady: true,
		} );
		const { rerender } = render( <StudioCodeUpsell siteId="site-1" /> );
		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();

		vi.mocked( useAgenticFeatures ).mockReturnValue( {
			enabled: false,
			chatEnabled: false,
			chatPromptsSignIn: false,
			reason: 'offline',
			isReady: true,
		} );
		rerender( <StudioCodeUpsell siteId="site-1" /> );
		expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
	} );
} );
