import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { XIcon } from 'lucide-react';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import { IconButton } from '@/lib/ui/button';
import surfaceStyles from '@/lib/ui/surface/style.module.css';
import { registerOpenDialog, replaceOpenDialogs } from './replacement';
import styles from './style.module.css';
import type { ComponentProps, ReactNode, Ref } from 'react';

type Layout = 'default' | 'compact' | 'settings' | 'creation' | 'confirmation';

const DialogContentContext = createContext< {
	showCloseButton: boolean;
	closeButtonDisabled: boolean;
	layout: Layout;
} >( {
	showCloseButton: true,
	closeButtonDisabled: false,
	layout: 'default',
} );

// Registers while open, so another dialog can take a `replaceable` one's place
// (`replaceOpenDialogs`) and a dialog that keeps its place blocks it.
function useOpenDialog( open: boolean | undefined, replaceable: boolean ) {
	const actionsRef = useRef< BaseDialog.Root.Actions >( null );
	useEffect( () => {
		if ( ! open ) {
			return;
		}
		return registerOpenDialog( { replaceable, close: () => actionsRef.current?.close() } );
	}, [ open, replaceable ] );
	return actionsRef;
}

export function Dialog( {
	replaceable = false,
	...props
}: BaseDialog.Root.Props & {
	/** Another top-level dialog, such as the command palette, may close it to take its place. */
	replaceable?: boolean;
} ) {
	const actionsRef = useOpenDialog( props.open, replaceable );
	return <BaseDialog.Root actionsRef={ actionsRef } { ...props } />;
}

/** A dialog that only closes through its own actions: no outside click or backdrop dismissal. */
export function AlertDialog( props: BaseAlertDialog.Root.Props ) {
	const actionsRef = useOpenDialog( props.open, false );
	return <BaseAlertDialog.Root actionsRef={ actionsRef } { ...props } />;
}

export { replaceOpenDialogs };
export { useHasOpenDialog } from './replacement';
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
	closeButtonDisabled = false,
	layout = 'default',
	backdrop = 'dimmed',
	keepMounted = false,
	motion = 'default',
	...props
}: ComponentProps< typeof BaseDialog.Popup > & {
	showCloseButton?: boolean;
	closeButtonDisabled?: boolean;
	layout?: Layout;
	backdrop?: 'dimmed' | 'transparent';
	/** Keeps ongoing operations and form state alive after dismissal. */
	keepMounted?: boolean;
	motion?: 'default' | 'none';
} ) {
	return (
		<BaseDialog.Portal keepMounted={ keepMounted }>
			<BaseDialog.Backdrop
				data-variant={ backdrop }
				data-motion={ motion }
				className={ styles.overlay }
			/>
			<BaseDialog.Popup
				data-slot="dialog-content"
				data-layout={ layout }
				data-backdrop={ backdrop }
				data-motion={ motion }
				className={ clsx( surfaceStyles.floating, styles.content, className ) }
				{ ...props }
			>
				<DialogContentContext.Provider value={ { showCloseButton, closeButtonDisabled, layout } }>
					{ children }
				</DialogContentContext.Provider>
			</BaseDialog.Popup>
		</BaseDialog.Portal>
	);
}

export function DialogHeader( { className, children, ...props }: ComponentProps< 'div' > ) {
	const { showCloseButton, closeButtonDisabled } = useContext( DialogContentContext );
	return (
		<div data-slot="dialog-header" className={ clsx( styles.header, className ) } { ...props }>
			{ children }
			{ showCloseButton && (
				<BaseDialog.Close
					className={ styles.headerClose }
					disabled={ closeButtonDisabled }
					render={ <DialogDismissButton /> }
				/>
			) }
		</div>
	);
}

export function DialogFooter( { className, ...props }: ComponentProps< 'div' > ) {
	return (
		<div data-slot="dialog-footer" className={ clsx( styles.footer, className ) } { ...props } />
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
			<DialogDismissButton
				size="icon-sm"
				disabled={ disabled }
				onClick={ onClose }
				label={ closeLabel }
			/>
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
		const node = element.current;
		if ( ! node ) return;
		const scrollTop = Math.max( 0, node.scrollTop );
		node.style.setProperty( '--scroll-fade-size', `${ Math.min( scrollTop, 20 ) }px` );
		setScrolled( scrollTop > 0 );
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
