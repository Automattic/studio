import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { TooltipProvider } from '../tooltip';
import { ThumbnailTooltip } from './index';

it( 'does not show a thumbnail that arrives after hover ends', async () => {
	const user = userEvent.setup();
	const onOpenChange = vi.fn();
	const tooltip = ( thumbnail?: string ) => (
		<TooltipProvider>
			<ThumbnailTooltip
				trigger={ <button>Site</button> }
				thumbnail={ thumbnail }
				label="Site preview"
				side="inline-end"
				onOpenChange={ onOpenChange }
			/>
		</TooltipProvider>
	);
	const { rerender } = render( tooltip() );
	const trigger = screen.getByRole( 'button', { name: 'Site' } );
	await user.hover( trigger );
	await waitFor( () => expect( onOpenChange.mock.lastCall?.[ 0 ] ).toBe( true ) );
	await user.unhover( trigger );
	await waitFor( () => expect( onOpenChange.mock.lastCall?.[ 0 ] ).toBe( false ) );

	rerender( tooltip( 'data:image/png;base64,preview' ) );
	expect( screen.queryByRole( 'img', { name: 'Site preview' } ) ).not.toBeInTheDocument();
} );
