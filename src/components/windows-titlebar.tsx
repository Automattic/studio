import { __experimentalHStack as HStack } from '@wordpress/components';
import appIcon from '../../assets/studio-app-icon.png';
import { getAppGlobals } from '../lib/app-globals';
import { cx } from '../lib/cx';

export default function WindowsTitlebar( { className }: { className?: string } ) {
	return (
		<HStack alignment="left" className={ cx( 'bg-chrome text-white pl-4', className ) } spacing="4">
			<img src={ appIcon } alt="" className="w-[16px]" />
			<h1>{ getAppGlobals().appName }</h1>
		</HStack>
	);
}
