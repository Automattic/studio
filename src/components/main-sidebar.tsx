import { __ } from '@wordpress/i18n';
import { Icon } from '@wordpress/icons';
import { useOffline } from '../hooks/use-offline';
import { isMac } from '../lib/app-globals';
import { cx } from '../lib/cx';
import AddSite from './add-site';
import Button from './button';
import offlineIcon from './offline-icon';
import { RunningSites } from './running-sites';
import SiteMenu from './site-menu';
import Tooltip from './tooltip';

interface MainSidebarProps {
	className?: string;
}

export default function MainSidebar( { className }: MainSidebarProps ) {
	return (
		<div
			data-testid="main-sidebar"
			className={ cx(
				'text-chrome-inverted relative',
				isMac() && 'pt-[10px]',
				! isMac() && 'pt-[38px]',
				className
			) }
		>
			<SidebarToolbar />
			<div className="flex flex-col h-full">
				<div
					className={ cx(
						'flex-1 overflow-y-auto sites-scrollbar app-no-drag-region',
						isMac() ? 'ml-4' : 'ml-3'
					) }
				>
					<SiteMenu />
				</div>
				<div className="flex flex-col gap-4 pt-5 border-white border-t border-opacity-10 app-no-drag-region">
					<RunningSites />
					<div className={ cx( isMac() ? 'mx-5' : 'mx-4' ) }>
						<AddSite className="min-w-[168px] w-full mb-4" />
					</div>
				</div>
			</div>
		</div>
	);
}

function SidebarToolbar() {
	const isOffline = useOffline();
	const offlineMessage = [
		__( 'You’re currently offline.' ),
		__( 'Some features will be unavailable.' ),
	];
	return (
		<div
			className={ cx(
				'absolute right-4 app-no-drag-region',
				isMac() && 'top-1',
				! isMac() && 'top-0'
			) }
		>
			{ isOffline && (
				<Tooltip
					text={
						<span>
							{ offlineMessage[ 0 ] }
							<br />
							{ offlineMessage[ 1 ] }
						</span>
					}
				>
					<Button
						aria-label={ __( 'Offline indicator' ) }
						aria-description={ offlineMessage.join( ' ' ) }
						className="cursor-default"
						variant="icon"
					>
						<Icon className="m-1 text-white" size={ 16 } icon={ offlineIcon } />
					</Button>
				</Tooltip>
			) }
		</div>
	);
}
