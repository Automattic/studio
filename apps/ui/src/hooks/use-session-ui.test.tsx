import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionUIProvider, useSessionPreviewUI } from './use-session-ui';

function PreviewStatus( { label }: { label: string } ) {
	const preview = useSessionPreviewUI();
	return <span>{ `${ label }:${ preview.open ? 'open' : 'closed' }` }</span>;
}

function PreviewToggle() {
	const preview = useSessionPreviewUI();
	return <button onClick={ preview.toggle }>Toggle preview</button>;
}

describe( 'SessionUIProvider', () => {
	it( 'does not reset preview state when nested inside an existing provider', () => {
		render(
			<SessionUIProvider>
				<PreviewStatus label="outer" />
				<SessionUIProvider>
					<PreviewToggle />
					<PreviewStatus label="inner" />
				</SessionUIProvider>
			</SessionUIProvider>
		);

		expect( screen.getByText( 'outer:closed' ) ).toBeVisible();
		expect( screen.getByText( 'inner:closed' ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Toggle preview' } ) );

		expect( screen.getByText( 'outer:open' ) ).toBeVisible();
		expect( screen.getByText( 'inner:open' ) ).toBeVisible();
	} );
} );
