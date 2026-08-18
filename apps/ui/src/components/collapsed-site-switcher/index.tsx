import { __ } from '@wordpress/i18n';
import { privateApis } from '@wordpress/theme';
import { clsx } from 'clsx';
import {
	useEffect,
	useRef,
	useState,
	type FocusEvent,
	type KeyboardEvent,
	type ReactNode,
} from 'react';
import { SiteList } from '@/components/site-list';
import { unlock } from '@/lock-unlock';
import styles from './style.module.css';

const { ThemeProvider } = unlock( privateApis );
const HOVER_CLOSE_DELAY_MS = 350;

export function CollapsedSiteSwitcher( {
	backgroundColor,
	children,
}: {
	backgroundColor: string;
	children: ReactNode;
} ) {
	const rootRef = useRef< HTMLDivElement >( null );
	const closeTimerRef = useRef< number | undefined >( undefined );
	const [ dismissed, setDismissed ] = useState( false );
	const [ hoverOpen, setHoverOpen ] = useState( false );

	const clearCloseTimer = () => {
		if ( closeTimerRef.current !== undefined ) {
			window.clearTimeout( closeTimerRef.current );
			closeTimerRef.current = undefined;
		}
	};

	useEffect(
		() => () => {
			if ( closeTimerRef.current !== undefined ) {
				window.clearTimeout( closeTimerRef.current );
			}
		},
		[]
	);

	const openFromHover = () => {
		clearCloseTimer();
		setHoverOpen( true );
	};

	const scheduleHoverClose = () => {
		clearCloseTimer();
		closeTimerRef.current = window.setTimeout( () => {
			setHoverOpen( false );
			closeTimerRef.current = undefined;
		}, HOVER_CLOSE_DELAY_MS );
	};

	const dismiss = () => {
		clearCloseTimer();
		setHoverOpen( false );
		setDismissed( true );
		rootRef.current?.querySelector< HTMLButtonElement >( 'button[aria-label]' )?.focus();
	};

	const handleBlur = ( event: FocusEvent< HTMLDivElement > ) => {
		if ( ! event.currentTarget.contains( event.relatedTarget ) ) {
			setDismissed( false );
		}
	};
	const handleKeyDown = ( event: KeyboardEvent< HTMLDivElement > ) => {
		if ( event.key === 'Escape' ) {
			dismiss();
		}
	};

	return (
		<div
			ref={ rootRef }
			className={ clsx(
				styles.root,
				hoverOpen && styles.hoverOpen,
				dismissed && styles.dismissed
			) }
			data-dismissed={ dismissed || undefined }
			data-hover-open={ hoverOpen || undefined }
			onBlur={ handleBlur }
			onKeyDown={ handleKeyDown }
			onMouseEnter={ openFromHover }
			onMouseLeave={ scheduleHoverClose }
		>
			<span className={ styles.trigger } onMouseEnter={ () => setDismissed( false ) }>
				{ children }
			</span>
			<div className={ styles.popup }>
				<ThemeProvider color={ { bg: backgroundColor } }>
					<nav
						className={ styles.popupThemeScope }
						aria-label={ __( 'Sites' ) }
						style={ { backgroundColor } }
					>
						<SiteList className={ styles.siteList } onSiteOpen={ dismiss } />
					</nav>
				</ThemeProvider>
			</div>
		</div>
	);
}
