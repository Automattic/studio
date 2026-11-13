import { __ } from '@wordpress/i18n';
import { CheckIcon } from 'lucide-react';
import { useId, useEffect, useRef, useState, type RefObject } from 'react';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { requestHeaderPanel, subscribeHeaderPanelRequest } from '@/data/use-open-header-panel';
import { AccountPromptDialog } from '@/features/account';
import {
	SharePanel,
	ShareStatusIcon,
	useShareStatus,
	PreviewManagementDialog,
	type PreviewManagementAction,
} from '@/features/sharing';
import { PublishTab, usePublishTab, usePublishSetupError } from '@/features/sync';
import { PublishTransferIcon, ShareIcon, SyncIcon } from '@/lib/icons';
import {
	Button,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	Tabs,
	TabsList,
	TabsTrigger,
	TabsScopeIndicator,
	Tooltip,
	TooltipTrigger,
	TooltipContent,
	VisuallyHidden,
} from '@/lib/ui';
import styles from './style.module.css';
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

		const share = subscribeHeaderPanelRequest( site.id, 'share', ( next ) =>
			show( 'share', next.trigger )
		);
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
		user.isSuccess && ! user.data && ( tab === 'share' || publish.provider === 'wpcom' );
	const changeOpen = ( next: boolean ) => {
		setOpen( next );
		if ( ! next ) {
			setSetupAfterSignup( false );
			publish.reset();
		}
	};
	const selectTab = ( value: unknown ) => {
		setTab( value as Tab );
		if ( value === 'publish' && ! publish.screen ) openPublish();
	};
	return (
		<>
			<Dialog open={ open && ! signedOut && ! previewAction } onOpenChange={ changeOpen }>
				<DialogContent
					className={ styles.dialog }
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
						<DialogHeader className={ styles.header }>
							<DialogTitle render={ <VisuallyHidden /> }>{ __( 'Share and publish' ) }</DialogTitle>
							<TabsList
								variant="scope"
								aria-label={ __( 'Share and publish' ) }
								className={ styles.tabs }
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
							<div
								className={ styles.publishHeader }
								ref={ setPublishHeader }
								hidden={ tab !== 'publish' || ! publishSubstep }
							/>
						</DialogHeader>
						<div
							role="tabpanel"
							id={ `${ id }-share-panel` }
							aria-labelledby={ `${ id }-share-tab` }
							hidden={ tab !== 'share' }
							className={ styles.panel }
						>
							<SharePanel
								site={ site }
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
							className={ styles.panel }
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
				footer={
					tab === 'publish' && publish.canChooseHost ? (
						<Button
							variant="inline-link"
							onClick={ () => {
								setSetupAfterSignup( false );
								publish.chooseHost();
							} }
						>
							{ __( 'Choose another host' ) }
						</Button>
					) : undefined
				}
			/>
		</>
	);
}

export function ShareButton( props: { site: SiteDetails; className?: string } ) {
	const status = useShareStatus( props.site.id );
	return (
		<span className={ props.className }>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={ __( 'Share' ) }
							aria-description={ status.label }
							onClick={ ( event ) =>
								requestHeaderPanel( {
									panel: 'share',
									siteId: props.site.id,
									trigger: event.currentTarget,
								} )
							}
						/>
					}
				>
					<ShareStatusIcon icon={ <ShareIcon /> } status={ status } />
				</TooltipTrigger>
				<TooltipContent side="bottom">{ __( 'Share' ) }</TooltipContent>
			</Tooltip>
		</span>
	);
}

export function PublishButton( props: {
	site: SiteDetails;
	variant?: 'accent' | 'outline';
	compactWhenNarrow?: boolean;
} ) {
	const activity = useSiteSyncActivity( props.site.id );
	const setupError = usePublishSetupError( props.site.id );
	const transfer =
		activity?.direction === 'push' || activity?.direction === 'pull' ? activity : null;
	const pending = transfer?.kind === 'pending';
	const [ success, setSuccess ] = useState( false );
	useEffect( () => {
		if ( transfer?.kind !== 'success' ) return;
		setSuccess( true );
		const timer = setTimeout( () => setSuccess( false ), 1800 );
		return () => clearTimeout( timer );
	}, [ transfer?.kind ] );
	return (
		<Button
			variant={ props.variant ?? 'accent' }
			className={ props.compactWhenNarrow ? styles.responsivePublish : undefined }
			size="sm"
			title={ __( 'Publish' ) }
			aria-label={ __( 'Publish…' ) }
			aria-description={
				setupError ??
				( transfer?.kind === 'error'
					? transfer.message
					: pending
					? transfer.direction === 'pull'
						? __( 'Pulling…' )
						: __( 'Publishing…' )
					: undefined )
			}
			onClick={ ( event ) =>
				requestHeaderPanel( {
					panel: 'publish',
					siteId: props.site.id,
					view: 'publish',
					trigger: event.currentTarget,
				} )
			}
		>
			{ pending ? (
				<PublishTransferIcon direction={ transfer.direction === 'pull' ? 'pull' : 'push' } />
			) : success ? (
				<CheckIcon />
			) : props.compactWhenNarrow ? (
				<SyncIcon className={ styles.publishIcon } />
			) : null }
			<span className={ styles.triggerLabel }>
				{ __( 'Publish' ) }
				{ transfer?.kind === 'error' || setupError ? <span className={ styles.errorDot } /> : null }
			</span>
		</Button>
	);
}
