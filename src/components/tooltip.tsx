import { Icon, Popover } from '@wordpress/components';
import { PropsWithChildren, useState } from 'react';

interface TooltipProps
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
					<div className="flex flex-row justify-center items-center max-w-60 gap-2 rounded py-2 px-2.5 bg-[#101517] text-white animate-[fade_0.5s_ease-in-out_1]">
						{ icon && <Icon className="fill-white shrink-0 m-[2px] " size={ 16 } icon={ icon } /> }
						<p className="text-left text-xs">{ text }</p>
					</div>
				</Popover>
			) }
		</div>
	);
};

export default Tooltip;
