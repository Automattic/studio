import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { updateResponsivePreview, useResponsivePreview } from '@/data/responsive-preview';
import { SessionUIProvider } from '@/data/use-session-ui';
import { makeSite } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SitePreview } from '../index';
import { ResponsiveToolbar } from './toolbar';
import { ResponsiveViewport } from './viewport';

async function renderPreview( id: string ) {
	const view = renderWithProviders(
		<SessionUIProvider>
			<SitePreview
				site={ makeSite( { id, running: true, port: 9010 } ) }
				path="/"
				reloadNonce={ 0 }
			/>
		</SessionUIProvider>
	);
	await screen.findByRole( 'complementary', { name: 'Site preview' } );
	return view;
}
const toggle = () => screen.getByRole( 'button', { name: 'Responsive mode' } );
const width = () => screen.getByRole( 'textbox', { name: 'Width' } );
const height = () => screen.getByRole( 'textbox', { name: 'Height' } );

describe( 'responsive mode', () => {
	it( 'starts at 400 × 800, retains settings across toggles and remounts, and keeps the page mounted', async () => {
		const view = await renderPreview( 'responsive-restore' );
		const page = document.querySelector( 'iframe' );
		expect( toggle() ).toHaveAttribute( 'aria-pressed', 'false' );
		await view.user.click( toggle() );
		expect( toggle() ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( screen.getByRole( 'button', { name: 'Fit' } ) ).toBeInTheDocument();
		expect( width() ).toHaveValue( '400' );
		expect( height() ).toHaveValue( '800' );
		await view.user.click( screen.getByRole( 'button', { name: 'Responsive' } ) );
		await view.user.click(
			await screen.findByRole( 'menuitemradio', { name: /iPhone 17 Pro Max/ } )
		);
		expect( width() ).toHaveValue( '440' );
		await view.user.click( screen.getByRole( 'button', { name: 'Fit' } ) );
		await view.user.click( await screen.findByRole( 'menuitemradio', { name: '75%' } ) );
		await view.user.click( screen.getByRole( 'button', { name: 'Exit responsive mode' } ) );
		expect( toggle() ).toHaveAttribute( 'aria-pressed', 'false' );
		expect(
			screen.queryByRole( 'toolbar', { name: 'Responsive preview' } )
		).not.toBeInTheDocument();
		expect( document.querySelector( 'iframe' ) ).toBe( page );
		await view.user.click( toggle() );
		expect( width() ).toHaveValue( '440' );
		expect( height() ).toHaveValue( '956' );
		expect( screen.getByRole( 'button', { name: '75%' } ) ).toBeInTheDocument();
		expect( document.querySelector( 'iframe' ) ).toBe( page );
		view.unmount();
		const other = await renderPreview( 'responsive-other' );
		expect( toggle() ).toHaveAttribute( 'aria-pressed', 'false' );
		await other.user.click( toggle() );
		expect( width() ).toHaveValue( '400' );
		other.unmount();
		await renderPreview( 'responsive-restore' );
		expect( toggle() ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( width() ).toHaveValue( '440' );
	} );

	it( 'commits valid dimensions, cancels on Escape, rejects invalid values, and rotates', async () => {
		const { user } = await renderPreview( 'responsive-inputs' );
		await user.click( toggle() );
		await user.clear( width() );
		await user.type( width(), '512{Enter}' );
		expect( width() ).toHaveValue( '512' );
		await user.clear( width() );
		await user.type( width(), '900{Escape}' );
		expect( width() ).toHaveValue( '512' );
		for ( const invalid of [ '', '0', '99', '3841', '400.5', 'abc' ] ) {
			await user.clear( width() );
			if ( invalid ) await user.type( width(), invalid );
			await user.tab();
			expect( width() ).toHaveValue( '512' );
		}
		await user.click( screen.getByRole( 'button', { name: 'Rotate to landscape' } ) );
		expect( width() ).toHaveValue( '800' );
		expect( height() ).toHaveValue( '512' );
		await user.click( screen.getByRole( 'button', { name: 'Rotate to portrait' } ) );
		expect( width() ).toHaveValue( '512' );
		expect( height() ).toHaveValue( '800' );
	} );

	it( 'resizes with keyboard handles and returns presets to Responsive', async () => {
		const { user } = await renderPreview( 'responsive-handles' );
		await user.click( toggle() );
		act( () =>
			updateResponsivePreview( 'responsive-handles', {
				preset: 'iPhone 16e',
				width: 390,
				height: 844,
			} )
		);
		const edge = screen.getByRole( 'button', { name: 'Resize viewport: Right' } );
		edge.focus();
		await user.keyboard( '{ArrowRight}{Shift>}{ArrowRight}{/Shift}' );
		expect( width() ).toHaveValue( '401' );
		expect( screen.getByRole( 'button', { name: 'Responsive' } ) ).toBeInTheDocument();
		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Resize viewport: Top' } ), {
			key: 'ArrowUp',
		} );
		expect( height() ).toHaveValue( '845' );
	} );

	it( 'converts pointer movement into viewport pixels without replacing the page', async () => {
		const { user } = await renderPreview( 'responsive-pointer' );
		await user.click( toggle() );
		act( () => updateResponsivePreview( 'responsive-pointer', { zoom: 0.5 } ) );
		const page = document.querySelector( 'iframe' );
		expect( screen.getAllByRole( 'button', { name: /^Resize viewport:/ } ) ).toHaveLength( 4 );
		const edge = screen.getByRole( 'button', { name: 'Resize viewport: Right' } );
		Object.assign( edge, { setPointerCapture: () => {}, releasePointerCapture: () => {} } );
		fireEvent.pointerDown( edge, { pointerId: 1, button: 0, clientX: 100, clientY: 100 } );
		fireEvent.pointerMove( edge, { pointerId: 1, clientX: 110, clientY: 105 } );
		fireEvent.pointerUp( edge, { pointerId: 1 } );
		expect( width() ).toHaveValue( '440' );
		expect( height() ).toHaveValue( '800' );
		const bottom = screen.getByRole( 'button', { name: 'Resize viewport: Bottom' } );
		Object.assign( bottom, { setPointerCapture: () => {}, releasePointerCapture: () => {} } );
		fireEvent.pointerDown( bottom, { pointerId: 2, button: 0, clientX: 100, clientY: 100 } );
		fireEvent.pointerMove( bottom, { pointerId: 2, clientX: 110, clientY: 105 } );
		fireEvent.pointerUp( bottom, { pointerId: 2 } );
		expect( width() ).toHaveValue( '440' );
		expect( height() ).toHaveValue( '820' );
		expect( document.querySelector( 'iframe' ) ).toBe( page );
	} );
	it( 'cancels resizing when the preview changes sites', async () => {
		const first = 'responsive-drag-first';
		const second = 'responsive-drag-second';
		updateResponsivePreview( first, { enabled: true, width: 400, height: 800 } );
		updateResponsivePreview( second, { enabled: true, width: 512, height: 720 } );
		function Preview() {
			const [ siteId, setSiteId ] = useState( first );
			const settings = useResponsivePreview( siteId );
			return (
				<>
					<button onClick={ () => setSiteId( second ) }>Switch site</button>
					<ResponsiveToolbar siteId={ siteId } settings={ settings } fitScale={ 0.5 } />
					<ResponsiveViewport siteId={ siteId } settings={ settings } scale={ 0.5 }>
						<iframe title="Site page" />
					</ResponsiveViewport>
				</>
			);
		}
		renderWithProviders( <Preview /> );
		const edge = await screen.findByRole( 'button', { name: 'Resize viewport: Right' } );
		Object.assign( edge, { setPointerCapture: () => {}, releasePointerCapture: () => {} } );
		fireEvent.pointerDown( edge, { pointerId: 1, button: 0, clientX: 100, clientY: 100 } );
		fireEvent.pointerMove( edge, { pointerId: 1, clientX: 110, clientY: 100 } );
		expect( width() ).toHaveValue( '440' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Switch site' } ) );
		expect( width() ).toHaveValue( '512' );
		fireEvent.pointerMove( edge, { pointerId: 1, clientX: 120, clientY: 100 } );
		fireEvent.pointerUp( edge, { pointerId: 1 } );
		expect( width() ).toHaveValue( '512' );
		expect( height() ).toHaveValue( '720' );
	} );
} );
