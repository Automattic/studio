import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector, type FakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { PhonePanel } from './phone-panel';
import type { PairedPhone, PhoneAccessState, PhonePairingCode } from '@/data/core';

const ADDRESS = 'http://192.168.1.20:8082';
const QR_CODE = { name: 'QR code to pair the Studio phone app' };

function pairingCode( code: string, expiresAt = Date.now() + 5 * 60_000 ): PhonePairingCode {
	return {
		address: ADDRESS,
		code,
		expiresAt,
		qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
	};
}

function pairedPhone( overrides: Partial< PairedPhone > = {} ): PairedPhone {
	return {
		id: 'phone-1',
		name: 'Test iPhone',
		platform: 'ios',
		pairedAt: Date.now() - 60 * 60_000,
		lastSeenAt: Date.now() - 5 * 60_000,
		expiresAt: Date.now() + 30 * 24 * 60 * 60_000,
		...overrides,
	};
}

async function setup( connector = createFakeConnector() ) {
	const view = renderWithProviders( <PhonePanel />, { connector } );
	const toggle = await screen.findByRole( 'switch', { name: 'Let your phone connect' } );
	return { ...view, toggle };
}

async function setupOn( prepare: ( connector: FakeConnector ) => void = () => {} ) {
	const connector = createFakeConnector();
	await connector.setPhoneAccess( true );
	connector.setPhoneAccess.mockClear();
	prepare( connector );
	return setup( connector );
}

afterEach( () => {
	vi.useRealTimers();
} );

