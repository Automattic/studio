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
import { PublishPanel, usePublishSetupError } from '@/features/sync';
import { PublishTransferIcon, ShareIcon } from '@/lib/icons';
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
type PublishRequest = { view: 'publish' | 'pull' | 'websites'; remoteSiteId?: number };
export function SiteDeliveryDialog( {
	site,
	anchor,
}: {
	site: SiteDetails;
	anchor?: RefObject< HTMLElement | null >;
} ) {
	const id = useId();
	const user = useAuthUser();
	const signedOut = user.isSuccess && ! user.data;
	const [ setupAfterSignup, setSetupAfterSignup ] = useState( false );
	const [ open, setOpen ] = useState( false );
	const [ tab, setTab ] = useState< Tab >( 'share' );
	const [ previewAction, setPreviewAction ] = useState< PreviewManagementAction | null >( null );
	const previewReturnFocus = useRef< HTMLButtonElement | null >( null );
	const [ publishSubstep, setPublishSubstep ] = useState( false );
	const [ publishHeader, setPublishHeader ] = useState< HTMLDivElement | null >( null );
	const [ request, setRequest ] = useState< PublishRequest >();
	const finalFocus = useRef< HTMLElement | null >( null );
	useEffect( () => {
		const show = ( next: Tab, trigger?: HTMLElement, publishRequest?: PublishRequest ) => {
			previewReturnFocus.current = null;
			finalFocus.current =
				trigger ??
				anchor?.current?.querySelector< HTMLElement >( '[data-share-overflow-trigger]' ) ??
				( document.activeElement instanceof HTMLElement ? document.activeElement : null );
			setTab( next );
			if ( next === 'publish' ) setRequest( publishRequest ?? { view: 'publish' } );
			setOpen( true );
		};
		const share = subscribeHeaderPanelRequest( site.id, 'share', ( next ) =>
			show( 'share', next.trigger )
		);
		const publish = subscribeHeaderPanelRequest( site.id, 'publish', ( next ) =>
			show( 'publish', next.trigger, { view: next.view, remoteSiteId: next.remoteSiteId } )
		);
		return () => {
			share();
			publish();
		};
	}, [ site.id, anchor ] );
	const selectTab = ( value: unknown ) => {
		setTab( value as Tab );
		if ( value === 'publish' ) setRequest( ( current ) => current ?? { view: 'publish' } );
	};
	return (
		<>
			<Dialog open={ open && ! signedOut && ! previewAction } onOpenChange={ setOpen }>
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
								open={ open && tab === 'share' }
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
							{ request ? (
								<PublishPanel
									site={ site }
									open={ open && tab === 'publish' }
									request={ request }
									headerContainer={ publishHeader }
									onSubstepChange={ setPublishSubstep }
									setupAfterSignup={ setupAfterSignup }
									onSetupAfterSignup={ () => setSetupAfterSignup( false ) }
								/>
							) : null }
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
				onOpenChange={ setOpen }
				finalFocus={ finalFocus }
				title={ tab === 'share' ? __( 'Share your WordPress' ) : __( 'Publish your WordPress' ) }
				description={
					tab === 'share'
						? __( 'Create an account or log in to share previews and keep your sites in sync.' )
						: __( 'Create an account or log in to publish a website and keep your sites in sync.' )
				}
				source={ tab === 'share' ? 'previews_tab' : 'sync_tab' }
				onCreateAccount={ tab === 'publish' ? () => setSetupAfterSignup( true ) : undefined }
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
							variant="outline"
							size="header"
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
					<span>{ __( 'Share' ) }</span>
				</TooltipTrigger>
				<TooltipContent side="bottom">{ __( 'Share' ) }</TooltipContent>
			</Tooltip>
		</span>
	);
}

export function PublishButton( props: { site: SiteDetails } ) {
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
			variant="default"
			size="header"
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
			) : null }
			<span className={ styles.triggerLabel }>
				{ __( 'Publish' ) }
				{ transfer?.kind === 'error' || setupError ? <span className={ styles.errorDot } /> : null }
			</span>
		</Button>
	);
}
