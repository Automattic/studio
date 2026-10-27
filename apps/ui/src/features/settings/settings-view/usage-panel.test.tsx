import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { UsagePanel } from './usage-panel';
import type { Connector } from '@/data/core';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';

const ALPHA =
	'AI credits are currently free while Studio Code is in Alpha. Build, iterate, and experiment, but know that credits will eventually have a cost.';
const MONTHLY = '25% of monthly limit used (resets on August 1, 2026)';
const RESET_DATE = '2026-08-01T12:00:00';
const BALANCES = {
	hasPaymentMethod: true,
	costUsage: 0,
	costCap: 0,
	allowanceRemaining: 960000,
	purchasedRemaining: 0,
};

function setup( {
	quota = null,
	signedIn = true,
	overrides = {},
}: {
	quota?: Partial< StudioAssistantQuota > | null;
	signedIn?: boolean;
	overrides?: Partial< Connector >;
} = {} ) {
	const connector = createFakeConnector( signedIn ? {} : { user: null }, {
		getStudioAssistantQuota: async () => quota as StudioAssistantQuota | null,
		getSnapshotUsage: async () => ( { siteCount: 2, siteLimit: 10, siteCreationBlocked: false } ),
		...overrides,
	} );
	return renderWithProviders( <UsagePanel />, { connector } );
}

const openPreviewActions = async () => {
	await screen.findByText( '2 of 10 active preview sites' );
	fireEvent.click( screen.getByRole( 'button', { name: 'Preview site actions' } ) );
	fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Delete all preview sites' } ) );
};

