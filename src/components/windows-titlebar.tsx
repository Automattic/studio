import { __experimentalHStack as HStack } from '@wordpress/components';
import { Icon, menu } from '@wordpress/icons';
import appIcon from '../../assets/titlebar-icon.svg';
import { getAppGlobals } from '../lib/app-globals';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';

export default function WindowsTitlebar( { className }: { className?: string } ) {
	return (
		<HStack alignment="left" className={ cx( 'bg-chrome text-white', className ) } spacing="2">
			<Button
				variant="icon"
				onClick={ () => {
					getIpcApi().popupAppMenu();
				} }
				className="!p-2"
			>
				<Icon icon={ menu } className="text-white" />
			</Button>

			<div className="flex gap-2">
				<img src={ appIcon } alt="" className="w-[16px] flex-shrink-0" />
				<h1 className="text-xs">{ getAppGlobals().appName }</h1>
			</div>
		</HStack>
	);
}
