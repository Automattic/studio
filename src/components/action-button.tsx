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

	// Set size of all buttons with maximum size to avoid visual glitches
	// when hovering.
	// Reference: https://github.com/Automattic/dotcom-forge/issues/6422
	useEffect( () => {
		const adjustSize = () => {
			if ( ! containerRef.current ) return;

			const children = containerRef.current.children;
			let maxWidth = MIN_WIDTH;
			let maxHeight = 0;
			for ( let index = 0; index < children.length; index++ ) {
				const element = children.item( index );
				const rect = element?.getBoundingClientRect();
				if ( rect ) {
					maxWidth = Math.max( maxWidth, rect.width );
					maxHeight = Math.max( maxHeight, rect.height );
				}
			}

			const widthValue = maxWidth + 'px';
			const heightValue = maxHeight + 'px';
			containerRef.current.style.width = widthValue;
			containerRef.current.style.height = heightValue;
			for ( let index = 0; index < children.length; index++ ) {
				const element = children.item( index ) as HTMLElement;
				const style = element?.style;
				if ( style ) {
					style.width = widthValue;
					style.height = heightValue;
				}
			}
		};

		window.addEventListener( 'resize', adjustSize );
		adjustSize();
		return () => {
			window.removeEventListener( 'resize', adjustSize );
		};
	}, [] );

	const visibilityState = ( target: string ) => ( state !== target ? 'invisible' : 'visible' );
	const handleOnClick = () => {
		if ( isLoading ) {
			return;
		}
		onClick();
	};

	const defaultClassName = cx(
		'gap-1.5 !grow !justify-center !leading-4',
		buttonClassName,
		'absolute'
	);
	const defaultButtonProps: ButtonProps = {
		onClick: handleOnClick,
		iconSize,
		variant: 'secondary',
	};

	return (
		<div
			ref={ containerRef }
			className={ cx( className, 'relative' ) }
			onMouseEnter={ () => setIsHovered( true ) }
			onMouseLeave={ () => setIsHovered( false ) }
		>
			<Button
				{ ...defaultButtonProps }
				aria-description="Click to start site."
				icon={ playIcon }
				className={ cx( defaultClassName, visibilityState( 'idle' ) ) }
			>
				{ __( 'Start' ) }
			</Button>
			<Button
				{ ...defaultButtonProps }
				// `aria-disabled` used rather than `disabled` to prevent losing button
				// focus while the button's asynchronous action is pending.
				aria-description="Site is starting."
				aria-disabled={ isLoading }
				className={ cx( defaultClassName, visibilityState( 'loading' ) ) }
			>
				{ __( 'Starting…' ) }
			</Button>
			<Button
				{ ...defaultButtonProps }
				aria-description="Click to stop site."
				icon={ <StopIcon height={ iconSize } width={ iconSize } /> }
				className={ cx( defaultClassName, '!text-a8c-red-50', visibilityState( 'stop' ) ) }
			>
				{ __( 'Stop' ) }
			</Button>
			<Button
				{ ...defaultButtonProps }
				aria-description="Click to stop site."
				icon={ <CircleIcon height={ iconSize } width={ iconSize } /> }
				className={ cx( defaultClassName, '!text-a8c-green-50', visibilityState( 'running' ) ) }
			>
				{ __( 'Running' ) }
			</Button>
		</div>
	);
};
