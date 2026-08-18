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

	useEffect( () => {
		notifyRendererMounted();
		return () => notifyRendererUnmounted();
	}, [] );

	return (
		<div
			className={ clsx( fit === 'content' && styles.shelfHug, className ) }
			aria-live="polite"
			aria-relevant="additions"
		>
			{ toasts.length > 0 ? (
				<div className={ styles.stack }>
					{ toasts.map( ( item ) => (
						<div
							key={ item.id }
							className={ styles.cell }
							data-leaving={ item.leaving ? '' : undefined }
						>
							<div
								className={ styles.toast }
								onMouseEnter={ () => pauseToastExpiry( item.id ) }
								onMouseLeave={ () => resumeToastExpiry( item.id ) }
							>
								{ /* Keyed on the notice's shape, not just its id: a toast that is
								     replaced in place — a running sync becoming its result —
								     can gain or lose a description, and reusing the same Notice
								     across that change misaligns its internal hooks. */ }
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
					{ queuedCount > 0 ? <div className={ styles.queuePeek } aria-hidden="true" /> : null }
					{ queuedCount > 1 ? (
						<div
							className={ clsx( styles.queuePeek, styles.queuePeekDeeper ) }
							aria-hidden="true"
						/>
					) : null }
				</div>
			) : null }
		</div>
	);
}
