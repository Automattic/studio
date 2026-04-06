import { Icon, Tooltip as WPTooltip } from '@wordpress/components';
import { type PropsWithChildren, useState } from 'react';

export interface TooltipProps {
	icon?: JSX.Element;
	text?: string | JSX.Element;
	disabled?: boolean;
	placement?: React.ComponentProps< typeof WPTooltip >[ 'placement' ];
	className?: string;
}

const Tooltip = ( {
	icon,
	text,
	children,
	disabled,
	placement,
	className,
}: PropsWithChildren< TooltipProps > ) => {
	if ( ! children ) {
		return null;
	}

	if ( disabled || ! text ) {
		return className ? <div className={ className }>{ children }</div> : <>{ children }</>;
	}

	const tooltipContent = icon ? (
		<span className="inline-flex items-center gap-2">
			<Icon className="fill-white shrink-0" size={ 16 } icon={ icon } />
			<span>{ text }</span>
		</span>
	) : (
		text
	);

	const tooltip = (
		<WPTooltip text={ tooltipContent as string } placement={ placement }>
			{ children as React.ReactElement }
		</WPTooltip>
	);

	return className ? <div className={ className }>{ tooltip }</div> : tooltip;
};

function DynamicTooltip( {
	getTooltipText,
	children,
	...props
}: PropsWithChildren< TooltipProps & { getTooltipText: () => string } > ) {
	const [ tooltipText, setTooltipText ] = useState( '' );

	const handleMouseEnter = () => {
		const text = getTooltipText();
		setTooltipText( text );
	};

	return (
		<Tooltip text={ tooltipText } placement="top-start" { ...props }>
			<div onMouseEnter={ handleMouseEnter }>{ children }</div>
		</Tooltip>
	);
}

export { Tooltip, DynamicTooltip };
