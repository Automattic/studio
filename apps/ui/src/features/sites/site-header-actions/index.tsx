import { isRTL, __ } from '@wordpress/i18n';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useConnector } from '@/data/core';
import { useTrafficLightSpace } from '@/data/host/use-traffic-light-space';
import { useIsSiteBusy, useStartSite } from '@/data/queries/use-sites';
import { useSessionPreviewUI } from '@/data/use-session-ui';
import {
	AnnotationCancelButton,
	hasAnnotationContent,
	isStagedAnnotation,
	isAnnotationsBusy,
	setAnnotating,
	useSiteAnnotations,
} from '@/features/annotations';
import { ShareButton, PublishButton, SiteDeliveryDialog } from '@/features/site-delivery';
import { AnnotateButton } from '@/features/sites/site-preview/preview-header/annotate-button';
import { useMediaQuery, useWindowControlsOverlay } from '@/lib/hooks';
import styles from './style.module.css';
import { useSiteHeaderLayout, type SiteHeaderLayout } from './use-site-header-layout';
import type { SiteDetails } from '@/data/core';

/** Annotation availability from the visible preview surface. */
interface SiteHeaderNavigation {
	annotate?: { active: boolean; disabled: boolean; disabledReason?: string; onClick: () => void };
}

interface SiteHeaderContextValue {
	// The header the actions sit over: the preview's, or the chat's while the
	// chat fills the workspace.
	host: 'chat' | 'preview' | null;
	layout: SiteHeaderLayout;
	actionsWidth: number;
	browserSpace: HTMLElement | null;
	attachBrowserSpace: ( node: HTMLElement | null ) => void;
	navigation: SiteHeaderNavigation | null;
	attachActions: ( node: HTMLElement | null ) => void;
	setNavigation: ( navigation: SiteHeaderNavigation | null ) => void;
}

const SiteHeaderContext = createContext< SiteHeaderContextValue >( {
	host: null,
	layout: 'inline',
	actionsWidth: 0,
	browserSpace: null,
	attachBrowserSpace: () => undefined,
	navigation: null,
	attachActions: () => undefined,
	setNavigation: () => undefined,
} );

export const useSiteHeader = () => useContext( SiteHeaderContext );

/** Keeps delivery actions and their dialogs mounted while the preview layout changes. */
export function SiteHeaderActionsProvider( {
	host,
	children,
}: {
	host: 'chat' | 'preview';
	children: ReactNode;
} ) {
	const [ actions, attachActions ] = useState< HTMLElement | null >( null );
	const [ navigation, setNavigation ] = useState< SiteHeaderNavigation | null >( null );
	const [ browserSpace, attachBrowserSpace ] = useState< HTMLElement | null >( null );
	const { layout, actionsWidth } = useSiteHeaderLayout( actions, browserSpace );

	return (
		<SiteHeaderContext.Provider
			value={ {
				host,
				layout,
				actionsWidth,
				browserSpace,
				attachBrowserSpace,
				navigation: host === 'preview' ? navigation : null,
				attachActions,
				setNavigation,
			} }
		>
			{ children }
		</SiteHeaderContext.Provider>
	);
}

/** The room a header leaves for the site actions drawn over it. */
export function SiteHeaderSpace() {
	const { actionsWidth } = useSiteHeader();
	return <div className={ styles.space } style={ { width: actionsWidth } } />;
}

/** Registers the preview row for its narrow-window layout. */
export function SiteHeaderBrowserSpace() {
	const { attachBrowserSpace } = useSiteHeader();
	return <div ref={ attachBrowserSpace } className={ styles.browserSpace } />;
}

