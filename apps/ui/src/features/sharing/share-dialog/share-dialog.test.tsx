import { DAY_MS } from '@studio/common/constants';
import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getNoticeHistory, resetAppMessagesForTests, runNoticeAction } from '@/data/app-messages';
import { useSites } from '@/data/queries/use-sites';
import { createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { ShareButton } from './index';
import type { AuthUser, Connector, SiteDetails, Snapshot } from '@/data/core';

// Sync activity and the ready marker outlive a render, so every test shares its own site.
let siteCount = 0;

function preview( overrides: Partial< Snapshot > = {} ): Snapshot {
	return {
		atomicSiteId: 1,
		localSiteId: 'one',
		userId: 1,
		url: 'preview.example.com',
		name: 'My site preview',
		date: Date.now(),
		...overrides,
	};
}

function createSiteStore( initial: SiteDetails ) {
	let site = initial;
	const listeners = new Set< () => void >();
	return {
		get: () => site,
		subscribe: ( listener: () => void ) => {
			listeners.add( listener );
			return () => listeners.delete( listener );
		},
		set: ( next: SiteDetails ) =>
			act( () => {
				site = next;
				listeners.forEach( ( listener ) => listener() );
			} ),
	};
}

function setup(
	initialUser: AuthUser | null = TEST_USER,
	initialSnapshots: Snapshot[] = [],
	overrides: Partial< Connector > = {}
) {
	const site = makeSite( { id: `one-${ ++siteCount }`, name: 'My site' } );
	const own = ( snapshot: Snapshot ) =>
		snapshot.localSiteId === 'one' ? { ...snapshot, localSiteId: site.id } : snapshot;
	let snapshots = initialSnapshots.map( own );
	const connector = createFakeConnector(
		{ sites: [ site, makeSite( { id: 'two', name: 'My site' } ) ], user: initialUser },
		{
			getSnapshots: async () => snapshots,
			publishPreviewSite: async ( siteId: string, hostname?: string, name?: string ) => {
				if ( hostname ) {
					snapshots = snapshots.map( ( item ) =>
						item.url === hostname ? { ...item, date: Date.now() } : item
					);
					return { url: `https://${ hostname }` };
				}
				snapshots = [
					...snapshots,
					preview( {
						localSiteId: siteId,
						atomicSiteId: snapshots.length + 1,
						name: name || 'My site preview',
					} ),
				];
				return { url: 'https://preview.example.com' };
			},
			deleteSnapshot: async () => {
				snapshots = [];
			},
			getPublishCheckoutUrl: () => 'https://wordpress.com/setup/new-hosted-site?ref=studio',
			...overrides,
		}
	);
	const store = createSiteStore( site );
	function Harness() {
		useSites();
		const current = useSyncExternalStore( store.subscribe, store.get );
		return <ShareButton site={ current } />;
	}
	const view = renderWithProviders( <Harness />, { connector } );
	const ready = screen.findByRole( 'button', { name: 'Share' } ).then( ( trigger ) => {
		trigger.focus();
		fireEvent.click( trigger );
		return trigger;
	} );
	return {
		...view,
		connector,
		site,
		ready,
		changeUser: ( next: AuthUser | null ) => {
			connector.state.user = next;
			act( () => connector.emit( 'onAuthStateChanged' ) );
		},
		changeSnapshots: ( next: Snapshot[] ) => {
			snapshots = next.map( own );
			act( () =>
				connector.emit( 'onSnapshotEvent', {
					event: SNAPSHOT_EVENTS.UPDATED,
					snapshot: snapshots[ 0 ],
					snapshotUrl: 'preview.example.com',
				} )
			);
		},
		rerender: ( nextSite: SiteDetails ) => store.set( nextSite ),
	};
}

async function shareButton( name = 'Create preview' ) {
	const dialog = await screen.findByRole( 'dialog' );
	const button = await within( dialog ).findByRole( 'button', { name } );
	await waitFor( () => expect( button ).toBeEnabled() );
	return button;
}

const isPublishing = ( trigger: HTMLElement ) =>
	trigger.getAttribute( 'aria-description' ) === 'Publishing preview…';
const isUnread = ( trigger: HTMLElement ) =>
	!! trigger.querySelector( '[data-slot="notification-dot"]' );
const isDisabled = ( element: HTMLElement ) =>
	element.hasAttribute( 'disabled' ) || element.getAttribute( 'aria-disabled' ) === 'true';
const failure = ( description: string ) =>
	waitFor(
		() =>
			expect( getNoticeHistory() ).toContainEqual(
				expect.objectContaining( { intent: 'error', description } )
			),
		SETTLE
	);
const shareTrigger = () => screen.getByRole( 'button', { name: 'Share' } );
const SETTLE = { timeout: 3000 };

beforeEach( () => {
	resetAppMessagesForTests();
} );

describe( 'ShareDialog', () => {
	it( 'opens checkout while the browser return watcher is still starting', async () => {
		let finishWatching!: () => void;
		const { connector, ready, site } = setup( TEST_USER, [ preview() ], {
			watchForPublishedSite: vi.fn(
				() =>
					new Promise< void >( ( resolve ) => {
						finishWatching = resolve;
					} )
			),
		} );
		await ready;
		fireEvent.click( await screen.findByRole( 'button', { name: 'Choose a plan' } ) );
		await waitFor( () =>
			expect( connector.openExternalUrl ).toHaveBeenCalledWith(
				'https://wordpress.com/setup/new-hosted-site?ref=studio'
			)
		);
		expect( connector.watchForPublishedSite ).toHaveBeenCalledExactlyOnceWith( site.id );
		await act( async () => finishWatching() );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
	} );

	it( 'keeps the dialog open with the reason when checkout cannot open', async () => {
		const { connector, ready } = setup( TEST_USER, [ preview() ] );
		connector.openExternalUrl.mockRejectedValueOnce( new Error( 'Unable to open checkout' ) );
		await ready;
		fireEvent.click( await screen.findByRole( 'button', { name: 'Choose a plan' } ) );
		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent( 'Unable to open checkout' );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Choose a plan' } ) );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
	} );

	it( 'renames a preview, and shows a new one publishing from the preview actions', async () => {
		const actions = userEvent.setup();
		const { connector, ready, site } = setup( TEST_USER, [ preview() ] );
		let finish!: ( value: { url: string } ) => void;
		await ready;
		await actions.click( await screen.findByRole( 'button', { name: 'Preview actions' } ) );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Rename…' } ) );
		const name = screen.getByLabelText( 'Preview name' );
		await actions.clear( name );
		await actions.type( name, 'Homepage draft{Enter}' );
		expect( connector.renameSnapshot ).toHaveBeenCalledWith(
			'preview.example.com',
			'Homepage draft'
		);

		connector.publishPreviewSite.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					finish = resolve;
				} )
		);
		await actions.click( screen.getByRole( 'button', { name: 'Preview actions' } ) );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'New preview' } ) );
		expect( connector.publishPreviewSite ).toHaveBeenCalledWith( site.id, undefined, undefined );
		expect( await screen.findByRole( 'button', { name: 'Publishing preview…' } ) ).toBeVisible();
		await actions.click( screen.getByRole( 'combobox', { name: 'Select preview' } ) );
		expect(
			await screen.findByRole( 'option', { name: 'New preview · Publishing…' } )
		).toBeInTheDocument();
		await actions.click( screen.getByRole( 'option', { name: 'My site preview' } ) );
		expect( await screen.findByRole( 'button', { name: 'Copy link' } ) ).toBeVisible();
		await act( async () => finish( { url: 'https://new.example.com' } ) );
	} );

	it( 'hides Upgrade only after confirming the connected site has an eligible active plan', async () => {
		const { connector, ready, site } = setup( TEST_USER, [ preview() ], {
			getConnectedWpcomSites: vi.fn().mockResolvedValue( [ { id: 42 } ] ),
			fetchSyncableWpcomSites: vi
				.fn()
				.mockResolvedValue( [ { id: 42, hasStudioPublishingPlan: true, isPressable: false } ] ),
		} );
		await ready;
		await screen.findByRole( 'button', { name: 'Copy link' } );
		await waitFor( () =>
			expect( connector.getConnectedWpcomSites ).toHaveBeenCalledWith( site.id )
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'button', { name: 'Choose a plan' } ) ).not.toBeInTheDocument()
		);
	} );

	it.each( [ false, undefined ] )(
		'keeps Upgrade for a connected site with plan eligibility %s',
		async ( eligible ) => {
			const { connector, ready } = setup( TEST_USER, [ preview() ], {
				getConnectedWpcomSites: vi
					.fn()
					.mockResolvedValue( [ { id: 42, hasStudioPublishingPlan: true } ] ),
				fetchSyncableWpcomSites: vi.fn().mockResolvedValue( [
					{ id: 42, hasStudioPublishingPlan: eligible },
					{ id: 99, hasStudioPublishingPlan: true },
				] ),
			} );
			await ready;
			await waitFor( () => expect( connector.fetchSyncableWpcomSites ).toHaveBeenCalled() );
			expect( await screen.findByRole( 'button', { name: 'Choose a plan' } ) ).toBeVisible();
		}
	);

	it( 'hides the upgrade prompt when checkout is unavailable', async () => {
		const { ready } = setup( TEST_USER, [ preview() ], {
			getPublishCheckoutUrl: vi.fn( () => undefined ),
		} );
		await ready;
		await screen.findByRole( 'button', { name: 'Copy link' } );
		expect( screen.queryByRole( 'button', { name: 'Choose a plan' } ) ).not.toBeInTheDocument();
	} );

	it( 'shows the full selectable preview URL', async () => {
		const { ready } = setup( TEST_USER, [ preview() ] );
		await ready;
		const input = await screen.findByRole( 'textbox', { name: 'Preview link' } );
		expect( input ).toHaveValue( 'https://preview.example.com' );
		expect( input ).toHaveAttribute( 'readonly' );
		fireEvent.focus( input );
		expect( ( input as HTMLInputElement ).selectionStart ).toBe( 0 );
		expect( ( input as HTMLInputElement ).selectionEnd ).toBe(
			'https://preview.example.com'.length
		);
	} );

	it( 'keeps publishing on the Share button after dismissal and clears ready on opening without copying', async () => {
		const { connector, ready } = setup();
		const original = connector.publishPreviewSite.getMockImplementation()!;
		let finish!: () => void;
		connector.publishPreviewSite.mockImplementationOnce( async ( ...args ) => {
			await new Promise< void >( ( resolve ) => {
				finish = resolve;
			} );
			return original( ...args );
		} );
		await ready;
		fireEvent.click( await shareButton() );
		await screen.findByText( 'Publishing preview…' );
		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		const trigger = shareTrigger();
		expect( isPublishing( trigger ) ).toBe( true );
		fireEvent.click( trigger );
		await screen.findByText( 'Publishing preview…' );
		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await act( async () => finish() );
		await waitFor( () => expect( isUnread( trigger ) ).toBe( true ), SETTLE );
		expect( isPublishing( trigger ) ).toBe( false );
		expect( trigger ).toHaveAccessibleDescription( 'Preview ready' );
		expect( getNoticeHistory()[ 0 ].title ).toBe( 'Preview link is ready' );
		fireEvent.click( trigger );
		await screen.findByRole( 'button', { name: 'Copy link' } );
		await waitFor( () => expect( isUnread( trigger ) ).toBe( false ) );
		expect( connector.copyText ).not.toHaveBeenCalled();
		expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'allows copying from the completion notification to acknowledge a closed preview', async () => {
		const { connector, ready } = setup();
		const original = connector.publishPreviewSite.getMockImplementation()!;
		let finish!: () => void;
		connector.publishPreviewSite.mockImplementationOnce( async ( ...args ) => {
			await new Promise< void >( ( resolve ) => {
				finish = resolve;
			} );
			return original( ...args );
		} );
		await ready;
		fireEvent.click( await shareButton() );
		await screen.findByText( 'Publishing preview…' );
		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await act( async () => finish() );
		await waitFor( () => expect( getNoticeHistory() ).toHaveLength( 1 ), SETTLE );
		await act( async () => {
			await runNoticeAction( getNoticeHistory()[ 0 ].action! );
		} );
		await waitFor( () =>
			expect( connector.copyText ).toHaveBeenCalledWith( 'https://preview.example.com' )
		);
		await waitFor( () => expect( isUnread( shareTrigger() ) ).toBe( false ) );
	} );

	it.each( [ 'Escape', 'its close button' ] )(
		'closes with %s and restores focus to Share',
		async ( method ) => {
			const { ready } = setup( null );
			await ready;
			const login = await screen.findByRole( 'button', { name: 'Create account' } );
			expect( screen.queryByRole( 'button', { name: 'Share' } ) ).not.toBeInTheDocument();
			expect( screen.getByRole( 'heading', { name: 'Share your WordPress' } ) ).toBeVisible();
			expect(
				screen.getByText(
					'Create an account or log in to share previews and keep your sites in sync.'
				)
			).toBeVisible();
			if ( method === 'Escape' ) {
				fireEvent.keyDown( login, { key: 'Escape' } );
			} else {
				fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
			}
			await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
			await waitFor( () => expect( shareTrigger() ).toHaveFocus() );
		}
	);

	it( 'disables both account actions during login and keeps the prompt after cancellation', async () => {
		const { connector, ready } = setup( null );
		let finish!: () => void;
		connector.authenticate.mockImplementationOnce(
			() =>
				new Promise< void >( ( resolve ) => {
					finish = resolve;
				} )
		);
		await ready;
		const login = await screen.findByRole( 'button', { name: 'Log in to WordPress.com' } );
		const signup = screen.getByRole( 'button', { name: 'Create account' } );
		fireEvent.click( login );
		await waitFor( () => expect( isDisabled( login ) ).toBe( true ) );
		expect( isDisabled( signup ) ).toBe( true );
		fireEvent.click( signup );
		expect( connector.authenticate ).toHaveBeenCalledExactlyOnceWith( false, 'previews_tab' );
		await act( async () => finish() );
		await waitFor( () => expect( isDisabled( login ) ).toBe( false ) );
		expect( isDisabled( signup ) ).toBe( false );
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	} );

	it( 'copies this account’s selected preview without exposing its URL or extra controls', async () => {
		const { connector, ready } = setup( TEST_USER, [
			preview(),
			preview( {
				atomicSiteId: 2,
				date: Date.now() + 1000,
				url: 'new.example.com',
				name: 'Latest preview',
			} ),
			preview( {
				atomicSiteId: 3,
				localSiteId: 'other',
				url: 'other.example.com',
				name: 'Other site',
			} ),
			preview( {
				atomicSiteId: 4,
				userId: 2,
				url: 'private.example.com',
				name: 'Private preview',
			} ),
		] );
		await ready;
		await screen.findByRole( 'button', { name: 'Copy link' } );
		const actions = userEvent.setup();
		await waitFor( () =>
			expect( screen.getByRole( 'combobox', { name: 'Select preview' } ) ).toBeEnabled()
		);
		await actions.click( screen.getByRole( 'combobox', { name: 'Select preview' } ) );
		expect( await screen.findAllByRole( 'option' ) ).toHaveLength( 2 );
		expect( screen.queryByRole( 'option', { name: 'Other site' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'option', { name: 'Private preview' } ) ).not.toBeInTheDocument();
		await actions.click( screen.getByRole( 'option', { name: 'Latest preview' } ) );
		fireEvent.click( screen.getAllByRole( 'button', { name: 'Copy link' } )[ 0 ] );
		await waitFor( () =>
			expect( connector.copyText ).toHaveBeenCalledWith( 'https://new.example.com' )
		);
		expect( await screen.findByRole( 'button', { name: 'Copied' } ) ).toBeVisible();
		expect( getNoticeHistory() ).toHaveLength( 0 );
		expect( screen.queryByText( 'new.example.com' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Open preview' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'View QR code' } ) ).not.toBeInTheDocument();
		expect(
			screen.queryByText( 'Local site preview — shared snapshot may differ.' )
		).not.toBeInTheDocument();
		expect(
			within( screen.getByRole( 'dialog' ) ).queryByRole( 'button', { name: 'Share' } )
		).not.toBeInTheDocument();
	} );

	it( 'surfaces publish failures and permits retry', async () => {
		const { connector, ready } = setup();
		connector.publishPreviewSite.mockRejectedValueOnce( new Error( 'Quota exceeded' ) );
		await ready;
		fireEvent.click( await shareButton() );
		await failure( 'Quota exceeded' );
		fireEvent.click( await shareButton( 'Try again' ) );
		await screen.findByRole( 'button', { name: 'Copy link' }, SETTLE );
		expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'refreshes events and isolates account and site switches', async () => {
		const { connector, changeUser, changeSnapshots, rerender, ready } = setup( TEST_USER, [
			preview(),
		] );
		await ready;
		await screen.findByRole( 'button', { name: 'Copy link' } );
		changeSnapshots( [ preview( { url: 'changed.example.com', name: 'Changed preview' } ) ] );
		await waitFor( () =>
			expect( screen.getByRole( 'textbox', { name: 'Preview link' } ) ).toHaveValue(
				'https://changed.example.com'
			)
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Copy link' } ) );
		await waitFor( () =>
			expect( connector.copyText ).toHaveBeenCalledWith( 'https://changed.example.com' )
		);
		rerender( makeSite( { id: 'two', name: 'My site' } ) );
		await shareButton();
		expect( screen.queryByText( 'Changed preview' ) ).not.toBeInTheDocument();
		changeUser( null );
		await screen.findByRole( 'button', { name: 'Create account' } );
		expect( screen.queryByText( 'Changed preview' ) ).not.toBeInTheDocument();
	} );

	it( 'opens sharing documentation without starting another publication', async () => {
		const { connector, ready } = setup( TEST_USER, [ preview() ] );
		await ready;
		await screen.findByRole( 'button', { name: 'Copy link' } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Learn more' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith(
			'https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/'
		);
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	} );

	it( 'reuses the local thumbnail and does not block copying if it fails', async () => {
		const { connector, ready, site } = setup( TEST_USER, [ preview() ] );
		connector.getSiteThumbnail.mockRejectedValueOnce( new Error( 'No image' ) );
		await ready;
		await screen.findByText( 'Preview image unavailable' );
		expect( connector.getSiteThumbnail ).toHaveBeenCalledWith( site.id );
		fireEvent.click( screen.getByRole( 'button', { name: 'Copy link' } ) );
		await waitFor( () =>
			expect( connector.copyText ).toHaveBeenCalledWith( 'https://preview.example.com' )
		);
	} );

	it( 'copies the selected preview and retries updates to that same preview', async () => {
		const actions = userEvent.setup();
		const { connector, ready, site } = setup( TEST_USER, [
			preview( { name: 'Current' } ),
			preview( {
				atomicSiteId: 2,
				date: Date.now() - 8 * DAY_MS,
				name: 'Old',
				url: 'old.example.com',
			} ),
			preview( {
				atomicSiteId: 3,
				date: Date.now() - DAY_MS,
				name: 'Earlier',
				url: 'earlier.example.com',
			} ),
		] );
		await ready;
		await screen.findByRole( 'button', { name: 'Copy link' } );
		await actions.click( screen.getByRole( 'combobox', { name: 'Select preview' } ) );
		await actions.click( await screen.findByRole( 'option', { name: 'Earlier' } ) );
		await actions.click( screen.getByRole( 'button', { name: 'Copy link' } ) );
		expect( connector.copyText ).toHaveBeenCalledWith( 'https://earlier.example.com' );
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		connector.publishPreviewSite.mockRejectedValueOnce( new Error( 'Upload failed' ) );
		await actions.click( screen.getByRole( 'button', { name: 'Update preview' } ) );
		await failure( 'Upload failed' );
		await actions.click( await shareButton( 'Try again' ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Preview actions' } ) ).toBeEnabled()
		);
		expect( screen.queryByText( 'Upload failed' ) ).not.toBeInTheDocument();
		expect( connector.publishPreviewSite.mock.calls ).toEqual( [
			[ site.id, 'earlier.example.com', undefined ],
			[ site.id, 'earlier.example.com', undefined ],
		] );
	} );

	it( 'keeps the existing link available while updating a preview', async () => {
		const actions = userEvent.setup();
		const { connector, ready } = setup( TEST_USER, [ preview() ] );
		let finish!: ( value: { url: string } ) => void;
		connector.publishPreviewSite.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					finish = resolve;
				} )
		);
		await ready;
		await actions.click( await screen.findByRole( 'button', { name: 'Update preview' } ) );
		expect( await screen.findByRole( 'button', { name: 'Updating' } ) ).toBeDisabled();
		expect( screen.queryByText( 'Publishing preview…' ) ).not.toBeInTheDocument();
		const copy = screen.getByRole( 'button', { name: 'Copy link' } );
		expect( copy ).toBeEnabled();
		await actions.click( copy );
		expect( connector.copyText ).toHaveBeenCalledWith( 'https://preview.example.com' );
		await act( async () => finish( { url: 'https://preview.example.com' } ) );
		expect( await screen.findByRole( 'button', { name: 'Update preview' }, SETTLE ) ).toBeVisible();
	} );

	it( 'updates an existing preview only when explicitly requested', async () => {
		const actions = userEvent.setup();
		const { connector, ready, site } = setup( TEST_USER, [ preview() ] );
		await ready;
		await actions.click( await shareButton( 'Copy link' ) );
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		await actions.keyboard( '{Escape}' );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await actions.click( shareTrigger() );
		const trigger = await screen.findByRole( 'button', { name: 'Preview actions' } );
		await waitFor( () => expect( trigger ).toBeEnabled() );
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		await actions.click( trigger );
		expect(
			( await screen.findAllByRole( 'menuitem' ) ).map( ( item ) => item.textContent )
		).toContain( 'Delete preview' );
		await actions.keyboard( '{Escape}' );
		await actions.click( screen.getByRole( 'button', { name: 'Update preview' } ) );
		await shareButton( 'Copy link' );
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			site.id,
			'preview.example.com',
			undefined
		);
	} );

	it( 'confirms deletion before calling the backend', async () => {
		const actions = userEvent.setup();
		const { connector, ready } = setup( TEST_USER, [ preview() ] );
		await ready;
		await screen.findByRole( 'button', { name: 'Copy link' } );
		await actions.click( screen.getByRole( 'button', { name: 'Preview actions' } ) );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Delete preview' } ) );
		expect( connector.deleteSnapshot ).not.toHaveBeenCalled();
		await actions.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( connector.deleteSnapshot ).not.toHaveBeenCalled();
		await actions.click( screen.getByRole( 'button', { name: 'Preview actions' } ) );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Delete preview' } ) );
		await actions.click( screen.getByRole( 'button', { name: 'Delete preview' } ) );
		await waitFor( () =>
			expect( connector.deleteSnapshot ).toHaveBeenCalledWith( 'preview.example.com' )
		);
		act( () =>
			connector.emit( 'onSnapshotEvent', {
				event: SNAPSHOT_EVENTS.DELETED,
				snapshotUrl: 'preview.example.com',
			} )
		);
		await shareButton();
	} );

	it( 'retains management errors and allows retry', async () => {
		const actions = userEvent.setup();
		const { connector, ready } = setup( TEST_USER, [ preview() ] );
		connector.deleteSnapshot.mockRejectedValueOnce( new Error( 'Delete failed' ) );
		await ready;
		await actions.click( await screen.findByRole( 'button', { name: 'Preview actions' } ) );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Delete preview' } ) );
		await actions.click( screen.getByRole( 'button', { name: 'Delete preview' } ) );
		await waitFor( () =>
			expect( getNoticeHistory()[ 0 ]?.title ).toBe( "Couldn't delete the preview site" )
		);
		await actions.click( screen.getByRole( 'button', { name: 'Delete preview' } ) );
		act( () =>
			connector.emit( 'onSnapshotEvent', {
				event: SNAPSHOT_EVENTS.DELETED,
				snapshotUrl: 'preview.example.com',
			} )
		);
		await shareButton();
		expect( connector.deleteSnapshot ).toHaveBeenCalledTimes( 2 );
	} );
} );
