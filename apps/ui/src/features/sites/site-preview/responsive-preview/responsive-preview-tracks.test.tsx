import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { updateResponsivePreview, useResponsivePreview } from '@/data/responsive-preview';
import { renderWithProviders } from '@/test/render';
import { ResponsiveToolbar } from './toolbar';
import { ResponsiveViewport } from './viewport';
import type { ResponsivePreviewSettings } from '@/data/responsive-preview';

function Controls( { siteId }: { siteId: string } ) {
	const [ active, setActive ] = useState( true );
	const settings = useResponsivePreview( siteId );
	return (
		<>
			<button onClick={ () => setActive( false ) }>Hide preview</button>
			<ResponsiveToolbar
				siteId={ siteId }
				settings={ settings }
				fitScale={ 0.5 }
				active={ active }
			/>
			<ResponsiveViewport siteId={ siteId } settings={ settings } active={ active }>
				<iframe title="Site page" />
			</ResponsiveViewport>
		</>
	);
}

async function setup( name: string, patch: Partial< ResponsivePreviewSettings > = {} ) {
	const siteId = `responsive-tracks-${ name }`;
	updateResponsivePreview( siteId, {
		enabled: true,
		preset: 'responsive',
		width: 400,
		height: 800,
		zoom: 1,
		...patch,
	} );
	const view = renderWithProviders( <Controls siteId={ siteId } /> );
	await screen.findByRole( 'toolbar', { name: 'Responsive preview' } );
	return { ...view, siteId };
}

const width = () => screen.getByRole( 'textbox', { name: 'Width' } );
const height = () => screen.getByRole( 'textbox', { name: 'Height' } );
type User = ReturnType< typeof renderWithProviders >[ 'user' ];

async function selectPreset( user: User, name: RegExp, current = 'Responsive' ) {
	await user.click( screen.getByRole( 'button', { name: current } ) );
	await user.click( await screen.findByRole( 'menuitemradio', { name } ) );
}

function rightHandle() {
	const edge = screen.getByRole( 'button', { name: 'Resize viewport: Right' } );
	Object.assign( edge, { setPointerCapture: () => {}, releasePointerCapture: () => {} } );
	return edge;
}

function pointer( edge: HTMLElement, type: string, clientX = 100, pointerId = 1, button = 0 ) {
	// jsdom's PointerEvent shim is MouseEvent and otherwise drops pointerId.
	fireEvent(
		edge,
		Object.assign( new MouseEvent( type, { bubbles: true, clientX, button } ), { pointerId } )
	);
}

