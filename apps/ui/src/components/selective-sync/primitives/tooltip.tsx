import { Popover } from '@wordpress/components';
import { PropsWithChildren, ReactElement, useState, useEffect } from 'react';

interface TooltipProps
	extends Pick< React.ComponentProps< typeof Popover >, 'placement' | 'className' > {
	text?: string | ReactElement;
	disabled?: boolean;
}

const Tooltip = ( {
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
			className={ className ?? 'inline-flex items-center h-fit' }
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
					offset={ 3 }
					className="[&_div]:!shadow-none [&>div]:bg-transparent"
					animate={ false }
					placement={ placement }
				>
					<div className="inline-flex items-center gap-2 max-w-80 rounded py-2 px-2.5 bg-[#101517] border border-white/15 text-white animate-[fade_0.5s_ease-in-out_1]">
						<span className="text-left text-xs break-words overflow-hidden">{ text }</span>
					</div>
				</Popover>
			) }
		</div>
	);
};

export { Tooltip };