describe( 'Settings > Phone', () => {
	it( 'shows the warnings and no code while off, and the QR code, the address and the code once on', async () => {
		const { connector, queryClient, toggle } = await setup();
		expect( toggle ).not.toBeChecked();
		expect( screen.getByText( /Pair only devices you own\./ ) ).toBeVisible();
		expect( screen.getByText( /Use Tailscale or another VPN when you can\./ ) ).toBeVisible();
		expect( screen.queryByRole( 'img', QR_CODE ) ).not.toBeInTheDocument();
		expect( connector.getPhonePairingCode ).not.toHaveBeenCalled();

		fireEvent.click( toggle );

		expect( await screen.findByRole( 'img', QR_CODE ) ).toHaveAttribute(
			'src',
			expect.stringMatching( /^data:image\/svg\+xml;utf8,%3Csvg/ )
		);
		expect( connector.setPhoneAccess ).toHaveBeenCalledWith( true );
		expect( toggle ).toBeChecked();
		expect( screen.getByText( ADDRESS ) ).toBeVisible();
		expect( screen.getByText( 'ABCD-2345-EFGH' ) ).toBeVisible();
		expect( screen.getByText( /^Expires in (5:00|4:5\d)$/ ) ).toBeVisible();
		// The code stays out of the cache that the app writes to disk.
		expect(
			queryClient.getQueryCache().find( { queryKey: [ 'phone-pairing-code', ADDRESS ] } )?.meta
		).toEqual( { persist: false } );
	} );

	it( 'shows the switch on, a spinner, and nothing to change while remote mode starts', async () => {
		const { connector, toggle } = await setup();
		let finish!: ( state: PhoneAccessState ) => void;
		connector.setPhoneAccess.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					finish = resolve;
				} )
		);

		fireEvent.click( toggle );

		expect( await screen.findByRole( 'status', { name: 'Starting remote mode' } ) ).toBeVisible();
		expect( toggle ).toBeChecked();
		expect( toggle ).toHaveAttribute( 'aria-disabled', 'true' );
		await act( async () => finish( { status: 'on', url: ADDRESS, portChanged: false } ) );
		expect( await screen.findByRole( 'img', QR_CODE ) ).toBeVisible();
		expect(
			screen.queryByRole( 'status', { name: 'Starting remote mode' } )
		).not.toBeInTheDocument();
	} );

	it( 'stops remote mode and drops the code when turned off', async () => {
		const { connector, toggle } = await setupOn();
		await screen.findByRole( 'img', QR_CODE );

		fireEvent.click( toggle );

		await waitFor( () => expect( toggle ).not.toBeChecked() );
		expect( connector.setPhoneAccess ).toHaveBeenCalledWith( false );
		expect( screen.queryByRole( 'img', QR_CODE ) ).not.toBeInTheDocument();

		// On again: a new code, not the one from before.
		fireEvent.click( toggle );
		await screen.findByRole( 'img', QR_CODE );
		expect( connector.getPhonePairingCode ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'says when remote mode could not stop, and tries to stop it again', async () => {
		const { connector, toggle } = await setupOn();
		await screen.findByRole( 'img', QR_CODE );
		connector.setPhoneAccess.mockRejectedValueOnce( new Error( 'Permission denied' ) );

		fireEvent.click( toggle );

		expect( await screen.findByText( 'Remote mode could not stop.' ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
		await waitFor( () => expect( connector.setPhoneAccess ).toHaveBeenLastCalledWith( false ) );
		await waitFor( () => expect( toggle ).not.toBeChecked() );
		expect( screen.queryByText( 'Remote mode could not stop.' ) ).not.toBeInTheDocument();
	} );

	it( 'shows the code of a remote mode started in a terminal, with a switch that cannot stop it', async () => {
		const connector = createFakeConnector();
		connector.getPhoneAccess.mockResolvedValue( {
			status: 'terminal',
			url: 'http://192.168.1.20:8098',
		} );
		const { toggle } = await setup( connector );

		expect( toggle ).toBeChecked();
		expect( toggle ).toHaveAttribute( 'aria-disabled', 'true' );
		expect(
			screen.getByText( 'Remote mode was started in a terminal, and stops there.' )
		).toBeVisible();
		expect( await screen.findByRole( 'img', QR_CODE ) ).toBeVisible();
		fireEvent.click( toggle );
		// A mutation calls the connector a few ticks after the click.
		await act( () => new Promise( ( resolve ) => setTimeout( resolve, 50 ) ) );
		expect( connector.setPhoneAccess ).not.toHaveBeenCalled();
	} );

	it( 'says when phones paired before must pair again', async () => {
		const connector = createFakeConnector();
		connector.getPhoneAccess.mockResolvedValue( { status: 'on', url: ADDRESS, portChanged: true } );
		await setup( connector );

		expect(
			screen.getByText(
				'The port Studio used before is taken, so it uses another one. Phones paired before must pair again.'
			)
		).toBeVisible();
	} );

	it( 'shows why remote mode stopped, and tries again', async () => {
		const connector = createFakeConnector();
		connector.getPhoneAccess.mockResolvedValueOnce( {
			status: 'error',
			message: 'No network address found. Connect this computer to a network, then try again.',
		} );
		const { toggle } = await setup( connector );

		expect( toggle ).not.toBeChecked();
		expect(
			screen.getByText(
				'No network address found. Connect this computer to a network, then try again.'
			)
		).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );

		expect( await screen.findByRole( 'img', QR_CODE ) ).toBeVisible();
		expect( connector.setPhoneAccess ).toHaveBeenCalledWith( true );
		expect(
			screen.queryByText(
				'No network address found. Connect this computer to a network, then try again.'
			)
		).not.toBeInTheDocument();
	} );

	it( 'makes a new code when one runs out, on New code, and when a phone used it', async () => {
		// Time stands still unless the test moves it, so a code's fetch time is known.
		vi.useFakeTimers( { toFake: [ 'Date' ] } );
		let second!: ( code: PhonePairingCode ) => void;
		const { connector, queryClient } = await setupOn( ( fake ) =>
			fake.getPhonePairingCode
				.mockResolvedValueOnce( pairingCode( 'AAAA-AAAA-AAAA', Date.now() - 1 ) )
				.mockImplementationOnce(
					() =>
						new Promise( ( resolve ) => {
							second = resolve;
						} )
				)
				.mockResolvedValueOnce( pairingCode( 'CCCC-CCCC-CCCC' ) )
				.mockResolvedValueOnce( pairingCode( 'DDDD-DDDD-DDDD' ) )
		);

		// The expired code is never shown while the next one comes.
		await waitFor( () => expect( connector.getPhonePairingCode ).toHaveBeenCalledTimes( 2 ) );
		expect( screen.queryByText( 'AAAA-AAAA-AAAA' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Loading…' ) ).toBeVisible();
		await act( async () => second( pairingCode( 'BBBB-BBBB-BBBB' ) ) );
		expect( await screen.findByText( 'BBBB-BBBB-BBBB' ) ).toBeVisible();

		// One live region for every code, so a screen reader hears each new one.
		const live = screen.getByText( 'Pairing code BBBB-BBBB-BBBB' );
		expect( live ).toHaveAttribute( 'aria-live', 'polite' );

		fireEvent.click( screen.getByRole( 'button', { name: 'New code' } ) );
		expect( await screen.findByText( 'CCCC-CCCC-CCCC' ) ).toBeVisible();

		const shownAt = Date.now();
		vi.setSystemTime( shownAt + 10_000 );
		connector.getPairedPhones.mockResolvedValue( [ pairedPhone( { pairedAt: shownAt + 5_000 } ) ] );
		await act( () => queryClient.invalidateQueries( { queryKey: [ 'paired-phones' ] } ) );

		expect( await screen.findByText( 'DDDD-DDDD-DDDD' ) ).toBeVisible();
		expect( connector.getPhonePairingCode ).toHaveBeenCalledTimes( 4 );
		expect( live ).toHaveTextContent( 'Pairing code DDDD-DDDD-DDDD' );
	} );

	it( 'lists the paired phones in every state and removes one', async () => {
		const connector = createFakeConnector();
		connector.getPairedPhones.mockResolvedValue( [ pairedPhone() ] );
		await setup( connector );

		const name = await screen.findByText( 'Test iPhone' );
		expect( name.closest( '[data-settings-row]' ) ).toHaveTextContent( 'iOS · Last seen 5m ago' );
		connector.getPairedPhones.mockResolvedValue( [] );
		fireEvent.click( screen.getByRole( 'button', { name: 'Remove Test iPhone' } ) );

		expect( await screen.findByText( 'No phones paired yet' ) ).toBeVisible();
		expect( connector.removePairedPhone ).toHaveBeenCalledWith( 'phone-1' );
	} );

	it( 'says when it cannot read the paired phones, instead of listing none', async () => {
		const connector = createFakeConnector();
		connector.getPairedPhones.mockRejectedValue( new Error( 'EACCES' ) );
		await setup( connector );

		expect( await screen.findByText( 'Couldn’t read the paired phones.' ) ).toBeVisible();
		expect( screen.queryByText( 'No phones paired yet' ) ).not.toBeInTheDocument();
	} );
} );
