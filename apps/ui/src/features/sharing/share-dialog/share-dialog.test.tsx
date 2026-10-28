import { DAY_MS } from '@studio/common/constants';
import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getNoticeHistory, resetAppMessagesForTests, runNoticeAction } from '@/data/app-messages';
import { useSites } from '@/data/queries/use-sites';
import { applySyncActivity } from '@/data/sync-activity';
import { ShareButton, SiteDeliveryDialog } from '@/features/site-delivery';
import { createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
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

function additionalPreview(): Snapshot {
	return preview( {
		atomicSiteId: 99,
		name: 'Additional preview',
		url: 'additional.example.com',
		date: Date.now() - DAY_MS,
	} );
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
		return (
			<>
				<SiteDeliveryDialog site={ current } />
				<ShareButton site={ current } />
			</>
		);
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
	trigger.getAttribute( 'aria-description' ) === 'Creating preview…';
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
	it( 'shows Visit preview, Update, and expiration for one preview without a table', async () => {
		const actions = userEvent.setup();
		const { connector, ready } = setup( TEST_USER, [ preview() ] );
		await ready;
		const visit = await screen.findByRole( 'button', { name: 'Visit preview' } );
		expect( screen.queryByRole( 'table' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Copy link' } ) ).not.toBeInTheDocument();
		expect( screen.getByText( /^Preview created on .+\.$/ ) ).toBeVisible();
		expect( screen.getByText( /^Expires on .+\.$/ ) ).toBeVisible();
		await actions.click( visit );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith( 'https://preview.example.com' );
		await actions.click( screen.getByRole( 'button', { name: 'Sharing actions' } ) );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Copy link' } ) );
		expect( connector.copyText ).toHaveBeenCalledWith( 'https://preview.example.com' );
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	} );

	it( 'keeps the single-preview view usable while creating a second preview', async () => {
		const actions = userEvent.setup();
		const { connector, ready, site } = setup( TEST_USER, [ preview() ] );
		let finish!: ( value: { url: string } ) => void;
		connector.publishPreviewSite.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					finish = resolve;
				} )
		);
		await ready;
		await actions.click( await screen.findByRole( 'button', { name: 'Sharing actions' } ) );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'New preview' } ) );
		expect( screen.queryByRole( 'table' ) ).not.toBeInTheDocument();
		const creating = screen.getByRole( 'button', { name: 'Creating…' } );
		expect( creating ).toBeDisabled();
		expect( creating ).toHaveAttribute( 'aria-busy', 'true' );
		expect( creating.querySelector( '[data-slot="spinner"]' ) ).toBeInTheDocument();
		await actions.click( creating );
		expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
		await actions.click( screen.getByRole( 'button', { name: 'Visit preview' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith( 'https://preview.example.com' );
		await actions.click( screen.getByRole( 'button', { name: 'Sharing actions' } ) );
		expect( await screen.findByRole( 'menuitem', { name: 'Rename' } ) ).toBeEnabled();
		expect( screen.getByRole( 'menuitem', { name: 'New preview' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		await actions.keyboard( '{Escape}' );
		act( () =>
			connector.emit( 'onSnapshotEvent', {
				event: SNAPSHOT_EVENTS.CREATED,
				snapshotUrl: 'second.example.com',
				snapshot: preview( {
					atomicSiteId: 2,
					localSiteId: site.id,
					name: 'Second preview',
					url: 'second.example.com',
				} ),
			} )
		);
		await act( async () => finish( { url: 'https://second.example.com' } ) );
		expect( await screen.findByRole( 'table', { name: 'Previews' } ) ).toBeVisible();
		await waitFor( () =>
			expect( screen.getByRole( 'radio', { name: 'Select Second preview' } ) ).toBeChecked()
		);
		expect( screen.getByRole( 'button', { name: 'Copy link' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Visit preview' } ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the table and selected link available while creating another preview', async () => {
		const actions = userEvent.setup();
		const { connector, ready, site } = setup( TEST_USER, [ preview(), additionalPreview() ] );
		let finish!: ( value: { url: string } ) => void;
		await ready;
		await screen.findByRole( 'button', { name: 'Copy link' } );
		expect( screen.queryByRole( 'menuitem', { name: 'Rename' } ) ).not.toBeInTheDocument();

		connector.publishPreviewSite.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					finish = resolve;
				} )
		);
		await actions.click( screen.getByRole( 'button', { name: 'Sharing actions' } ) );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'New preview' } ) );
		expect( connector.publishPreviewSite ).toHaveBeenCalledWith( site.id, undefined, undefined );
		act( () => {
			applySyncActivity( site.id, { kind: 'success', direction: 'preview' } );
		} );

		expect( screen.getByRole( 'table', { name: 'Previews' } ) ).toBeVisible();
		expect( screen.getByRole( 'radio', { name: 'Select My site preview' } ) ).toBeChecked();
		const creatingButtons = screen.getAllByRole( 'button', { name: 'Creating…' } );
		expect( creatingButtons ).toHaveLength( 2 );
		for ( const button of creatingButtons ) {
			expect( button ).toBeDisabled();
			expect( button ).toHaveAttribute( 'aria-busy', 'true' );
			expect( button.querySelector( '[data-slot="spinner"]' ) ).toBeInTheDocument();
		}
		expect( screen.queryByRole( 'button', { name: 'Sharing actions' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Creating preview…' } ) ).not.toBeInTheDocument();
		const previewActions = screen.getAllByRole( 'button', { name: 'Preview actions' } )[ 0 ];
		expect( previewActions ).toBeEnabled();
		await actions.click( previewActions );
		expect( await screen.findByRole( 'menuitem', { name: 'Rename' } ) ).toBeEnabled();
		expect( screen.getByRole( 'menuitem', { name: 'Copy link' } ) ).toBeEnabled();
		expect( screen.getByRole( 'menuitem', { name: 'Visit preview' } ) ).toBeEnabled();
		expect( screen.getByRole( 'menuitem', { name: 'Update' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getByRole( 'menuitem', { name: 'Delete preview' } ) ).toBeEnabled();
		await actions.click( screen.getByRole( 'menuitem', { name: 'Delete preview' } ) );
		const confirmation = await screen.findByRole( 'alertdialog', { name: 'Delete preview?' } );
		expect(
			within( confirmation ).getByRole( 'button', { name: 'Delete preview' } )
		).toBeEnabled();
		await actions.click( within( confirmation ).getByRole( 'button', { name: 'Cancel' } ) );
		await actions.click( screen.getByRole( 'link', { name: 'My site preview' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith( 'https://preview.example.com' );
		await actions.click( screen.getByRole( 'button', { name: 'Copy link' } ) );
		expect( connector.copyText ).toHaveBeenCalledWith( 'https://preview.example.com' );
		act( () =>
			connector.emit( 'onSnapshotEvent', {
				event: SNAPSHOT_EVENTS.CREATED,
				snapshotUrl: 'new.example.com',
				snapshot: preview( {
					atomicSiteId: 2,
					localSiteId: site.id,
					name: 'New preview',
					url: 'new.example.com',
				} ),
			} )
		);
		await act( async () => finish( { url: 'https://new.example.com' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'radio', { name: 'Select New preview' } ) ).toBeChecked()
		);
		expect( screen.getAllByRole( 'radio' ) ).toHaveLength( 3 );
		await waitFor( () => expect( screen.getByRole( 'button', { name: 'Update' } ) ).toBeEnabled() );
	} );

	it( 'only shows header sharing actions for existing previews on the Share tab', async () => {
		const actions = userEvent.setup();
		const { ready, changeSnapshots } = setup();
		await ready;
		await screen.findByRole( 'button', { name: 'Create preview' } );
		expect( screen.queryByRole( 'button', { name: 'Sharing actions' } ) ).not.toBeInTheDocument();
		changeSnapshots( [ preview(), additionalPreview() ] );
		expect( await screen.findByRole( 'button', { name: 'Sharing actions' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'New preview' } ) ).not.toBeInTheDocument();
		await actions.click( screen.getByRole( 'tab', { name: 'Publish' } ) );
		expect( screen.queryByRole( 'button', { name: 'Sharing actions' } ) ).not.toBeInTheDocument();
		await actions.click( screen.getByRole( 'tab', { name: 'Share' } ) );
		expect( screen.getByRole( 'button', { name: 'Sharing actions' } ) ).toBeVisible();
	} );

	it( 'renames the preview from its row menu with a focused dialog', async () => {
		const actions = userEvent.setup();
		const { connector, ready } = setup( TEST_USER, [
			preview( { name: 'Current' } ),
			preview( {
				atomicSiteId: 2,
				name: 'Earlier',
				url: 'earlier.example.com',
				date: Date.now() - DAY_MS,
			} ),
		] );
		await ready;
		await screen.findByRole( 'button', { name: 'Copy link' } );
		await actions.click(
			within( screen.getByRole( 'row', { name: /Select Earlier/ } ) ).getByRole( 'button', {
				name: 'Preview actions',
			} )
		);
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Rename' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Rename preview' } ) ).toBeVisible();
		await waitFor( () =>
			expect(
				screen.queryByRole( 'dialog', { name: 'Share and publish' } )
			).not.toBeInTheDocument()
		);
		expect( screen.getAllByRole( 'dialog' ) ).toHaveLength( 1 );
		const input = screen.getByRole( 'textbox', { name: 'Preview name' } );
		await waitFor( () => expect( input ).toHaveFocus() );
		expect( input ).toHaveValue( 'Earlier' );
		expect( ( input as HTMLInputElement ).selectionStart ).toBe( 0 );
		expect( ( input as HTMLInputElement ).selectionEnd ).toBe( 7 );
		await actions.clear( input );
		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();
		await actions.type( input, '  Client review  {Enter}' );
		await waitFor( () =>
			expect( connector.renameSnapshot ).toHaveBeenCalledWith(
				'earlier.example.com',
				'Client review'
			)
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Rename preview' } ) ).not.toBeInTheDocument()
		);
		expect( await screen.findByRole( 'link', { name: 'Client review' } ) ).toHaveAttribute(
			'href',
			'https://earlier.example.com'
		);
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	} );

	it( 'cancels renaming and keeps a failed rename available to retry', async () => {
		const actions = userEvent.setup();
		const { connector, ready } = setup( TEST_USER, [ preview() ] );
		await ready;
		await actions.click( await screen.findByRole( 'button', { name: 'Sharing actions' } ) );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Rename' } ) );
		await actions.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( connector.renameSnapshot ).not.toHaveBeenCalled();
		await actions.click( screen.getByRole( 'button', { name: 'Sharing actions' } ) );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Rename' } ) );
		connector.renameSnapshot.mockRejectedValueOnce( new Error( 'Rename failed' ) );
		const input = screen.getByRole( 'textbox', { name: 'Preview name' } );
		await actions.clear( input );
		await actions.type( input, 'Client review{Enter}' );
		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent( 'Rename failed' );
		expect( screen.getByRole( 'textbox', { name: 'Preview name' } ) ).toHaveValue(
			'Client review'
		);
		await actions.click( screen.getByRole( 'button', { name: 'Save' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Rename preview' } ) ).not.toBeInTheDocument()
		);
		expect( connector.renameSnapshot ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'restores the selected preview after dismissing rename or delete', async () => {
		const actions = userEvent.setup();
		const { ready } = setup( TEST_USER, [
			preview( { name: 'Current' } ),
			preview( {
				atomicSiteId: 2,
				name: 'Earlier',
				url: 'earlier.example.com',
				date: Date.now() - DAY_MS,
			} ),
		] );
		await ready;
		await screen.findByRole( 'button', { name: 'Copy link' } );
		await actions.click( screen.getByRole( 'radio', { name: 'Select Earlier' } ) );
		for ( const item of [ 'Rename', 'Delete preview' ] ) {
			const row = screen.getByRole( 'row', { name: /Select Earlier/ } );
			await actions.click( within( row ).getByRole( 'button', { name: 'Preview actions' } ) );
			await actions.click( await screen.findByRole( 'menuitem', { name: item } ) );
			await screen.findByRole( item === 'Rename' ? 'dialog' : 'alertdialog', {
				name: item === 'Rename' ? 'Rename preview' : 'Delete preview?',
			} );
			await waitFor( () =>
				expect(
					screen.queryByRole( 'dialog', { name: 'Share and publish' } )
				).not.toBeInTheDocument()
			);
			await actions.click( screen.getByRole( 'button', { name: 'Close' } ) );
			expect( await screen.findByRole( 'dialog', { name: 'Share and publish' } ) ).toBeVisible();
			expect( screen.getByRole( 'tab', { name: 'Share' } ) ).toHaveAttribute(
				'aria-selected',
				'true'
			);
			expect( screen.getByRole( 'radio', { name: 'Select Earlier' } ) ).toBeChecked();
		}
	} );

	it( 'opens a preview from its linked title', async () => {
		const actions = userEvent.setup();
		const { connector, ready } = setup( TEST_USER, [ preview(), additionalPreview() ] );
		await ready;
		const link = await screen.findByRole( 'link', { name: 'My site preview' } );
		expect( link ).toHaveAttribute( 'href', 'https://preview.example.com' );
		await actions.click( link );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith( 'https://preview.example.com' );
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
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
		const creating = await screen.findByRole( 'button', { name: 'Creating preview…' } );
		expect( creating ).toBeDisabled();
		expect( creating ).toHaveAttribute( 'aria-busy', 'true' );
		expect( creating.querySelector( '[data-slot="spinner"]' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'combobox', { name: 'Select preview' } ) ).not.toBeInTheDocument();
		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		const trigger = shareTrigger();
		expect( isPublishing( trigger ) ).toBe( true );
		fireEvent.click( trigger );
		await screen.findByText( 'Creating preview…' );
		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await act( async () => finish() );
		await waitFor( () => expect( isUnread( trigger ) ).toBe( true ), SETTLE );
		expect( isPublishing( trigger ) ).toBe( false );
		expect( trigger ).toHaveAccessibleDescription( 'Preview ready' );
		expect( getNoticeHistory()[ 0 ].title ).toBe( 'Preview link is ready' );
		fireEvent.click( trigger );
		await screen.findByRole( 'button', { name: 'Visit preview' } );
		await waitFor( () => expect( isUnread( trigger ) ).toBe( false ) );
		expect( connector.copyText ).not.toHaveBeenCalled();
		expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'copies from the preview notification after the dialog closes', async () => {
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
		await screen.findByText( 'Creating preview…' );
		fireEvent.keyDown( screen.getByRole( 'dialog' ), { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await act( async () => finish() );
		await waitFor( () => expect( getNoticeHistory() ).toHaveLength( 1 ), SETTLE );
		expect( getNoticeHistory()[ 0 ].title ).toBe( 'Preview link is ready' );
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
			expect( screen.queryByRole( 'tablist' ) ).not.toBeInTheDocument();
			expect( screen.queryByRole( 'button', { name: 'Share' } ) ).not.toBeInTheDocument();
			expect(
				screen.getAllByRole( 'heading', { name: 'Share your WordPress' } ).at( -1 )
			).toBeVisible();
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
		const login = await screen.findByRole( 'button', { name: 'Log in' } );
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

	it( 'copies only this account’s selected preview without extra controls', async () => {
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
		expect( screen.getAllByRole( 'radio' ) ).toHaveLength( 2 );
		expect( screen.queryByRole( 'link', { name: 'Other site' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'link', { name: 'Private preview' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'radio', { name: 'Select Latest preview' } ) ).toBeChecked();
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
		await screen.findByRole( 'button', { name: 'Visit preview' }, SETTLE );
		expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'refreshes events and isolates account and site switches', async () => {
		const { connector, changeUser, changeSnapshots, rerender, ready } = setup( TEST_USER, [
			preview(),
			additionalPreview(),
		] );
		await ready;
		await screen.findByRole( 'button', { name: 'Copy link' } );
		changeSnapshots( [ preview( { url: 'changed.example.com', name: 'Changed preview' } ) ] );
		await waitFor( () =>
			expect( screen.getByRole( 'link', { name: 'Changed preview' } ) ).toHaveAttribute(
				'href',
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

	it( 'opens sharing documentation before creating a preview', async () => {
		const { connector, ready } = setup();
		await ready;
		await screen.findByRole( 'button', { name: 'Create preview' } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Learn more…' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith(
			'https://developer.wordpress.com/docs/developer-tools/studio/preview-sites/'
		);
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	} );

	it( 'copies, views, and updates the preview whose row menu was opened', async () => {
		const actions = userEvent.setup();
		const { connector, ready, site } = setup( TEST_USER, [
			preview( { name: 'Current' } ),
			preview( {
				atomicSiteId: 2,
				name: 'Earlier',
				url: 'earlier.example.com',
				date: Date.now() - DAY_MS,
			} ),
		] );
		await ready;
		await shareButton( 'Copy link' );
		const row = screen.getByRole( 'row', { name: /Select Earlier/ } );
		const openMenu = () =>
			actions.click( within( row ).getByRole( 'button', { name: 'Preview actions' } ) );
		await openMenu();
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Copy link' } ) );
		expect( connector.copyText ).toHaveBeenCalledWith( 'https://earlier.example.com' );
		expect( screen.getByRole( 'radio', { name: 'Select Current' } ) ).toBeChecked();
		await openMenu();
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Visit preview' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith( 'https://earlier.example.com' );
		await openMenu();
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Update' } ) );
		await waitFor( () =>
			expect( connector.publishPreviewSite ).toHaveBeenCalledWith(
				site.id,
				'earlier.example.com',
				undefined
			)
		);
		expect( screen.getByRole( 'radio', { name: 'Select Earlier' } ) ).toBeChecked();
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
		await actions.click( screen.getByRole( 'radio', { name: 'Select Earlier' } ) );
		await actions.click( screen.getByRole( 'button', { name: 'Copy link' } ) );
		expect( connector.copyText ).toHaveBeenCalledWith( 'https://earlier.example.com' );
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		connector.publishPreviewSite.mockRejectedValueOnce( new Error( 'Upload failed' ) );
		await actions.click( screen.getByRole( 'button', { name: 'Update' } ) );
		await failure( 'Upload failed' );
		await actions.click( screen.getByRole( 'radio', { name: 'Select Current' } ) );
		expect( screen.getByRole( 'link', { name: 'Current' } ) ).toHaveAttribute(
			'href',
			'https://preview.example.com'
		);
		await actions.click( await shareButton( 'Try again' ) );
		await waitFor( () =>
			expect( screen.getAllByRole( 'button', { name: 'Preview actions' } )[ 0 ] ).toBeEnabled()
		);
		expect( screen.queryByText( 'Upload failed' ) ).not.toBeInTheDocument();
		expect( connector.publishPreviewSite.mock.calls ).toEqual( [
			[ site.id, 'earlier.example.com', undefined ],
			[ site.id, 'earlier.example.com', undefined ],
		] );
	} );

	it.each( [ 1, 2 ] )(
		'keeps existing links available while updating with %d previews',
		async ( count ) => {
			const actions = userEvent.setup();
			const { connector, ready, site } = setup(
				TEST_USER,
				count === 1 ? [ preview() ] : [ preview(), additionalPreview() ]
			);
			let finish!: ( value: { url: string } ) => void;
			connector.publishPreviewSite.mockImplementationOnce(
				() =>
					new Promise( ( resolve ) => {
						finish = resolve;
					} )
			);
			await ready;
			await actions.click( await screen.findByRole( 'button', { name: 'Update' } ) );
			const updating = await screen.findByRole( 'button', { name: 'Updating…' } );
			expect( updating ).toBeDisabled();
			expect( updating ).toHaveAttribute( 'aria-busy', 'true' );
			expect( updating.querySelector( '[data-slot="spinner"]' ) ).toBeInTheDocument();
			await actions.click( updating );
			expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
			expect( screen.queryByText( 'Publishing preview…' ) ).not.toBeInTheDocument();
			const link = screen.getByRole( 'button', {
				name: count === 1 ? 'Visit preview' : 'Copy link',
			} );
			expect( link ).toBeEnabled();
			await actions.click( link );
			expect( count === 1 ? connector.openExternalUrl : connector.copyText ).toHaveBeenCalledWith(
				'https://preview.example.com'
			);
			act( () => {
				applySyncActivity( site.id, { kind: 'success', direction: 'preview' } );
			} );
			expect( screen.getByRole( 'button', { name: 'Updating…' } ) ).toBeDisabled();
			await act( async () => finish( { url: 'https://preview.example.com' } ) );
			await waitFor( () =>
				expect( screen.getByRole( 'button', { name: 'Update' } ) ).toBeEnabled()
			);
		}
	);

	it( 'updates an existing preview only when explicitly requested', async () => {
		const actions = userEvent.setup();
		const { connector, ready, site } = setup( TEST_USER, [ preview(), additionalPreview() ] );
		await ready;
		await actions.click( await shareButton( 'Copy link' ) );
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		await actions.keyboard( '{Escape}' );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await actions.click( shareTrigger() );
		const trigger = ( await screen.findAllByRole( 'button', { name: 'Preview actions' } ) )[ 0 ];
		await waitFor( () => expect( trigger ).toBeEnabled() );
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		await actions.click( trigger );
		expect(
			( await screen.findAllByRole( 'menuitem' ) ).map( ( item ) => item.textContent )
		).toContain( 'Delete preview' );
		await actions.keyboard( '{Escape}' );
		await actions.click( screen.getByRole( 'button', { name: 'Update' } ) );
		await shareButton( 'Copy link' );
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			site.id,
			'preview.example.com',
			undefined
		);
	} );

	it( 'selects previews with the keyboard and by clicking a row', async () => {
		const actions = userEvent.setup();
		const { connector, ready } = setup( TEST_USER, [
			preview( { name: 'Current' } ),
			preview( {
				atomicSiteId: 2,
				name: 'Earlier',
				url: 'earlier.example.com',
				date: Date.now() - DAY_MS,
			} ),
		] );
		await ready;
		const current = await screen.findByRole( 'radio', { name: 'Select Current' } );
		expect( current ).toBeChecked();
		current.focus();
		await actions.keyboard( '{ArrowDown}' );
		expect( screen.getByRole( 'radio', { name: 'Select Earlier' } ) ).toBeChecked();
		await actions.click( screen.getByRole( 'button', { name: 'Copy link' } ) );
		expect( connector.copyText ).toHaveBeenCalledWith( 'https://earlier.example.com' );
		await actions.click(
			within( screen.getByRole( 'row', { name: /Select Current/ } ) ).getAllByRole( 'cell' )[ 1 ]
		);
		expect( current ).toBeChecked();
	} );

	it( 'deletes the preview belonging to a row menu without changing the selection', async () => {
		const actions = userEvent.setup();
		const { connector, ready } = setup( TEST_USER, [
			preview( { name: 'Current' } ),
			preview( {
				atomicSiteId: 2,
				name: 'Earlier',
				url: 'earlier.example.com',
				date: Date.now() - DAY_MS,
			} ),
		] );
		await ready;
		await screen.findByRole( 'button', { name: 'Copy link' } );
		const current = screen.getByRole( 'radio', { name: 'Select Current' } );
		const row = screen.getByRole( 'row', { name: /Select Earlier/ } );
		await actions.click( within( row ).getByRole( 'button', { name: 'Preview actions' } ) );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Delete preview' } ) );
		expect( current ).toBeChecked();
		expect( screen.getByText( 'earlier.example.com' ) ).toBeVisible();
		await actions.click( screen.getByRole( 'button', { name: 'Delete preview' } ) );
		await waitFor( () =>
			expect( connector.deleteSnapshot ).toHaveBeenCalledWith( 'earlier.example.com' )
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'radio', { name: 'Select Earlier' } ) ).not.toBeInTheDocument()
		);
		await screen.findByRole( 'dialog', { name: 'Share and publish' } );
		expect( current ).toBeChecked();
	} );

	it( 'confirms deletion before calling the backend', async () => {
		const actions = userEvent.setup();
		const { connector, ready } = setup( TEST_USER, [ preview() ] );
		await ready;
		await screen.findByRole( 'button', { name: 'Visit preview' } );
		await actions.click( screen.getByRole( 'button', { name: 'Sharing actions' } ) );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Delete preview' } ) );
		const confirmation = await screen.findByRole( 'alertdialog', { name: 'Delete preview?' } );
		expect( within( confirmation ).getByText( 'preview.example.com' ) ).toBeVisible();
		await waitFor( () =>
			expect(
				screen.queryByRole( 'dialog', { name: 'Share and publish' } )
			).not.toBeInTheDocument()
		);
		await waitFor( () => expect( screen.getByRole( 'button', { name: 'Cancel' } ) ).toHaveFocus() );
		expect( connector.deleteSnapshot ).not.toHaveBeenCalled();
		await actions.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( connector.deleteSnapshot ).not.toHaveBeenCalled();
		await actions.click( screen.getByRole( 'button', { name: 'Sharing actions' } ) );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Delete preview' } ) );
		await actions.click( screen.getByRole( 'button', { name: 'Delete preview' } ) );
		await waitFor( () =>
			expect( connector.deleteSnapshot ).toHaveBeenCalledWith( 'preview.example.com' )
		);
		await shareButton();
	} );

	it( 'retains management errors and allows retry', async () => {
		const actions = userEvent.setup();
		const { connector, ready } = setup( TEST_USER, [ preview() ] );
		connector.deleteSnapshot.mockRejectedValueOnce( new Error( 'Delete failed' ) );
		await ready;
		await actions.click( await screen.findByRole( 'button', { name: 'Sharing actions' } ) );
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
	it( 'moves from the account modal to the Share panel without creating a preview', async () => {
		const { connector, ready, changeUser } = setup( null );
		await ready;
		await screen.findByRole( 'button', { name: 'Log in' } );
		changeUser( TEST_USER );
		await screen.findByRole( 'button', { name: 'Create preview' } );
		await waitFor( () => expect( screen.getAllByRole( 'dialog' ) ).toHaveLength( 1 ) );
		expect( screen.queryByRole( 'button', { name: 'Log in' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'dialog' ) ).toHaveAttribute( 'data-slot', 'dialog-content' );
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	} );

	it( 'allows copying and updating an existing preview at the account limit', async () => {
		const { connector, ready } = setup( TEST_USER, [ preview(), additionalPreview() ], {
			getSnapshotUsage: async () => ( {
				siteCount: 10,
				siteLimit: 10,
				siteCreationBlocked: false,
			} ),
		} );
		await ready;
		expect( await shareButton( 'Copy link' ) ).toBeEnabled();
		expect( await shareButton( 'Update' ) ).toBeEnabled();
		expect(
			screen.getByText( "You've used all 10 preview sites available on your account." )
		).toBeVisible();
		const actions = userEvent.setup();
		await actions.click( screen.getByRole( 'button', { name: 'Sharing actions' } ) );
		expect( await screen.findByRole( 'menuitem', { name: 'New preview' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		await actions.keyboard( '{Escape}' );
		await actions.click( screen.getByRole( 'button', { name: 'Update' } ) );
		expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'keeps links copyable offline and explains why updates are disabled', async () => {
		const { ready } = setup( TEST_USER, [ preview(), additionalPreview() ] );
		await ready;
		await shareButton( 'Copy link' );
		const online = Object.getOwnPropertyDescriptor( navigator, 'onLine' );
		Object.defineProperty( navigator, 'onLine', { configurable: true, value: false } );
		try {
			act( () => {
				window.dispatchEvent( new Event( 'offline' ) );
			} );
			expect( screen.getByRole( 'button', { name: 'Copy link' } ) ).toBeEnabled();
			expect( screen.getByRole( 'button', { name: 'Update' } ) ).toBeDisabled();
			expect(
				screen.getByText( 'Connect to the internet to create or update a preview.' )
			).toBeVisible();
		} finally {
			if ( online ) Object.defineProperty( navigator, 'onLine', online );
			else Reflect.deleteProperty( navigator, 'onLine' );
			act( () => {
				window.dispatchEvent( new Event( 'online' ) );
			} );
		}
	} );

	it( 'reuses the last expired preview name when creating a new preview', async () => {
		const { connector, ready, site } = setup( TEST_USER, [
			preview( { name: 'Homepage draft', date: Date.now() - 8 * DAY_MS } ),
		] );
		await ready;
		fireEvent.click( await shareButton() );
		await waitFor( () =>
			expect( connector.publishPreviewSite ).toHaveBeenCalledWith(
				site.id,
				undefined,
				'Homepage draft'
			)
		);
	} );
	it( 'keeps preview actions available during a background refresh', async () => {
		const { connector, ready, queryClient, site } = setup( TEST_USER, [
			preview(),
			additionalPreview(),
		] );
		await ready;
		await shareButton( 'Copy link' );
		let finish!: ( snapshots: Snapshot[] ) => void;
		connector.getSnapshots.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					finish = resolve;
				} )
		);
		act( () => {
			void queryClient.invalidateQueries( { queryKey: [ 'snapshots' ] } );
		} );
		await waitFor( () =>
			expect( queryClient.isFetching( { queryKey: [ 'snapshots' ] } ) ).toBe( 1 )
		);
		expect( screen.getByRole( 'button', { name: 'Copy link' } ) ).toBeEnabled();
		expect( screen.getByRole( 'button', { name: 'Update' } ) ).toBeEnabled();
		expect( screen.getAllByRole( 'button', { name: 'Preview actions' } )[ 0 ] ).toBeEnabled();
		await act( async () => finish( [ preview( { localSiteId: site.id } ) ] ) );
	} );

	it( 'reloads a failed preview lookup without creating a preview', async () => {
		const { connector, ready, site } = setup( TEST_USER, [], {
			getSnapshots: async () => {
				throw new Error( 'Unable to load previews' );
			},
		} );
		await ready;
		await screen.findByRole( 'button', { name: 'Reload' } );
		expect( screen.queryByText( 'Unable to load previews' ) ).not.toBeInTheDocument();
		connector.getSnapshots.mockResolvedValue( [ preview( { localSiteId: site.id } ) ] );
		fireEvent.click( screen.getByRole( 'button', { name: 'Reload' } ) );
		await screen.findByRole( 'button', { name: 'Visit preview' } );
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	} );
} );
