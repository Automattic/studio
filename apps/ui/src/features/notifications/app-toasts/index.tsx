// eslint-disable-next-line no-restricted-imports -- toasts render only here, so Toast has no primitive.
import { Toast } from '@base-ui/react/toast';
import { __ } from '@wordpress/i18n';
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import {
	dismissToast,
	getVisibleToasts,
	notifyRendererMounted,
	notifyRendererUnmounted,
	pauseToastExpiry,
	resumeToastExpiry,
	useVisibleToasts,
	type ToastMessage,
} from '@/data/app-messages';
import { NoticeCard } from '@/features/notifications/notice-card';
import styles from './style.module.css';

const pauseAll = () => getVisibleToasts().forEach( ( item ) => pauseToastExpiry( item.id ) );
const resumeAll = () => getVisibleToasts().forEach( ( item ) => resumeToastExpiry( item.id ) );

function ToastDeck() {
	const { toasts } = Toast.useToastManager();
	const pointerGesture = useRef< { x: number; y: number; dragged: boolean } | null >( null );
	return (
		<Toast.Viewport
			className={ styles.viewport }
			data-overflow={ toasts.length > 3 || undefined }
			aria-label={ __( 'Notifications' ) }
			onMouseEnter={ pauseAll }
			onMouseLeave={ resumeAll }
			onFocus={ pauseAll }
			onBlur={ ( event: FocusEvent< HTMLDivElement > ) => {
				if ( ! event.currentTarget.contains( event.relatedTarget ) ) {
					resumeAll();
				}
			} }
		>
			{ toasts.map( ( item ) => {
				const notice = item.data as ToastMessage;
				return (
					<Toast.Root
						key={ item.id }
						toast={ item }
						swipeDirection={ notice.dismissible === false ? [] : undefined }
						onKeyDown={ ( event ) => {
							if ( notice.dismissible === false && event.key === 'Escape' )
								event.preventBaseUIHandler();
						} }
						className={ styles.toast }
						aria-label={ notice.title }
						onPointerDown={ ( event ) => {
							pointerGesture.current = { x: event.clientX, y: event.clientY, dragged: false };
						} }
						onPointerMove={ ( event ) => {
							const gesture = pointerGesture.current;
							if (
								gesture &&
								Math.hypot( event.clientX - gesture.x, event.clientY - gesture.y ) > 5
							) {
								gesture.dragged = true;
							}
						} }
						onClick={ ( event ) => {
							if (
								event.defaultPrevented ||
								event.target !== event.currentTarget ||
								( event.detail > 0 && pointerGesture.current?.dragged )
							) {
								return;
							}
							// Swipe capture sends clicks to the toast root instead of NoticeCard.
							event.currentTarget.querySelector< HTMLElement >( '[role="presentation"]' )?.click();
						} }
					>
						<Toast.Content className={ styles.content }>
							<NoticeCard
								className={ styles.card }
								notice={ notice }
								onDismiss={
									notice.dismissible === false ? undefined : () => dismissToast( notice.id )
								}
							/>
						</Toast.Content>
					</Toast.Root>
				);
			} ) }
		</Toast.Viewport>
	);
}

export function AppToasts() {
	const toasts = useVisibleToasts();
	const [ manager ] = useState( Toast.createToastManager );
	const synced = useRef< readonly ToastMessage[] >( [] );

	useEffect( () => {
		notifyRendererMounted();
		return () => notifyRendererUnmounted();
	}, [] );

	useEffect( () => {
		for ( const item of toasts ) {
			if ( synced.current.includes( item ) ) {
				continue;
			}
			if ( item.leaving ) {
				manager.close( item.id );
			} else {
				manager.add( {
					id: item.id,
					data: item,
					timeout: 0,
					onClose: () => dismissToast( item.id ),
				} );
			}
		}
		synced.current = toasts;
	}, [ toasts, manager ] );

	return (
		<Toast.Provider toastManager={ manager } timeout={ 0 } limit={ Infinity }>
			<ToastDeck />
		</Toast.Provider>
	);
}
