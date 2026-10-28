import { canCancelSyncActivity } from '@studio/common/lib/sync/cancel';
import { useIsMutating } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { ChevronLeftIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import {
	PULL_FROM_LIVE_MUTATION_KEY,
	PUSH_TO_LIVE_MUTATION_KEY,
} from '@/data/queries/use-sync-site';
import { PublishTransferIcon } from '@/lib/icons';
import { Button, Progress, Spinner, VisuallyHidden } from '@/lib/ui';
import styles from './style.module.css';
import type { SyncActivity } from '@/data/sync-activity';

export function PanelHeader( {
	title,
	onBack,
	backLabel,
	showTitle = false,
	className,
	children,
}: {
	title: string;
	onBack?: () => void;
	backLabel?: string;
	showTitle?: boolean;
	className?: string;
	children?: ReactNode;
} ) {
	const back = useRef< HTMLButtonElement >( null );
	const hasBack = Boolean( onBack );
	useEffect( () => {
		if ( ! hasBack ) {
			return;
		}
		const frame = requestAnimationFrame(
			() => back.current?.focus( { focusVisible: false } as FocusOptions )
		);
		return () => cancelAnimationFrame( frame );
	}, [ hasBack, title ] );
	if ( ! onBack && ! showTitle ) {
		return <VisuallyHidden>{ title }</VisuallyHidden>;
	}
	return (
		<div className={ clsx( styles.panelHeader, className ) }>
			{ onBack ? (
				<Button
					ref={ back }
					variant="segmented"
					size="icon-sm"
					aria-label={ backLabel ?? __( 'Back to Publish' ) }
					onClick={ onBack }
				>
					<ChevronLeftIcon />
				</Button>
			) : null }
			<h2 className={ styles.heading }>{ title }</h2>
			{ children }
		</div>
	);
}

export function PanelBody( {
	children,
	insetTop = false,
	loading = false,
}: {
	children?: ReactNode;
	insetTop?: boolean;
	loading?: boolean;
} ) {
	return (
		<div className={ clsx( styles.body, insetTop && styles.bodyInsetTop ) }>
			{ loading ? (
				<div className={ styles.loading }>
					<Spinner aria-label={ __( 'Loading…' ) } />
				</div>
			) : (
				children
			) }
		</div>
	);
}

export function ErrorMessage( { error, retry }: { error: unknown; retry?: () => void } ) {
	if ( ! error ) {
		return null;
	}
	return (
		<div className={ styles.errorMessage } role="alert">
			<p className={ styles.error }>{ error instanceof Error ? error.message : String( error ) }</p>
			{ retry ? (
				<Button variant="outline" size="2xs" onClick={ retry }>
					{ __( 'Try again' ) }
				</Button>
			) : null }
		</div>
	);
}

// Only this window can stop a sync it started; one run by the agent or another
// window is out of its reach.
function useStartedHere( siteId: string, direction: 'push' | 'pull' ) {
	return (
		useIsMutating( {
			mutationKey: direction === 'push' ? PUSH_TO_LIVE_MUTATION_KEY : PULL_FROM_LIVE_MUTATION_KEY,
			predicate: ( mutation ) =>
				( mutation.state.variables as { siteId: string } | undefined )?.siteId === siteId,
		} ) > 0
	);
}

export function TransferProgress( {
	siteId,
	activity,
	scopeLabel,
	cancel,
	cancelling,
}: {
	siteId: string;
	activity: Extract< SyncActivity, { kind: 'pending' } >;
	scopeLabel?: string;
	cancel: () => void;
	cancelling: boolean;
} ) {
	const pushing = activity.direction === 'push';
	const startedHere = useStartedHere( siteId, pushing ? 'push' : 'pull' );
	const cancellable =
		startedHere && activity.remoteSiteId !== undefined && canCancelSyncActivity( activity );
	return (
		<div className={ styles.progress } role="status" aria-live="polite">
			{ scopeLabel && startedHere ? <p className={ styles.text }>{ scopeLabel }</p> : null }
			<div className={ styles.progressTitle }>
				<PublishTransferIcon direction={ pushing ? 'push' : 'pull' } />
				<span className={ styles.heading }>
					{ activity.message || ( pushing ? __( 'Publishing…' ) : __( 'Pulling changes…' ) ) }
				</span>
			</div>
			{ activity.progress !== undefined ? (
				<Progress
					value={ activity.progress }
					aria-label={ pushing ? __( 'Publishing progress' ) : __( 'Pull progress' ) }
				/>
			) : null }
			{ cancellable ? (
				<Button variant="inline-text" size="inline" disabled={ cancelling } onClick={ cancel }>
					{ cancelling
						? __( 'Cancelling…' )
						: pushing
						? __( 'Cancel publishing' )
						: __( 'Cancel pull' ) }
				</Button>
			) : null }
		</div>
	);
}
