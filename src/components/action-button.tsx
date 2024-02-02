import { SVG, Path } from '@wordpress/primitives';
import { cx } from '../lib/cx';
import Button, { ButtonProps } from './button';

interface ActionButtonProps {
	running: boolean;
	isLoading: boolean;
	onClick: () => void;
	isHovered: boolean;
	children: string;
	className?: string;
	icon?: React.ReactNode;
	iconSize?: number;
}

export const playIcon = (
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
	running,
	isLoading,
	onClick,
	isHovered,
	children,
	className,
	icon,
	iconSize = 14,
}: ActionButtonProps ) => {
	let buttonProps: ButtonProps = {
		onClick,
		icon: playIcon,
		iconSize,
		variant: 'secondary',
		disabled: isLoading,
		className: cx( 'text-[13px] !font-normal !gap-1.5', className ),
	};

	if ( isLoading ) {
		buttonProps = { ...buttonProps, variant: 'tertiary', icon: undefined };
	} else if ( running ) {
		if ( isHovered ) {
			buttonProps = {
				...buttonProps,
				variant: 'primary',
				icon: <StopIcon height={ iconSize } width={ iconSize } />,
				className: cx( buttonProps.className, 'text-white !bg-a8c-red-50' ),
			};
		} else {
			buttonProps = {
				...buttonProps,
				className: cx( buttonProps.className, 'text-white bg-a8c-green-40 hover:text-white' ),
				icon: <CircleIcon height={ iconSize } width={ iconSize } />,
				variant: undefined,
			};
		}
	}
	if ( icon ) {
		const { icon: _icon, iconSize: _iconSize, ...restProps } = buttonProps;
		buttonProps = { ...restProps };
	}
	return (
		<Button { ...buttonProps }>
			<>
				{ icon ? icon : null }
				{ children }
			</>
		</Button>
	);
};
