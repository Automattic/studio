import { IconButton, Spinner } from '@studio/ds';
import { PlayIcon, SquareIcon } from '@studio/ds/icons';
import { __ } from '@wordpress/i18n';
import {
	createContext,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
} from 'react';
import { useInlineEndControlsInset } from '@/data/host/use-window-controls-inset';
import { useIsSiteStarting, useIsSiteStopping, useStopSite } from '@/data/queries/use-sites';
import { useSiteLifecycleState } from '@/data/use-site-lifecycle-state';
import { useStartSiteWithChat } from '@/data/use-start-site-with-chat';
import { PublishButton } from '@/features/site-delivery';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

interface SiteHeaderContextValue {
	// The header the actions sit over: the panel's, or the chat's while the
	// chat fills the workspace.
	host: 'chat' | 'panel' | null;
	actionsWidth: number;
	annotationTarget: HTMLElement | null;
	attachAnnotationTarget: ( node: HTMLElement | null ) => void;
	attachActions: ( node: HTMLElement | null ) => void;
}

const SiteHeaderContext = createContext< SiteHeaderContextValue >( {
	host: null,
	actionsWidth: 0,
	annotationTarget: null,
	attachAnnotationTarget: () => undefined,
	attachActions: () => undefined,
} );

export const useSiteHeader = () => useContext( SiteHeaderContext );

/** Keeps delivery actions and their dialogs mounted while the panel layout changes. */
export function SiteHeaderActionsProvider( {
	host,
	children,
}: {
	host: 'chat' | 'panel';
	children: ReactNode;
} ) {
	const [ actions, attachActions ] = useState< HTMLElement | null >( null );
	const [ actionsWidth, setActionsWidth ] = useState( 0 );
	const [ annotationTarget, attachAnnotationTarget ] = useState< HTMLElement | null >( null );
	useLayoutEffect( () => {
		if ( ! actions ) return;
		const measure = () => setActionsWidth( actions.getBoundingClientRect().width );
		const observer = new ResizeObserver( measure );
		observer.observe( actions );
		measure();
		return () => observer.disconnect();
	}, [ actions ] );

	return (
		<SiteHeaderContext.Provider
			value={ {
				host,
				actionsWidth,
				annotationTarget,
				attachAnnotationTarget,
				attachActions,
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

/** Site actions stay in one place as the panel opens and closes. */
export function SiteHeaderActions( { site }: { site: SiteDetails } ) {
	const { attachActions, attachAnnotationTarget } = useSiteHeader();
	const root = useRef< HTMLDivElement >( null );
	const inset = useInlineEndControlsInset();
	const start = useStartSiteWithChat();
	const stop = useStopSite();
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const { starting, stoppingStart, canStopStart, visualRunning, visualBusy, disabled } =
		useSiteLifecycleState( site, isStarting, isStopping );
	const publishButton = (
		<span data-site-header-publish className={ styles.publish }>
			<PublishButton key={ site.id } site={ site } />
		</span>
	);
	return (
		<div
			ref={ root }
			className={ styles.root }
			style={ { paddingInlineEnd: `calc( var( --band-inset ) + ${ inset }px )` } }
			data-site-header-actions
		>
			<div ref={ attachActions } className={ styles.actions }>
				<span ref={ attachAnnotationTarget } className={ styles.annotation } />
				<div data-site-header-delivery className={ styles.delivery }>
					{ publishButton }
					<IconButton
						variant="ghost"
						size="icon-sm"
						className={ styles.lifecycle }
						icon={
							visualBusy ? (
								<>
									<Spinner
										aria-hidden="true"
										className={ canStopStart ? styles.startSpinner : undefined }
									/>
									{ canStopStart && <SquareIcon className={ styles.cancelStartIcon } /> }
								</>
							) : visualRunning ? (
								<SquareIcon />
							) : (
								<PlayIcon />
							)
						}
						label={
							stoppingStart
								? __( 'Stopping' )
								: starting && ! canStopStart
								? __( 'Starting site' )
								: visualRunning || canStopStart
								? __( 'Stop site' )
								: __( 'Start site' )
						}
						aria-busy={ visualBusy || undefined }
						tooltipSide="bottom"
						disabled={ disabled }
						onClick={ () => ( site.running || canStopStart ? stop : start ).mutate( site.id ) }
					/>
				</div>
			</div>
		</div>
	);
}
