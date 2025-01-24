import { Icon, Popover } from '@wordpress/components';
import { PropsWithChildren, useState, useEffect } from 'react';

export interface TooltipProps
	extends Pick< React.ComponentProps< typeof Popover >, 'placement' | 'className' > {
	icon?: JSX.Element;
	text?: string | JSX.Element;
	disabled?: boolean;
}

const Tooltip = ( {
	icon,
	text,
	children,
	disabled,
	placement = 'top',
	className,
}: PropsWithChildren< TooltipProps > ) => {
	const [ isPopoverVisible, setIsPopoverVisible ] = useState( false );
	const showPopover = () => {
		if ( disabled ) {
			return;
		}
		setIsPopoverVisible( true );
	};

	const hidePopover = () => {
		setIsPopoverVisible( false );
	};

	useEffect( () => {
		if ( ! text && isPopoverVisible ) {
			setIsPopoverVisible( false );
		}
	}, [ text, isPopoverVisible ] );

	if ( ! children ) {
		return null;
	}

	return (
		<div
			className={ className ?? 'inline-block' }
			onFocus={ showPopover }
			onBlur={ hidePopover }
			onMouseOut={ hidePopover }
			onMouseOver={ showPopover }
		>
			{ children }
			{ isPopoverVisible && (
				<Popover
					role="tooltip"
					noArrow={ true }
					offset={ 8 }
					className="[&_div]:!shadow-none [&>div]:bg-transparent"
					animate={ false }
					placement={ placement }
				>
					<div className="inline-flex items-center gap-2 max-w-80 rounded py-2 px-2.5 bg-[#101517] text-white animate-[fade_0.5s_ease-in-out_1]">
						{ icon && <Icon className="fill-white shrink-0  m-[2px]" size={ 16 } icon={ icon } /> }
						<span className="text-left text-xs break-words overflow-hidden">{ text }</span>
					</div>
				</Popover>
			) }
		</div>
	);
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
