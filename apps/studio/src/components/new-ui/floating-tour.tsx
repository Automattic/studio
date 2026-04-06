import { useEffect, useState, useRef, useCallback } from 'react';
import { cx } from 'src/lib/cx';

const LOCAL_STORAGE_KEY = 'floatingTour:dismissed';

interface TourStep {
	/** CSS selector for the element to point at */
	target: string;
	/** Message to display */
	message: string;
	/** Arrow direction — which side of the tooltip the arrow points from */
	placement?: 'top' | 'bottom' | 'left' | 'right';
}

interface FloatingTourProps {
	/** Unique ID for this tour (used for dismiss persistence) */
	tourId: string;
	/** Steps to show in sequence */
	steps: TourStep[];
	/** Whether the tour should be visible */
	active: boolean;
}

function getDismissedTours(): string[] {
	try {
		const stored = localStorage.getItem( LOCAL_STORAGE_KEY );
		return stored ? JSON.parse( stored ) : [];
	} catch {
		return [];
	}
}

function dismissTour( tourId: string ) {
	const dismissed = getDismissedTours();
	if ( ! dismissed.includes( tourId ) ) {
		dismissed.push( tourId );
		localStorage.setItem( LOCAL_STORAGE_KEY, JSON.stringify( dismissed ) );
	}
}

export function FloatingTour( { tourId, steps, active }: FloatingTourProps ) {
	const [ currentStep, setCurrentStep ] = useState( 0 );
	const [ position, setPosition ] = useState< { top: number; left: number } | null >( null );
	const [ dismissed, setDismissed ] = useState( () => getDismissedTours().includes( tourId ) );
	const tooltipRef = useRef< HTMLDivElement >( null );

	const step = steps[ currentStep ];
	const isVisible = active && ! dismissed && !! step;

	const updatePosition = useCallback( () => {
		if ( ! step ) {
			return;
		}
		const target = document.querySelector( step.target );
		if ( ! target ) {
			return;
		}
		const rect = target.getBoundingClientRect();
		const placement = step.placement ?? 'bottom';
		const gap = 12;

		let top: number;
		let left: number;

		switch ( placement ) {
			case 'top':
				top = rect.top - gap;
				left = rect.left + rect.width / 2;
				break;
			case 'bottom':
				top = rect.bottom + gap;
				left = rect.left + rect.width / 2;
				break;
			case 'left':
				top = rect.top + rect.height / 2;
				left = rect.left - gap;
				break;
			case 'right':
				top = rect.top + rect.height / 2;
				left = rect.right + gap;
				break;
		}

		setPosition( { top, left } );
	}, [ step ] );

	useEffect( () => {
		if ( ! isVisible ) {
			return;
		}
		updatePosition();
		window.addEventListener( 'resize', updatePosition );
		return () => window.removeEventListener( 'resize', updatePosition );
	}, [ isVisible, updatePosition ] );

	const handleNext = () => {
		if ( currentStep < steps.length - 1 ) {
			setCurrentStep( currentStep + 1 );
		} else {
			handleDismiss();
		}
	};

	const handleDismiss = () => {
		setDismissed( true );
		dismissTour( tourId );
	};

	if ( ! isVisible || ! position ) {
		return null;
	}

	const placement = step.placement ?? 'bottom';

	return (
		<div
			ref={ tooltipRef }
			className={ cx(
				'fixed z-50 max-w-xs animate-in fade-in slide-in-from-bottom-2 duration-200',
				placement === 'bottom' && '-translate-x-1/2',
				placement === 'top' && '-translate-x-1/2 -translate-y-full',
				placement === 'left' && '-translate-x-full -translate-y-1/2',
				placement === 'right' && '-translate-y-1/2'
			) }
			style={ { top: position.top, left: position.left } }
		>
			<div className="bg-frame-theme text-white rounded-lg shadow-lg px-4 py-3 text-sm">
				<p>{ step.message }</p>
				<div className="flex items-center justify-between mt-2 gap-4">
					{ steps.length > 1 && (
						<span className="text-white/60 text-xs">
							{ currentStep + 1 } of { steps.length }
						</span>
					) }
					<div className="flex gap-2 ml-auto">
						<button
							onClick={ handleDismiss }
							className="text-xs text-white/60 hover:text-white transition-colors"
						>
							Dismiss
						</button>
						<button
							onClick={ handleNext }
							className="text-xs font-medium text-white hover:text-white/80 transition-colors"
						>
							{ currentStep < steps.length - 1 ? 'Next' : 'Got it' }
						</button>
					</div>
				</div>
			</div>
			{ /* Arrow */ }
			<div
				className={ cx(
					'absolute w-2 h-2 bg-frame-theme rotate-45',
					placement === 'bottom' && '-top-1 left-1/2 -translate-x-1/2',
					placement === 'top' && '-bottom-1 left-1/2 -translate-x-1/2',
					placement === 'left' && '-right-1 top-1/2 -translate-y-1/2',
					placement === 'right' && '-left-1 top-1/2 -translate-y-1/2'
				) }
			/>
		</div>
	);
}
