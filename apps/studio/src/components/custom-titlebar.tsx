import { __experimentalHStack as HStack } from '@wordpress/components';
import { Icon, menu } from '@wordpress/icons';
import Button from 'src/components/button';
import { getAppGlobals } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { isWindowFrameRtl } from 'src/lib/is-window-frame-rtl';

export default function CustomTitlebar( {
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
				onClick={ ( e: React.MouseEvent< HTMLButtonElement > ) => {
					const rect = e.currentTarget.getBoundingClientRect();
					getIpcApi().popupAppMenu( {
						x: Math.round( rect.left ),
						y: Math.round( rect.bottom ),
					} );
				} }
				className="!px-3 !py-2 app-no-drag-region"
			>
				<Icon icon={ menu } className="text-white" size={ 18 } />
			</Button>

			<div className="flex gap-2 app-drag">
				<h1 className="text-xs">{ getAppGlobals().appName }</h1>
			</div>
			<div className="flex-1 ps-2">{ children }</div>
		</HStack>
	);
}