describe( 'responsive preview Tracks', () => {
	it.each( [
		[ /^iPhone Duo \(Open\)/, 'phone', '600_to_1023', '600_to_1023' ],
		[ /^iPad Pro 13"/, 'tablet', '1024_to_1439', '1024_to_1439' ],
		[ /^Desktop/, 'desktop', '1440_plus', '1024_to_1439' ],
		[ /^Responsive$/, 'custom', 'under_600', '600_to_1023' ],
	] as const )(
		'records bounded category and size buckets for %s',
		async ( name, category, widthBucket, heightBucket ) => {
			const { user, connector } = await setup( category, {
				preset: 'iPhone 16e',
				width: 390,
				height: 844,
			} );
			await selectPreset( user, name, 'iPhone 16e' );
			expect( connector.trackEvent ).toHaveBeenCalledExactlyOnceWith(
				TRACKS_EVENTS.RESPONSIVE_PREVIEW_CHANGED,
				{
					action: 'preset_change',
					preset_category: category,
					width_bucket: widthBucket,
					height_bucket: heightBucket,
				}
			);
		}
	);

	it( 'suppresses preset reselection but preserves different presets and later interactions in the same buckets', async () => {
		const { user, connector } = await setup( 'presets' );
		await selectPreset( user, /^iPhone 16e/ );
		await selectPreset( user, /^iPhone 16e/, 'iPhone 16e' );
		expect( connector.trackEvent ).toHaveBeenCalledTimes( 1 );
		await selectPreset( user, /^iPhone 17(?! Pro)/, 'iPhone 16e' );
		await selectPreset( user, /^Responsive$/, 'iPhone 17' );
		await selectPreset( user, /^Responsive$/ );
		expect( connector.trackEvent ).toHaveBeenCalledTimes( 3 );
		expect(
			connector.trackEvent.mock.calls.map( ( [ , props ] ) => props?.preset_category )
		).toEqual( [ 'phone', 'phone', 'custom' ] );
	} );

	it( 'records only valid changed input commits and suppresses Enter/blur duplicates, invalid input and Escape', async () => {
		const { user, connector } = await setup( 'inputs' );
		await user.clear( width() );
		await user.type( width(), '512' );
		expect( connector.trackEvent ).not.toHaveBeenCalled();
		await user.keyboard( '{Enter}' );
		fireEvent.blur( width() );
		expect( width() ).toHaveValue( '512' );
		expect( connector.trackEvent ).toHaveBeenCalledExactlyOnceWith(
			TRACKS_EVENTS.RESPONSIVE_PREVIEW_CHANGED,
			{
				action: 'manual_resize',
				preset_category: 'custom',
				width_bucket: 'under_600',
				height_bucket: '600_to_1023',
			}
		);
		await user.click( width() );
		await user.tab();
		for ( const invalid of [ '', '99', '3841', '400.5', 'abc' ] ) {
			await user.clear( width() );
			if ( invalid ) await user.type( width(), invalid );
			await user.tab();
		}
		await user.clear( width() );
		await user.type( width(), '900{Escape}' );
		expect( width() ).toHaveValue( '512' );
		expect( connector.trackEvent ).toHaveBeenCalledTimes( 1 );
		await user.clear( height() );
		await user.type( height(), '1000' );
		await user.tab();
		expect( height() ).toHaveValue( '1000' );
		expect( connector.trackEvent ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'buckets both dimensions at every boundary without suppressing changed sizes in one bucket', async () => {
		const { user, connector } = await setup( 'buckets' );
		for ( const input of [ width, height ] ) {
			for ( const [ value, bucket ] of [
				[ 599, 'under_600' ],
				[ 600, '600_to_1023' ],
				[ 1023, '600_to_1023' ],
				[ 1024, '1024_to_1439' ],
				[ 1439, '1024_to_1439' ],
				[ 1440, '1440_plus' ],
			] as const ) {
				await user.clear( input() );
				await user.type( input(), `${ value }{Enter}` );
				expect( connector.trackEvent ).toHaveBeenLastCalledWith(
					TRACKS_EVENTS.RESPONSIVE_PREVIEW_CHANGED,
					expect.objectContaining( {
						[ input === width ? 'width_bucket' : 'height_bucket' ]: bucket,
					} )
				);
			}
		}
		expect( connector.trackEvent ).toHaveBeenCalledTimes( 12 );
	} );

	it( 'emits once after a matching pointer release, never on movement or duplicate completion', async () => {
		const { connector } = await setup( 'pointer', { preset: 'iPhone 16e' } );
		const edge = rightHandle();
		pointer( edge, 'pointerdown' );
		for ( const x of [ 110, 200, 250 ] ) pointer( edge, 'pointermove', x );
		pointer( edge, 'pointerup', 250, 2 );
		expect( width() ).toHaveValue( '700' );
		expect( connector.trackEvent ).not.toHaveBeenCalled();
		pointer( edge, 'pointerup', 250 );
		pointer( edge, 'lostpointercapture', 250 );
		pointer( edge, 'pointerup', 250 );
		expect( connector.trackEvent ).toHaveBeenCalledExactlyOnceWith(
			TRACKS_EVENTS.RESPONSIVE_PREVIEW_CHANGED,
			{
				action: 'manual_resize',
				preset_category: 'custom',
				width_bucket: '600_to_1023',
				height_bucket: '600_to_1023',
			}
		);
	} );

	it.each( [ 'pointercancel', 'lostpointercapture', 'disabled', 'hidden', 'unmounted' ] )(
		'discards an unfinished resize when %s',
		async ( reason ) => {
			const { connector, siteId, unmount, user } = await setup( reason );
			const edge = rightHandle();
			pointer( edge, 'pointerdown' );
			pointer( edge, 'pointermove', 200 );
			if ( reason === 'disabled' )
				act( () => updateResponsivePreview( siteId, { enabled: false } ) );
			else if ( reason === 'hidden' )
				await user.click( screen.getByRole( 'button', { name: 'Hide preview' } ) );
			else if ( reason === 'unmounted' ) unmount();
			else pointer( edge, reason, 200 );
			pointer( edge, 'pointerup', 200 );
			expect( connector.trackEvent ).not.toHaveBeenCalled();
		}
	);

	it.each( [ 'unchanged', 'returned', 'clamped', 'secondary' ] )(
		'ignores a %s drag',
		async ( kind ) => {
			const { connector } = await setup( kind, { width: kind === 'clamped' ? 3840 : 400 } );
			const edge = rightHandle();
			pointer( edge, 'pointerdown', 100, 1, kind === 'secondary' ? 2 : 0 );
			if ( kind !== 'unchanged' ) pointer( edge, 'pointermove', 200 );
			if ( kind === 'returned' ) pointer( edge, 'pointermove', 100 );
			pointer( edge, 'pointerup', 200 );
			expect( connector.trackEvent ).not.toHaveBeenCalled();
		}
	);

	it( 'records keyboard repeats once on keyup or blur and preserves subsequent gestures', async () => {
		const { connector } = await setup( 'keyboard' );
		const edge = rightHandle();
		fireEvent.keyDown( edge, { key: 'ArrowRight' } );
		fireEvent.keyDown( edge, { key: 'ArrowRight', repeat: true } );
		fireEvent.keyDown( edge, { key: 'ArrowRight', repeat: true } );
		expect( width() ).toHaveValue( '403' );
		expect( connector.trackEvent ).not.toHaveBeenCalled();
		fireEvent.keyUp( edge, { key: 'ArrowRight' } );
		fireEvent.blur( edge );
		expect( connector.trackEvent ).toHaveBeenCalledTimes( 1 );
		fireEvent.keyDown( edge, { key: 'ArrowLeft', shiftKey: true } );
		fireEvent.blur( edge );
		fireEvent.keyUp( edge, { key: 'ArrowLeft' } );
		expect( width() ).toHaveValue( '393' );
		expect( connector.trackEvent ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'records rotation with the retained preset category and ignores square rotation', async () => {
		const { user, connector, siteId } = await setup( 'rotation', {
			preset: 'iPhone 16e',
			width: 390,
			height: 844,
		} );
		await user.click( screen.getByRole( 'button', { name: 'Rotate to landscape' } ) );
		expect( connector.trackEvent ).toHaveBeenCalledExactlyOnceWith(
			TRACKS_EVENTS.RESPONSIVE_PREVIEW_CHANGED,
			{
				action: 'manual_resize',
				preset_category: 'phone',
				width_bucket: '600_to_1023',
				height_bucket: 'under_600',
			}
		);
		act( () => updateResponsivePreview( siteId, { width: 400, height: 400 } ) );
		await user.click( screen.getByRole( 'button', { name: 'Rotate viewport' } ) );
		expect( connector.trackEvent ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'keeps restored state, programmatic changes, window resizing, Fit and zoom silent', async () => {
		const view = await setup( 'restored', { preset: 'iPad mini', width: 744, height: 1133 } );
		expect( view.connector.trackEvent ).not.toHaveBeenCalled();
		act( () =>
			updateResponsivePreview( view.siteId, { width: 1000, height: 700, fitScale: 0.8 } )
		);
		fireEvent( window, new Event( 'resize' ) );
		await view.user.click( screen.getByRole( 'button', { name: '100%' } ) );
		await view.user.click( await screen.findByRole( 'menuitemradio', { name: '75%' } ) );
		await view.user.click( screen.getByRole( 'button', { name: '75%' } ) );
		await view.user.click( await screen.findByRole( 'menuitemradio', { name: /Fit/ } ) );
		act( () => updateResponsivePreview( view.siteId, { enabled: false } ) );
		act( () => updateResponsivePreview( view.siteId, { enabled: true } ) );
		expect( view.connector.trackEvent ).not.toHaveBeenCalled();
		view.unmount();
		const restored = renderWithProviders( <Controls siteId={ view.siteId } /> );
		await screen.findByRole( 'toolbar', { name: 'Responsive preview' } );
		expect( width() ).toHaveValue( '1000' );
		expect( restored.connector.trackEvent ).not.toHaveBeenCalled();
	} );

	it( 'keeps preset selection and resize completion working when telemetry rejects or throws', async () => {
		const { user, connector } = await setup( 'failures' );
		connector.trackEvent.mockRejectedValueOnce( new Error( 'Offline' ) );
		await selectPreset( user, /^iPhone 16e/ );
		expect( width() ).toHaveValue( '390' );
		connector.trackEvent.mockImplementationOnce( () => {
			throw new Error( 'Unavailable' );
		} );
		const edge = rightHandle();
		pointer( edge, 'pointerdown' );
		pointer( edge, 'pointermove', 110 );
		expect( () => pointer( edge, 'pointerup', 110 ) ).not.toThrow();
		expect( width() ).toHaveValue( '410' );
	} );
} );
