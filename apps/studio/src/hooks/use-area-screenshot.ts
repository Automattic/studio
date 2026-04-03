import { useCallback, useEffect, useRef, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { resizeImageIfNeeded } from 'src/lib/resize-image';

export interface SelectionRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface AreaScreenshot {
	data: string; // base64 PNG
	rect: SelectionRect; // container-relative coords for positioning
}

export interface UseAreaScreenshotReturn {
	isCapturing: boolean;
	isDragging: boolean;
	currentRect: SelectionRect | null;
	screenshot: AreaScreenshot | null;
	activateCapture: () => void;
	deactivateCapture: () => void;
	clearScreenshot: () => void;
	handleMouseDown: ( e: React.MouseEvent ) => void;
	handleMouseMove: ( e: React.MouseEvent ) => void;
	handleMouseUp: ( e: React.MouseEvent ) => void;
}

export function useAreaScreenshot(): UseAreaScreenshotReturn {
	const [ isCapturing, setIsCapturing ] = useState( false );
	const [ isDragging, setIsDragging ] = useState( false );
	const [ currentRect, setCurrentRect ] = useState< SelectionRect | null >( null );
	const [ screenshot, setScreenshot ] = useState< AreaScreenshot | null >( null );

	const isCapturingRef = useRef( false );
	const dragStart = useRef< { x: number; y: number } | null >( null );
	const containerOffset = useRef< { x: number; y: number } >( { x: 0, y: 0 } );

	const activateCapture = useCallback( () => {
		setIsCapturing( true );
		isCapturingRef.current = true;
		setScreenshot( null );
		setCurrentRect( null );
	}, [] );

	const deactivateCapture = useCallback( () => {
		setIsCapturing( false );
		isCapturingRef.current = false;
		setIsDragging( false );
		dragStart.current = null;
		setCurrentRect( null );
	}, [] );

	const clearScreenshot = useCallback( () => {
		setScreenshot( null );
		setCurrentRect( null );
	}, [] );

	const handleMouseDown = useCallback( ( e: React.MouseEvent ) => {
		if ( ! isCapturingRef.current ) {
			return;
		}
		e.preventDefault();
		const container = e.currentTarget as HTMLElement;
		const containerRect = container.getBoundingClientRect();
		containerOffset.current = { x: containerRect.left, y: containerRect.top };

		const x = e.clientX - containerRect.left;
		const y = e.clientY - containerRect.top;
		dragStart.current = { x, y };
		setIsDragging( true );
		setCurrentRect( { x, y, width: 0, height: 0 } );
	}, [] );

	const handleMouseMove = useCallback( ( e: React.MouseEvent ) => {
		if ( ! dragStart.current ) {
			return;
		}
		const container = e.currentTarget as HTMLElement;
		const containerRect = container.getBoundingClientRect();
		const curX = e.clientX - containerRect.left;
		const curY = e.clientY - containerRect.top;

		// Support dragging in any direction
		const x = Math.min( dragStart.current.x, curX );
		const y = Math.min( dragStart.current.y, curY );
		const width = Math.abs( curX - dragStart.current.x );
		const height = Math.abs( curY - dragStart.current.y );

		setCurrentRect( { x, y, width, height } );
	}, [] );

	const handleMouseUp = useCallback(
		async ( e: React.MouseEvent ) => {
			if ( ! dragStart.current || ! currentRect ) {
				return;
			}

			const finalRect = { ...currentRect };
			// Recalculate from event in case state hasn't flushed
			const container = e.currentTarget as HTMLElement;
			const containerRect = container.getBoundingClientRect();
			const curX = e.clientX - containerRect.left;
			const curY = e.clientY - containerRect.top;
			finalRect.x = Math.min( dragStart.current.x, curX );
			finalRect.y = Math.min( dragStart.current.y, curY );
			finalRect.width = Math.abs( curX - dragStart.current.x );
			finalRect.height = Math.abs( curY - dragStart.current.y );

			dragStart.current = null;
			setIsDragging( false );
			setIsCapturing( false );
			isCapturingRef.current = false;

			// Ignore tiny drags (accidental clicks)
			if ( finalRect.width < 10 || finalRect.height < 10 ) {
				setCurrentRect( null );
				return;
			}

			setCurrentRect( finalRect );

			// Convert container-relative coords to window-relative for capturePage
			const windowRect = {
				x: Math.round( finalRect.x + containerRect.left ),
				y: Math.round( finalRect.y + containerRect.top ),
				width: Math.round( finalRect.width ),
				height: Math.round( finalRect.height ),
			};

			try {
				const raw = await getIpcApi().captureScreenRegion( windowRect );
				const resized = await resizeImageIfNeeded( raw, 'image/png' );
				setScreenshot( { data: resized.data, rect: finalRect } );
			} catch {
				// Capture failed — clear selection
				setCurrentRect( null );
			}
		},
		[ currentRect ]
	);

	// Escape key cancels capture or clears screenshot
	useEffect( () => {
		const handleKeyDown = ( e: KeyboardEvent ) => {
			if ( e.key === 'Escape' ) {
				if ( isCapturingRef.current ) {
					e.preventDefault();
					deactivateCapture();
				} else if ( screenshot ) {
					e.preventDefault();
					clearScreenshot();
				}
			}
		};
		window.addEventListener( 'keydown', handleKeyDown );
		return () => window.removeEventListener( 'keydown', handleKeyDown );
	}, [ deactivateCapture, clearScreenshot, screenshot ] );

	return {
		isCapturing,
		isDragging,
		currentRect,
		screenshot,
		activateCapture,
		deactivateCapture,
		clearScreenshot,
		handleMouseDown,
		handleMouseMove,
		handleMouseUp,
	};
}