describe( 'Usage settings', () => {
	it.each< [ string, Partial< StudioAssistantQuota > | null, ( string | RegExp )[], RegExp[] ] >( [
		[ 'the Alpha copy without a quota', null, [ ALPHA ], [ /monthly limit/ ] ],
		[
			'the monthly limit with its reset date',
			{ costUsage: 25, costCap: 100, costResetDate: RESET_DATE },
			[ MONTHLY ],
			[ /in Alpha/, /credits remaining/ ],
		],
		[
			'the monthly limit without a reset date',
			{ costUsage: 25, costCap: 100 },
			[ '25% of monthly limit used' ],
			[ /resets on/ ],
		],
		[ 'the Alpha copy without a cost cap', { costUsage: 0, costCap: 0 }, [ ALPHA ], [] ],
		[
			'one meter across both credit pools',
			{
				...BALANCES,
				costUsage: 25,
				costCap: 1500000,
				purchasedRemaining: 150000,
				purchasedAtTopUp: 500000,
			},
			[ '1,110,000 credits remaining', '44.5% used' ],
			[ /monthly limit/, /in Alpha/ ],
		],
		[
			'the allowance welcome for a never-bought account',
			{ ...BALANCES, costCap: 1500000, allowanceRemaining: 1400000, purchasedAtTopUp: 0 },
			[ '1,400,000 credits remaining', 'Your first 1,500,000 AI credits are on us.' ],
			[],
		],
		[
			'a full meter for exhausted pools',
			{
				...BALANCES,
				costUsage: 25,
				costCap: 1500000,
				allowanceRemaining: 0,
				purchasedAtTopUp: 500000,
			},
			[
				'0 credits remaining',
				'100% used',
				'Your next idea is ready when you are. Top up to bring it to life.',
			],
			[],
		],
		[
			'plain known figures when no bar can be drawn',
			{ ...BALANCES, purchasedRemaining: undefined, purchasedAtTopUp: 500000 },
			[ 'Free credits remaining: 960,000' ],
			[ /Purchased credits remaining/ ],
		],
		[
			'normal usage when a default-allow policy grants access',
			{
				costUsage: 25,
				costCap: 100,
				costResetDate: RESET_DATE,
				studioCodeAiHasAccess: true,
				studioCodeAiAccess: 'default',
			},
			[ MONTHLY ],
			[],
		],
		[
			'the beta-required copy for an ungranted account that spent this cycle',
			{ costUsage: 3, costCap: 100, studioCodeAiHasAccess: false, studioCodeAiAccess: 'default' },
			[ /Thanks for participating in the Studio Code AI beta/ ],
			[],
		],
	] )( 'shows %s', async ( _name, quota, shown, hidden ) => {
		setup( { quota } );
		expect( await screen.findByText( shown[ 0 ] ) ).toBeVisible();
		for ( const text of shown.slice( 1 ) ) {
			expect( screen.getByText( text ) ).toBeVisible();
		}
		for ( const text of hidden ) {
			expect( screen.queryByText( text ) ).not.toBeInTheDocument();
		}
	} );

	it.each< [ string, Partial< StudioAssistantQuota >, boolean ] >( [
		[ 'with credit balances and a payment method', BALANCES, true ],
		[ 'without a payment method', { ...BALANCES, hasPaymentMethod: false }, false ],
		[
			'before credit balances exist',
			{ costUsage: 25, costCap: 100, costResetDate: RESET_DATE },
			false,
		],
	] )( 'shows Buy credits only for an account %s', async ( _name, quota, offered ) => {
		setup( { quota } );
		await screen.findAllByText( /credits remaining|monthly limit/ );
		expect( !! screen.queryByRole( 'button', { name: 'Buy credits' } ) ).toBe( offered );
	} );

	it( 'explains AI credits in a dialog from the help icon', async () => {
		setup( { quota: BALANCES } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'How AI credits work' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'How AI credits work' } ) ).toBeVisible();
	} );

	it( 'lets a blocked account take precedence over its credit balances', async () => {
		setup( {
			quota: { ...BALANCES, studioCodeAiHasAccess: false, studioCodeAiAccess: 'blocked' },
		} );
		expect(
			await screen.findByText( /Studio Code AI is blocked for this WordPress.com account/ )
		).toBeVisible();
		expect( screen.getByRole( 'link', { name: 'contact WordPress.com support' } ) ).toHaveAttribute(
			'href',
			'https://wordpress.com/support/contact/'
		);
		expect( screen.queryByText( /Free credits remaining/ ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Buy credits' } ) ).not.toBeInTheDocument();
	} );

	it( 'asks an ungranted default account to request beta access', async () => {
		setup( {
			quota: {
				costUsage: 0,
				costCap: 100,
				studioCodeAiHasAccess: false,
				studioCodeAiAccess: 'default',
			},
		} );
		expect(
			await screen.findByText( /Studio Code AI is currently available through limited beta access/ )
		).toBeVisible();
		expect(
			screen.getByRole( 'link', { name: 'developer.wordpress.com/studio/studio-code-beta' } )
		).toHaveAttribute( 'href', 'https://developer.wordpress.com/studio/studio-code-beta/' );
		expect(
			screen.queryByText( /is blocked for this WordPress.com account/ )
		).not.toBeInTheDocument();
	} );

	it( 'offers Try again when the quota cannot be read', async () => {
		const { connector } = setup();
		connector.getStudioAssistantQuota.mockRejectedValueOnce( new Error( 'Unavailable' ) );
		expect( await screen.findByText( 'AI usage is currently unavailable.' ) ).toBeVisible();
		expect( screen.queryByText( ALPHA ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
		expect( await screen.findByText( ALPHA ) ).toBeVisible();
	} );

	it( 'shows a loading row while the quota loads', async () => {
		setup( { overrides: { getStudioAssistantQuota: () => new Promise( () => {} ) } } );
		await screen.findByText( '2 of 10 active preview sites' );
		expect( screen.getByText( 'Loading…' ) ).toBeVisible();
	} );

	it( 'confirms before deleting all preview sites and shows the cleared count', async () => {
		let finish!: () => void;
		const { connector } = setup( {
			overrides: {
				deleteAllSnapshots: () =>
					new Promise< void >( ( resolve ) => {
						finish = resolve;
					} ),
			},
		} );
		await openPreviewActions();
		await waitFor( () => expect( connector.deleteAllSnapshots ).toHaveBeenCalledOnce() );
		expect( connector.confirmDeleteAllPreviewSites ).toHaveBeenCalledOnce();
		expect( await screen.findByText( 'Loading…' ) ).toBeVisible();
		await act( async () => finish() );
		expect( await screen.findByText( '0 of 10 active preview sites' ) ).toBeVisible();
	} );

	it( 'does not delete when the confirmation is declined', async () => {
		const { connector } = setup( {
			overrides: { confirmDeleteAllPreviewSites: async () => false },
		} );
		await openPreviewActions();
		await waitFor( () => expect( connector.confirmDeleteAllPreviewSites ).toHaveBeenCalledOnce() );
		expect( connector.deleteAllSnapshots ).not.toHaveBeenCalled();
	} );

	it( 'reports a failed deletion inline', async () => {
		setup( {
			overrides: { deleteAllSnapshots: async () => Promise.reject( new Error( 'Failed' ) ) },
		} );
		await openPreviewActions();
		expect(
			await screen.findByText(
				'An error occurred while deleting all preview sites. Please try again.'
			)
		).toBeVisible();
	} );

	it( 'replaces figures and actions with the offline notice while offline', async () => {
		const online = vi.spyOn( navigator, 'onLine', 'get' ).mockReturnValue( false );
		try {
			setup( { quota: { costUsage: 25, costCap: 100, costResetDate: RESET_DATE } } );
			expect( await screen.findByRole( 'status' ) ).toHaveTextContent( "You're offline" );
			expect( screen.getAllByRole( 'img', { name: 'Unavailable' } ) ).toHaveLength( 2 );
			expect( screen.queryByText( /monthly limit/ ) ).not.toBeInTheDocument();
			expect( screen.queryByText( /active preview site/ ) ).not.toBeInTheDocument();
			expect(
				screen.queryByRole( 'button', { name: 'Preview site actions' } )
			).not.toBeInTheDocument();
			expect( screen.queryByLabelText( 'Sign in to WordPress Studio' ) ).not.toBeInTheDocument();
		} finally {
			online.mockRestore();
		}
	} );

	it( 'asks a signed-out user to log in instead of showing figures', async () => {
		const { connector } = setup( { signedIn: false } );
		expect( await screen.findByLabelText( 'Sign in to WordPress Studio' ) ).toBeVisible();
		expect( screen.getAllByRole( 'img', { name: 'Unavailable' } ) ).toHaveLength( 2 );
		expect( screen.queryByText( ALPHA ) ).not.toBeInTheDocument();
		expect( screen.queryByText( /active preview site/ ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Log in with WordPress.com' } ) );
		await waitFor( () => expect( connector.authenticate ).toHaveBeenCalled() );
	} );
} );
