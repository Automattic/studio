import { useCallback, useEffect, useRef, useState } from 'react';
import { captureElement, detectWpBlockType } from '../lib/dom-utils';
import type { HighlightRect, PickedElement } from '../lib/types';

declare global {
	interface Window {
		__studioOnElementSelected?: ( data: PickedElement ) => void;
	}
}

interface TooltipInfo {
	label: string;
	rect: HighlightRect;
}

interface UseIframePickerResult {
	highlightRect: HighlightRect | null;
	tooltipInfo: TooltipInfo | null;
	selected: boolean;
	grabAnother: () => void;
}

export function useIframePicker(
	iframeRef: React.RefObject< HTMLIFrameElement | null >,
	enabled: boolean,
	onSelected: ( element: PickedElement ) => void
): UseIframePickerResult {
	const [ highlightRect, setHighlightRect ] = useState< HighlightRect | null >( null );
	const [ tooltipInfo, setTooltipInfo ] = useState< TooltipInfo | null >( null );
	const [ selected, setSelected ] = useState( false );
	const selectedRef = useRef( false );
	const hoveredElRef = useRef< Element | null >( null );
	const onSelectedRef = useRef( onSelected );
	onSelectedRef.current = onSelected;

	const grabAnother = useCallback( () => {
		selectedRef.current = false;
		setSelected( false );
		setHighlightRect( null );
		setTooltipInfo( null );
		hoveredElRef.current = null;
	}, [] );

	const mapRectToParent = useCallback(
		( elementRect: DOMRect ): HighlightRect => {
			const iframe = iframeRef.current;
			if ( ! iframe ) {
				return { top: 0, left: 0, width: 0, height: 0 };
			}
			const iframeRect = iframe.getBoundingClientRect();
			return {
				top: iframeRect.top + elementRect.top,
				left: iframeRect.left + elementRect.left,
				width: elementRect.width,
				height: elementRect.height,
			};
		},
		[ iframeRef ]
	);

	const buildTooltipLabel = useCallback( ( el: Element ): string => {
		let label = el.tagName.toLowerCase();
		if ( el.id ) {
			label += '#' + el.id;
		}
		const wpBlock = detectWpBlockType( el );
		if ( wpBlock ) {
			label += ' (' + wpBlock + ')';
		} else if ( el.className && typeof el.className === 'string' ) {
			const shortClass = el.className.split( /\s+/ ).slice( 0, 2 ).join( '.' );
			if ( shortClass ) {
				label += '.' + shortClass;
			}
		}
		return label;
	}, [] );

	useEffect( () => {
		const iframe = iframeRef.current;
		if ( ! enabled || ! iframe ) {
			return;
		}

		const doc = iframe.contentDocument;
		if ( ! doc ) {
			return;
		}

		const onMouseMove = ( e: MouseEvent ) => {
			if ( selectedRef.current ) {
				return;
			}
			const el = doc.elementFromPoint( e.clientX, e.clientY );
			if ( ! el || el === doc.documentElement || el === doc.body ) {
				setHighlightRect( null );
				setTooltipInfo( null );
				hoveredElRef.current = null;
				return;
			}

			hoveredElRef.current = el;
			const rect = el.getBoundingClientRect();
			const mapped = mapRectToParent( rect );
			setHighlightRect( mapped );

			const label = buildTooltipLabel( el );
			const tooltipY = mapped.top > 30 ? mapped.top - 26 : mapped.top + mapped.height + 4;
			setTooltipInfo( {
				label,
				rect: { top: tooltipY, left: mapped.left, width: 0, height: 0 },
			} );
		};

		const onClick = ( e: MouseEvent ) => {
			if ( selectedRef.current ) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();

			const el = hoveredElRef.current || doc.elementFromPoint( e.clientX, e.clientY );
			if ( ! el ) {
				return;
			}

			const captured = captureElement( el );

			// Send selection to CLI via Playwright's exposeFunction bridge.
			window.__studioOnElementSelected?.( captured );

			selectedRef.current = true;
			setSelected( true );
			setHighlightRect( null );
			setTooltipInfo( null );
			onSelectedRef.current( captured );
		};

		doc.addEventListener( 'mousemove', onMouseMove, true );
		doc.addEventListener( 'click', onClick, true );

		return () => {
			doc.removeEventListener( 'mousemove', onMouseMove, true );
			doc.removeEventListener( 'click', onClick, true );
		};
	}, [ iframeRef, enabled, mapRectToParent, buildTooltipLabel ] );

	return { highlightRect, tooltipInfo, selected, grabAnother };
}
