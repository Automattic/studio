import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { XIcon } from 'lucide-react';
import {
	createContext,
	useCallback,
	useContext,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import { IconButton } from '@/lib/ui/button';
import surfaceStyles from '@/lib/ui/surface/style.module.css';
import styles from './style.module.css';
import type { ComponentProps, ReactNode, Ref } from 'react';

type Layout = 'default' | 'settings' | 'creation' | 'confirmation';

const DialogContentContext = createContext< { showCloseButton: boolean; layout: Layout } >( {
	showCloseButton: true,
	layout: 'default',
} );

export const Dialog = BaseDialog.Root;
/** A dialog that only closes through its own actions: no outside click or backdrop dismissal. */
export const AlertDialog = BaseAlertDialog.Root;
export const DialogClose = BaseDialog.Close;

export function DialogDismissButton( {
	label = __( 'Close' ),
	...props
}: Partial< ComponentProps< typeof IconButton > > ) {
	return (
		<IconButton
			variant="outline"
			size="icon-sm"
			icon={ <XIcon /> }
			label={ label }
			tooltip={ false }
			{ ...props }
		/>
	);
}

export function DialogContent( {
	className,
	children,
	showCloseButton = true,
	layout = 'default',
	surface = 'default',
	backdrop = 'dimmed',
	...props
}: ComponentProps< typeof BaseDialog.Popup > & {
	showCloseButton?: boolean;
	layout?: Layout;
	surface?: 'default' | 'composer';
	backdrop?: 'dimmed' | 'transparent';
} ) {
	return (
		<BaseDialog.Portal>
			<BaseDialog.Backdrop data-variant={ backdrop } className={ styles.overlay } />
			<BaseDialog.Popup
				data-slot="dialog-content"
				data-layout={ layout }
				data-surface={ surface }
				className={ clsx( surfaceStyles.floating, styles.content, className ) }
				{ ...props }
			>
				<DialogContentContext.Provider value={ { showCloseButton, layout } }>
					{ children }
				</DialogContentContext.Provider>
			</BaseDialog.Popup>
		</BaseDialog.Portal>
	);
}

export function DialogHeader( { className, children, ...props }: ComponentProps< 'div' > ) {
	const { showCloseButton } = useContext( DialogContentContext );
	return (
		<div data-slot="dialog-header" className={ clsx( styles.header, className ) } { ...props }>
			{ children }
			{ showCloseButton && (
				<BaseDialog.Close className={ styles.headerClose } render={ <DialogDismissButton /> } />
			) }
		</div>
	);
}

export function DialogFooter( {
	className,
	separator = false,
	padding = false,
	...props
}: ComponentProps< 'div' > & { separator?: boolean; padding?: boolean } ) {
	return (
		<div
			data-slot="dialog-footer"
			data-separator={ separator || undefined }
			data-padding={ padding || undefined }
			className={ clsx( styles.footer, className ) }
			{ ...props }
		/>
	);
}

export function DialogTitle( { className, ...props }: ComponentProps< typeof BaseDialog.Title > ) {
	return (
		<BaseDialog.Title
			data-slot="dialog-title"
			className={ clsx( styles.title, className ) }
			{ ...props }
		/>
	);
}

export function DialogDescription( {
	className,
	tone = 'muted',
	...props
}: ComponentProps< typeof BaseDialog.Description > & { tone?: 'muted' | 'default' } ) {
	return (
		<BaseDialog.Description
			data-slot="dialog-description"
			data-tone={ tone }
			className={ clsx( styles.description, className ) }
			{ ...props }
		/>
	);
}

/** A panel's top row: a title with optional leading content and actions, then a close button. */
export function PanelHeader( {
	title,
	leading,
	actions,
	onClose,
	closeLabel,
	disabled = false,
	className,
	...props
}: Omit< ComponentProps< 'div' >, 'title' > & {
	title: ReactNode;
	leading?: ReactNode;
	actions?: ReactNode;
	onClose?: () => void;
	closeLabel?: string;
	disabled?: boolean;
} ) {
	return (
		<div data-slot="panel-header" className={ clsx( styles.panelHeader, className ) } { ...props }>
			{ leading && <div>{ leading }</div> }
			<div className={ styles.panelTitle }>
				<h1>{ title }</h1>
			</div>
			{ actions && <div className={ styles.panelActions }>{ actions }</div> }
			<DialogDismissButton disabled={ disabled } onClick={ onClose } label={ closeLabel } />
		</div>
	);
}

export function DialogPanel( {
	className,
	header,
	footer,
	scrollRef,
	children,
	...props
}: ComponentProps< 'div' > & {
	header: ReactNode;
	footer?: ReactNode;
	scrollRef?: Ref< HTMLDivElement >;
} ) {
	return (
		<div data-slot="dialog-panel" className={ clsx( styles.panel, className ) } { ...props }>
			{ header }
			<DialogScrollArea ref={ scrollRef } className={ styles.panelScroll }>
				<div className={ styles.panelBody }>{ children }</div>
			</DialogScrollArea>
			{ footer }
		</div>
	);
}

/** A scroll container whose top edge fades once its content has scrolled. */
function DialogScrollArea( {
	className,
	onScroll,
	ref,
	children,
	...props
}: ComponentProps< 'div' > ) {
	const element = useRef< HTMLDivElement >( null );
	const [ scrolled, setScrolled ] = useState( false );
	useImperativeHandle( ref, () => element.current!, [] );
	const measure = useCallback( () => {
		setScrolled( ( element.current?.scrollTop ?? 0 ) > 0 );
	}, [] );
	useLayoutEffect( () => {
		measure();
		if ( typeof ResizeObserver === 'undefined' ) return;
		const observer = new ResizeObserver( measure );
		const node = element.current!;
		observer.observe( node );
		if ( node.firstElementChild ) observer.observe( node.firstElementChild );
		return () => observer.disconnect();
	}, [ children, measure ] );
	return (
		<div
			{ ...props }
			ref={ element }
			data-slot="dialog-scroll-area"
			data-scrolled={ scrolled }
			className={ clsx( styles.scrollArea, className ) }
			onScroll={ ( event ) => {
				measure();
				onScroll?.( event );
			} }
		>
			{ children }
		</div>
	);
}
