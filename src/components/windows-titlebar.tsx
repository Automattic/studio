import { __experimentalHStack as HStack } from '@wordpress/components';
import { Icon, menu } from '@wordpress/icons';
import appIcon from '../../assets/titlebar-icon.svg';
import { getAppGlobals } from '../lib/app-globals';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { isWindowFrameRtl } from '../lib/is-window-frame-rtl';
import Button from './button';

export default function WindowsTitlebar( {
	className,
	children,
}: {
	className?: string;
	children?: React.ReactNode;
} ) {
	return (
		<HStack
			alignment="left"
			className={ cx(
				'bg-chrome text-white',
				// Leave space for window controls depending on which side they are on
				// Take into account the "chrome" padding, the position of which depends on the language direction
				isWindowFrameRtl() &&
					'ltr:pl-window-controls-width-win rtl:pl-window-controls-width-excl-chrome-win',
				! isWindowFrameRtl() &&
					'ltr:pr-window-controls-width-excl-chrome-win rtl:pr-window-controls-width-win',
				className
			) }
			spacing="2"
		>
			<Button
				variant="icon"
				onClick={ () => {
					getIpcApi().popupAppMenu();
				} }
				className="!px-3 !py-2 app-no-drag-region"
			>
				<Icon icon={ menu } className="text-white" size={ 18 } />
			</Button>

			<div className="flex gap-2 app-drag">
				<img src={ appIcon } alt="" className="w-[16px] flex-shrink-0" />
				<h1 className="text-xs">{ getAppGlobals().appName }</h1>
			</div>
			<div className="flex-1 ps-2">{ children }</div>
		</HStack>
	);
}
