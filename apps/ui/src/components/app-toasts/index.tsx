import { clsx } from 'clsx';
import { useEffect } from 'react';
import { NoticeCard } from '@/components/notice-card';
import { useNoticeHistoryOpen } from '@/components/notice-history';
import {
	dismissToast,
	getVisibleToasts,
	notifyRendererMounted,
	notifyRendererUnmounted,
	pauseToastExpiry,
	resumeToastExpiry,
	useQueuedToasts,
	useVisibleToasts,
} from '@/data/app-messages';
import styles from './style.module.css';

export function AppToasts() {
	const toasts = useVisibleToasts();
	const queued = useQueuedToasts();
	const historyOpen = useNoticeHistoryOpen();

	useEffect( () => {
		notifyRendererMounted();
		return () => notifyRendererUnmounted();
	}, [] );

	// The history lists them, so they hide and run out their time meanwhile.
	useEffect( () => {
		if ( historyOpen ) {
			getVisibleToasts().forEach( ( item ) => resumeToastExpiry( item.id ) );
		}
	}, [ historyOpen ] );

	if ( historyOpen ) {
		return null;
	}

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
						onFocus={ () => pauseToastExpiry( item.id ) }
						onBlur={ ( event ) => {
							if ( ! event.currentTarget.contains( event.relatedTarget ) ) {
								resumeToastExpiry( item.id );
							}
						} }
					>
						<NoticeCard notice={ item } onDismiss={ () => dismissToast( item.id ) } />
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
