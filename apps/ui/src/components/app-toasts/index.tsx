import { __ } from '@wordpress/i18n';
import { closeSmall, Icon, info } from '@wordpress/icons';
import { clsx } from 'clsx';
import { useEffect } from 'react';
import { CopyNoticeButton, openNoticeHistory } from '@/components/notice-history';
import { Button, IconButton } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
	dismissToast,
	notifyRendererMounted,
	notifyRendererUnmounted,
	pauseToastExpiry,
	resumeToastExpiry,
	runToastAction,
	useQueuedToasts,
	useVisibleToasts,
	type ToastIntent,
	type ToastMessage,
} from '@/data/app-messages';
import styles from './style.module.css';

// Error text is clamped in the toast; these get Copy (the full text) and More
// (the recent-notifications dialog, where it runs in full).
function hasErrorDetails( item: ToastMessage ) {
	return item.intent === 'error' && Boolean( item.description );
}

function StatusIcon( { intent }: { intent: ToastIntent } ) {
	return (
		<span className={ styles.status } data-intent={ intent } aria-hidden="true">
			{ intent === 'info' ? (
				<Icon icon={ info } size={ 18 } />
			) : (
				<svg viewBox="0 0 24 24" fill="none">
					<path
						d={ intent === 'success' ? 'M20 6 9 17l-5-5' : 'M18 6 6 18M6 6l12 12' }
						stroke="currentColor"
						strokeWidth="3"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			) }
		</span>
	);
}

export function AppToasts() {
	const toasts = useVisibleToasts();
	const queued = useQueuedToasts();

	useEffect( () => {
		notifyRendererMounted();
		return () => notifyRendererUnmounted();
	}, [] );

	return (
		<div className={ styles.viewport } aria-live="polite" aria-relevant="additions">
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
						<div className={ styles.card }>
							<div className={ styles.row }>
								<StatusIcon intent={ item.intent } />
								<p className={ styles.title }>{ item.title }</p>
								{ item.action ? (
									<Button
										size="sm"
										disabled={ item.actionPending }
										aria-busy={ item.actionPending || undefined }
										onClick={ () => void runToastAction( item.id ) }
									>
										{ item.actionPending ? <Spinner aria-hidden="true" /> : null }
										{ item.action.label }
									</Button>
								) : null }
							</div>
							{ item.description ? (
								<p className={ styles.description }>{ item.description }</p>
							) : null }
							{ hasErrorDetails( item ) ? (
								<div className={ styles.details }>
									<CopyNoticeButton notice={ item } />
									<Button variant="outline" size="2xs" onClick={ openNoticeHistory }>
										{ __( 'More' ) }
									</Button>
								</div>
							) : null }
							<IconButton
								className={ styles.close }
								icon={ closeSmall }
								label={ __( 'Dismiss' ) }
								variant="outline"
								size="icon-2xs"
								shape="round"
								onClick={ () => dismissToast( item.id ) }
							/>
						</div>
					</div>
				</div>
			) ) }
			{ queued.slice( 0, 2 ).map( ( item, index ) => (
				<div
					key={ item.id }
					className={ clsx( styles.queuePeek, index === 1 && styles.queuePeekDeeper ) }
					aria-hidden="true"
				/>
			) ) }
		</div>
	);
}
