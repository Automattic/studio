import { __ } from '@wordpress/i18n';
import { Button, Notice } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect } from 'react';
import {
	dismissToast,
	notifyRendererMounted,
	notifyRendererUnmounted,
	pauseToastExpiry,
	resumeToastExpiry,
	useQueuedToastCount,
	useVisibleToasts,
} from '@/data/app-messages';
import styles from './style.module.css';

// Renders the ephemeral app-message toasts (see data/app-messages.ts).
// A single instance is placed by SidebarLayout — in the sidebar footer when
// expanded, floating over the main panel when collapsed — so it inherits the
// right ThemeProvider scope from wherever it mounts. Renders nothing while
// there are no toasts, so mount points carry no empty chrome.
export function AppToasts( {
	className,
	fit = 'row',
}: {
	className?: string;
	// 'row' stretches toasts to the shelf width (sidebar footer, matching the
	// site rows); 'content' lets each toast hug its text up to the shelf's
	// max-width (the floating collapsed shelf).
	fit?: 'row' | 'content';
} ) {
	const toasts = useVisibleToasts();
	const queuedCount = useQueuedToastCount();

	// Toast expiry is gated on a mounted renderer so toasts fired while no
	// AppToasts is on screen wait (fully visible) instead of expiring unseen.
	useEffect( () => {
		notifyRendererMounted();
		return () => notifyRendererUnmounted();
	}, [] );

	if ( ! toasts.length ) {
		return null;
	}

	return (
		<div className={ clsx( fit === 'content' && styles.shelfHug, className ) }>
			{ /* The inner stack is what hugs in `content` fit: it shrinks to the
			     widest toast (the shelf keeps a definite width — an absolutely
			     positioned shelf with auto width would resolve to min-content),
			     and the peek slivers span the same stack width. */ }
			<div className={ styles.stack }>
				{ toasts.map( ( item ) => (
					<div
						key={ item.id }
						// Collapsible row: grid-template-rows 0fr↔1fr animates the
						// space a toast occupies, so neighbors slide (not jump) as
						// it enters and leaves.
						className={ styles.cell }
						data-leaving={ item.leaving ? '' : undefined }
					>
						<div
							className={ styles.toast }
							onMouseEnter={ () => pauseToastExpiry( item.id ) }
							onMouseLeave={ () => resumeToastExpiry( item.id ) }
						>
							{ /* Keyed on the notice's shape, not just its id: a toast that is
							     replaced in place can gain or lose optional Notice children,
							     which changes the component's internal hook layout. */ }
							<Notice.Root
								key={ `${ item.intent }:${ !! item.description }:${ !! item.action }` }
								intent={ item.intent }
								className={ styles.notice }
							>
								<Notice.Title>{ item.title }</Notice.Title>
								{ item.description ? (
									<Notice.Description>{ item.description }</Notice.Description>
								) : null }
								{ item.action ? (
									<Notice.Actions>
										{ /* Notice.ActionButton doesn't expose `size`; the plain
										     Button primitive does. */ }
										<Button
											size="small"
											variant="solid"
											tone="neutral"
											className={ styles.actionButton }
											onClick={ item.action.onClick }
										>
											{ item.action.label }
										</Button>
									</Notice.Actions>
								) : null }
								<Notice.CloseIcon
									label={ __( 'Dismiss' ) }
									onClick={ () => dismissToast( item.id ) }
								/>
							</Notice.Root>
						</div>
					</div>
				) ) }
				{ /* Stacked-card slivers hint at queued toasts waiting behind the
				     visible ones; they promote as these expire or are dismissed. */ }
				{ queuedCount > 0 ? <div className={ styles.queuePeek } aria-hidden="true" /> : null }
				{ queuedCount > 1 ? (
					<div className={ clsx( styles.queuePeek, styles.queuePeekDeeper ) } aria-hidden="true" />
				) : null }
			</div>
		</div>
	);
}