/** Keeps the header annotation action connected to the visible preview. */
export function useSiteHeaderNavigation( navigation: SiteHeaderNavigation | null ) {
	const { setNavigation } = useSiteHeader();
	const latest = useRef( navigation );
	useEffect( () => {
		latest.current = navigation;
	} );
	const available = navigation !== null;
	const annotateActive = navigation?.annotate?.active;
	const annotateDisabled = navigation?.annotate?.disabled;
	const annotateDisabledReason = navigation?.annotate?.disabledReason;
	const hasAnnotate = Boolean( navigation?.annotate );
	useEffect( () => {
		if ( ! available ) {
			return;
		}
		setNavigation( {
			annotate: hasAnnotate
				? {
						active: annotateActive ?? false,
						disabled: annotateDisabled ?? false,
						disabledReason: annotateDisabledReason,
						onClick: () => latest.current?.annotate?.onClick(),
				  }
				: undefined,
		} );
		return () => setNavigation( null );
	}, [
		annotateActive,
		annotateDisabled,
		annotateDisabledReason,
		hasAnnotate,
		available,
		setNavigation,
	] );
}

/** Site actions stay in one place as the preview opens and closes. */
export function SiteHeaderActions( {
	site,
	live = false,
	onStartAnnotating,
	onSendAnnotations,
	end,
}: {
	site: SiteDetails;
	live?: boolean;
	onStartAnnotating?: () => boolean;
	onSendAnnotations?: ( siteId: string ) => void;
	end?: ReactNode;
} ) {
	const { navigation, attachActions } = useSiteHeader();
	const connector = useConnector();
	const startSite = useStartSite();
	const busy = useIsSiteBusy( site );
	const preview = useSessionPreviewUI();
	const annotations = useSiteAnnotations( site.id );
	const narrow = useMediaQuery( '(max-width: 540px)' );
	const annotation = navigation?.annotate ?? {
		active: annotations.active,
		disabled: live || busy || ! connector.capabilities.annotatePreview,
		disabledReason: ! connector.capabilities.annotatePreview
			? __( 'Site annotation is not available in the browser yet' )
			: undefined,
		onClick: () => {
			if ( annotations.active ) {
				setAnnotating( site.id, false );
				return;
			}
			if ( onStartAnnotating?.() === false ) return;
			preview.setOpen( true, { instant: ! site.running } );
			preview.setChatHidden( narrow, site.id );
			setAnnotating( site.id, true );
			if ( ! site.running ) {
				startSite.mutate( site.id, { onError: () => setAnnotating( site.id, false ) } );
			}
		},
	};
	const root = useRef< HTMLDivElement >( null );
	const windowControls = useWindowControlsOverlay();
	const trafficLightSpace = useTrafficLightSpace();
	// The Windows/Linux window controls sit at the physical right, the macOS
	// traffic lights at the physical left: whichever the inline end reaches.
	let inset = 0;
	if ( isRTL() ) {
		inset += trafficLightSpace.end ? 88 : 0;
	} else {
		inset += windowControls?.controlsWidth ?? 0;
	}
	const publishButton = (
		<span data-site-header-publish className={ styles.publish }>
			<PublishButton site={ site } />
		</span>
	);
	return (
		<div
			ref={ root }
			className={ styles.root }
			style={ { paddingInlineEnd: `calc( var( --band-inset ) + ${ inset }px )` } }
			data-site-header-actions
		>
			<SiteDeliveryDialog key={ site.id } site={ site } anchor={ root } />
			<div ref={ attachActions } className={ styles.actions }>
				<div data-site-header-delivery className={ styles.delivery }>
					<span data-site-header-annotate className={ styles.item }>
						<AnnotateButton
							{ ...annotation }
							iconOnly
							cancel={
								<AnnotationCancelButton
									siteId={ site.id }
									iconOnly
									size="icon-xs"
									className={ styles.annotationCancel }
								/>
							}
							send={ {
								count: annotations.notes.filter( hasAnnotationContent ).length,
								visible: annotations.notes.some( isStagedAnnotation ),
								disabled: isAnnotationsBusy( annotations ) || ! onSendAnnotations,
								loading: Boolean( annotations.sending ),
								onClick: () => {
									onSendAnnotations?.( site.id );
									setAnnotating( site.id, false );
								},
							} }
						/>
					</span>
					<span data-site-header-share className={ styles.item }>
						<ShareButton site={ site } />
					</span>
					{ publishButton }
				</div>
				{ end ? (
					<span data-site-header-end className={ styles.item }>
						{ end }
					</span>
				) : null }
			</div>
		</div>
	);
}
