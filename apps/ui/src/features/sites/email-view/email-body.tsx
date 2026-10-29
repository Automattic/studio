import { __ } from '@wordpress/i18n';
import {
	useEffect,
	useEffectEvent,
	useRef,
	useState,
	type MouseEvent,
	type ReactNode,
} from 'react';
import { EmailFrameAnnotationLayer, type EmailFrameAnnotations } from './annotations';
import styles from './style.module.css';

// The punctuation a sentence puts after an address is not part of it.
const URL_PATTERN = /(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]])/;
// A blank line, and any more after it. The next paragraph keeps its indent.
const PARAGRAPH_BREAK = /\n[^\S\n]*\n(?:[^\S\n]*\n)*/;

function linkify( text: string, onOpenLink: ( url: string ) => void ) {
	return text.split( URL_PATTERN ).map( ( part, index ) =>
		// `split` with a capture group puts each match at an odd index.
		index % 2 === 1 ? (
			<a
				key={ index }
				className={ styles.link }
				href={ part }
				onClick={ ( event: MouseEvent ) => {
					event.preventDefault();
					onOpenLink( part );
				} }
			>
				{ part }
			</a>
		) : (
			part
		)
	);
}

/** A plain text body in paragraphs, with its web addresses as links. */
export function EmailText( {
	text,
	onOpenLink,
	paragraphProps,
	paragraphMarker,
}: {
	text: string;
	onOpenLink: ( url: string ) => void;
	// Annotation targets and markers, by the paragraph's index.
	paragraphProps?: ( index: number ) => Record< string, string >;
	paragraphMarker?: ( index: number ) => ReactNode;
} ) {
	return (
		<div className={ styles.text }>
			{ text
				.trim()
				.split( PARAGRAPH_BREAK )
				.map( ( paragraph, index ) => (
					<p key={ index } className={ styles.paragraph } { ...paragraphProps?.( index ) }>
						{ linkify( paragraph, onOpenLink ) }
						{ paragraphMarker?.( index ) }
					</p>
				) ) }
		</div>
	);
}

/**
 * An HTML body, in a frame that runs none of its scripts. The frame shares the
 * app's origin only so Studio can size it to its content and take its link
 * clicks; with scripts off, the email itself can't use that.
 */
export function EmailHtml( {
	html,
	onOpenLink,
	annotations,
}: {
	html: string;
	onOpenLink: ( url: string ) => void;
	annotations?: EmailFrameAnnotations;
} ) {
	const frameRef = useRef< HTMLIFrameElement >( null );
	const [ height, setHeight ] = useState< number >();
	const openLink = useEffectEvent( onOpenLink );
	const [ loads, setLoads ] = useState( 0 );

	useEffect( () => {
		const document = frameRef.current?.contentDocument;
		if ( ! loads || ! document?.documentElement ) {
			return;
		}
		const root = document.documentElement;
		const measure = () => setHeight( root.scrollHeight );
		measure();
		// Images that load later make the email taller.
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver( measure );
		observer?.observe( root );
		const handleClick = ( event: Event ) => {
			const link = ( event.target as Element | null )?.closest?.( 'a[href]' );
			if ( ! link ) {
				return;
			}
			event.preventDefault();
			openLink( ( link as HTMLAnchorElement ).href );
		};
		document.addEventListener( 'click', handleClick );
		return () => {
			observer?.disconnect();
			document.removeEventListener( 'click', handleClick );
		};
	}, [ loads ] );

	return (
		<div className={ styles.htmlFrame }>
			<iframe
				ref={ frameRef }
				className={ styles.html }
				title={ __( 'Email content' ) }
				sandbox="allow-same-origin"
				srcDoc={ html }
				style={ { height } }
				onLoad={ () => setLoads( ( count ) => count + 1 ) }
			/>
			{ annotations ? (
				<EmailFrameAnnotationLayer
					frameRef={ frameRef }
					loads={ loads }
					annotations={ annotations }
				/>
			) : null }
		</div>
	);
}
