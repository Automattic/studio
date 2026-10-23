import { Toast } from '@base-ui/react/toast';
import { __ } from '@wordpress/i18n';
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { NoticeCard } from '@/components/notice-card';
import { useNoticeHistoryOpen } from '@/components/notice-history';
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
import styles from './style.module.css';

const pauseAll = () => getVisibleToasts().forEach( ( item ) => pauseToastExpiry( item.id ) );
const resumeAll = () => getVisibleToasts().forEach( ( item ) => resumeToastExpiry( item.id ) );

function ToastDeck() {
	const { toasts } = Toast.useToastManager();
	return (
		<Toast.Viewport
			className={ styles.viewport }
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
						className={ styles.toast }
						aria-label={ notice.title }
					>
						<Toast.Content className={ styles.content }>
							<NoticeCard
								className={ styles.card }
								notice={ notice }
								onDismiss={ () => dismissToast( notice.id ) }
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
	const historyOpen = useNoticeHistoryOpen();
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

	// The history lists them, so they hide and run out their time meanwhile.
	useEffect( () => {
		if ( historyOpen ) {
			resumeAll();
		}
	}, [ historyOpen ] );

	return (
		<Toast.Provider toastManager={ manager } timeout={ 0 } limit={ 3 }>
			{ historyOpen ? null : <ToastDeck /> }
		</Toast.Provider>
	);
}
