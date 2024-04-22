import { useResizeObserver } from '@wordpress/compose';
import { SVG, Path } from '@wordpress/primitives';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useRef, useState } from 'react';
import { cx } from '../lib/cx';
import Button, { ButtonProps } from './button';

type ActionButtonState = 'idle' | 'loading' | 'stop' | 'running';

interface ActionButtonProps {
	isRunning: boolean;
	isLoading: boolean;
	onClick: () => void;
	className?: string;
	buttonClassName?: string;
	iconSize?: number;
}

const MIN_WIDTH = 96;

const playIcon = (
	<SVG width="8" height="10" viewBox="0 0 8 10" fill="none">
		<Path d="M0 0L8 4.5L0 10V0Z" fill="currentColor" />
	</SVG>
);

const CircleIcon = ( { width, height }: { width: number; height: number } ) => {
	return (
		<div
			style={ { height: `${ width }px`, width: `${ height }px` } }
			className="rounded-full bg-current"
		/>
	);
};

const StopIcon = ( { height, width }: { width: number; height: number } ) => {
	return (
		<div
			style={ { height: `${ height }px`, width: `${ width }px` } }
			className="inline-block bg-current rounded-sm" // Adjust color as needed
		/>
	);
};

export const ActionButton = ( {
	isRunning,
	isLoading,
	onClick,
	className,
	buttonClassName,
	iconSize = 10,
}: ActionButtonProps ) => {
	const { __ } = useI18n();
	const [ isHovered, setIsHovered ] = useState( false );
	const containerRef = useRef< HTMLDivElement >( null );
	const [ resizeListener, sizes ] = useResizeObserver();
	const minSize = useRef( { width: MIN_WIDTH, height: 0 } );

	let state: ActionButtonState = 'idle';
	if ( isLoading ) {
		state = 'loading';
	} else if ( isRunning ) {
		if ( isHovered ) {
			state = 'stop';
		} else {
			state = 'running';
		}
	}

	// Set the container's minimum size to match the maximum size previously
	// used to prevent visual glitches during hover action.
	// Reference: https://github.com/Automattic/dotcom-forge/issues/6422
	useEffect( () => {
		if ( ! containerRef.current || ! sizes.width || ! sizes.height ) {
			return;
		}
		minSize.current = {
			width: Math.max( minSize.current.width, sizes.width ),
			height: Math.max( minSize.current.height, sizes.height ),
		};
		containerRef.current.style.minWidth = `${ minSize.current.width }px`;
		containerRef.current.style.minHeight = `${ minSize.current.height }px`;
	}, [ sizes ] );

	const handleOnClick = () => {
		if ( isLoading ) {
			return;
		}
		onClick();
	};

	const defaultButtonClassName = cx(
		'gap-1.5 !grow !justify-center !leading-4 w-full',
		buttonClassName
	);
	const defaultButtonProps: ButtonProps = {
		onClick: handleOnClick,
		iconSize,
		variant: 'secondary',
	};

	let buttonLabel;
	let buttonProps;
	switch ( state ) {
		case 'idle':
			buttonLabel = __( 'Start' );
			buttonProps = {
				icon: playIcon,
				className: defaultButtonClassName,
			};
			break;
		case 'loading':
			buttonLabel = __( 'Starting…' );
			buttonProps = {
				// `aria-disabled` used rather than `disabled` to prevent losing button
				// focus while the button's asynchronous action is pending.
				'aria-disabled': isLoading,
				icon: undefined,
				className: defaultButtonClassName,
			};
			break;
		case 'stop':
			buttonLabel = __( 'Stop' );
			buttonProps = {
				icon: <StopIcon height={ iconSize } width={ iconSize } />,
				className: cx(
					defaultButtonClassName,
					'!text-a8c-red-50 !shadow-[inset_0_0_0_1px_shadow-a8c-red-50] !shadow-a8c-red-50'
				),
			};
			break;
		case 'running':
			buttonLabel = __( 'Running' );
			buttonProps = {
				icon: <CircleIcon height={ iconSize } width={ iconSize } />,
				className: cx( defaultButtonClassName, '!text-a8c-green-50' ),
			};
			break;
	}

	return (
		<div
			ref={ containerRef }
			className={ cx( className, 'relative' ) }
			onMouseEnter={ () => setIsHovered( true ) }
			onMouseLeave={ () => setIsHovered( false ) }
		>
			{ resizeListener }
			<Button { ...defaultButtonProps } { ...buttonProps }>
				{ buttonLabel }
			</Button>
		</div>
	);
};
