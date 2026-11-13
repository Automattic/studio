import { getProvider } from '@studio/providers';
import { __ } from '@wordpress/i18n';
import { useId, useEffect, useRef, useState, type RefObject } from 'react';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useSyncNoticeVisibility } from '@/data/queries/use-sync-site';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { subscribeHeaderPanelRequest, requestHeaderPanel } from '@/data/use-open-header-panel';
import { AccountPromptDialog } from '@/features/account';
import {
	SharePanel,
	PreviewManagementDialog,
	type PreviewManagementAction,
} from '@/features/sharing';
import { usePublishSetupError, PublishTab, usePublishTab } from '@/features/sync';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	Tabs,
	TabsList,
	TabsTrigger,
	TabsScopeIndicator,
	VisuallyHidden,
} from '@/lib/ui';
import type { SiteDetails } from '@/data/core';
type Tab = 'share' | 'publish';
export function SiteDeliveryDialog( {
	site,
	anchor,
}: {
	site: SiteDetails;
	anchor?: RefObject< HTMLElement | null >;
} ) {
	const id = useId();
	const user = useAuthUser();
	const createSequence = useRef( 0 );
	const [ createRequest, setCreateRequest ] = useState< number >();
	const publish = usePublishTab( site.id );
	const { open: openPublish } = publish;
	const [ setupAfterSignup, setSetupAfterSignup ] = useState( false );
	const [ open, setOpen ] = useState( false );
	const [ tab, setTab ] = useState< Tab >( 'share' );
	const [ previewAction, setPreviewAction ] = useState< PreviewManagementAction | null >( null );
	const previewReturnFocus = useRef< HTMLButtonElement | null >( null );
	const [ publishSubstep, setPublishSubstep ] = useState( false );
	const [ publishHeader, setPublishHeader ] = useState< HTMLDivElement | null >( null );
	const finalFocus = useRef< HTMLElement | null >( null );
	useEffect( () => {
		const show = ( next: Tab, trigger?: HTMLElement ) => {
			previewReturnFocus.current = null;
			finalFocus.current =
				trigger ??
				anchor?.current?.querySelector< HTMLElement >( '[data-share-overflow-trigger]' ) ??
				( document.activeElement instanceof HTMLElement ? document.activeElement : null );
			setTab( next );
			setOpen( true );
		};
		const share = subscribeHeaderPanelRequest( site.id, 'share', ( next ) => {
			setCreateRequest( next.createIfMissing ? ++createSequence.current : undefined );
			show( 'share', next.trigger );
		} );
		const publishRequest = subscribeHeaderPanelRequest( site.id, 'publish', ( next ) => {
			openPublish( next );
			show( 'publish', next.trigger );
		} );
		return () => {
			share();
			publishRequest();
		};
	}, [ site.id, anchor, openPublish ] );
	// WordPress.com's account is the Studio sign-in, which sharing needs too.
	const signedOut =
		user.isSuccess &&
		! user.data &&
		( tab === 'share' ||
			( !! publish.provider &&
				getProvider( publish.provider ).account.methods.some(
					( method ) => method.kind === 'redirect'
				) ) );
	useSyncNoticeVisibility( site.id, open && ! signedOut && ! previewAction );
	const selectTab = ( value: unknown ) => {
		setCreateRequest( undefined );
		setTab( value as Tab );
		if ( value === 'publish' && ! publish.screen ) openPublish();
	};
	const changeOpen = ( next: boolean ) => {
		if ( ! next ) setCreateRequest( undefined );
		setOpen( next );
	};
	return (
		<>
			<Dialog open={ open && ! signedOut && ! previewAction } onOpenChange={ changeOpen }>
				<DialogContent
					keepMounted
					initialFocus={ () =>
						previewReturnFocus.current?.isConnected
							? previewReturnFocus.current
							: document.getElementById( `${ id }-${ tab }-tab` )
					}
					finalFocus={ () => {
						if ( previewAction ) return false;
						const trigger = finalFocus.current;
						return trigger?.closest( '[hidden]' )
							? anchor?.current?.querySelector< HTMLElement >( '[data-share-overflow-trigger]' ) ??
									trigger
							: trigger;
					} }
				>
					<Tabs value={ tab } onValueChange={ selectTab }>
						<DialogHeader>
							<DialogTitle render={ <VisuallyHidden /> }>{ __( 'Share and publish' ) }</DialogTitle>
							<TabsList
								variant="scope"
								aria-label={ __( 'Share and publish' ) }
								hidden={ tab === 'publish' && publishSubstep }
							>
								<TabsTrigger
									value="share"
									id={ `${ id }-share-tab` }
									aria-controls={ `${ id }-share-panel` }
								>
									{ __( 'Share' ) }
								</TabsTrigger>
								<TabsTrigger
									value="publish"
									id={ `${ id }-publish-tab` }
									aria-controls={ `${ id }-publish-panel` }
								>
									{ __( 'Publish' ) }
								</TabsTrigger>
								<TabsScopeIndicator />
							</TabsList>
							<div ref={ setPublishHeader } hidden={ tab !== 'publish' || ! publishSubstep } />
						</DialogHeader>
						<div
							role="tabpanel"
							id={ `${ id }-share-panel` }
							aria-labelledby={ `${ id }-share-tab` }
							hidden={ tab !== 'share' }
						>
							<SharePanel
								site={ site }
								createRequest={ open && tab === 'share' ? createRequest : undefined }
								onManagePreview={ ( action ) => {
									previewReturnFocus.current = action.trigger;
									setPreviewAction( action );
								} }
							/>
						</div>
						<div
							role="tabpanel"
							id={ `${ id }-publish-panel` }
							aria-labelledby={ `${ id }-publish-tab` }
							hidden={ tab !== 'publish' }
						>
							<PublishTab
								tab={ publish }
								site={ site }
								open={ open && tab === 'publish' }
								headerContainer={ publishHeader }
								substep={ publishSubstep }
								onSubstepChange={ setPublishSubstep }
								setupAfterSignup={ setupAfterSignup }
								onSetupAfterSignup={ () => setSetupAfterSignup( false ) }
							/>
						</div>
					</Tabs>
				</DialogContent>
			</Dialog>
			{ previewAction ? (
				<PreviewManagementDialog
					action={ previewAction }
					site={ site }
					onClose={ () => setPreviewAction( null ) }
				/>
			) : null }
			<AccountPromptDialog
				open={ open && signedOut }
				showStudioIcon={ false }
				onOpenChange={ changeOpen }
				finalFocus={ finalFocus }
				title={ tab === 'share' ? __( 'Share your WordPress' ) : __( 'Publish your WordPress' ) }
				description={
					tab === 'share'
						? __( 'Create an account or log in to share previews and keep your sites in sync.' )
						: __( 'Create an account or log in to publish a website and keep your sites in sync.' )
				}
				source={ tab === 'share' ? 'previews_tab' : 'sync_tab' }
				analytics={ {
					placement: tab === 'share' ? 'share' : 'publish',
					intent: tab === 'share' ? 'share' : 'publish',
				} }
				scope={ site.id }
				onCreateAccount={ tab === 'publish' ? () => setSetupAfterSignup( true ) : undefined }
			/>
		</>
	);
}

export function PublishButton( { site }: { site: SiteDetails } ) {
	const activity = useSiteSyncActivity( site.id );
	const error = usePublishSetupError( site.id );
	return (
		<button
			aria-label="Publish…"
			aria-description={
				error ??
				( activity?.kind === 'pending'
					? 'Publishing…'
					: activity?.kind === 'error'
					? activity.message
					: undefined )
			}
			onClick={ () => requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'publish' } ) }
		>
			{ __( 'Share' ) }
		</button>
	);
}
