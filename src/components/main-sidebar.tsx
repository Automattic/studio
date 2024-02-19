import { __ } from '@wordpress/i18n';
import { Icon, commentAuthorAvatar, settings } from '@wordpress/icons';
import { useAuth } from '../hooks/use-auth';
import { isMac } from '../lib/app-globals';
import { cx } from '../lib/cx';
import AddSite from './add-site';
import Button from './button';
import SiteMenu from './site-menu';
import { WordPressLogo } from './wordpress-logo';

interface MainSidebarProps {
	className?: string;
}

function SidebarAuthFooter() {
	const { isAuthenticated, authenticate, logout } = useAuth();
	if ( isAuthenticated ) {
		return (
			<div className="flex items-center justify-between w-full">
				<Button
					className="text-white h-6 !px-0 active:!text-white rounded hover:!text-white hover:bg-white hover:bg-opacity-10"
					onClick={ logout }
					aria-label={ __( 'Account' ) }
				>
					<Icon icon={ commentAuthorAvatar } />
				</Button>
				<Button
					className="text-white h-6 !px-0 active:!text-white rounded hover:!text-white hover:bg-white hover:bg-opacity-10"
					aria-label={ __( 'Settings' ) }
				>
					<Icon icon={ settings } />
				</Button>
			</div>
		);
	}

	return (
		<Button
			className="flex items-center justify-between w-full text-white rounded px-0 py-1 h-auto active:!text-white hover:!text-white hover:underline"
			onClick={ authenticate }
		>
			<WordPressLogo />
			<div className="text-xs">{ __( 'Log in' ) }</div>
		</Button>
	);
}

export default function MainSidebar( { className }: MainSidebarProps ) {
	return (
		<div
			className={ cx(
				'text-chrome-inverted',
				isMac() && 'pt-[50px]',
				! isMac() && 'pt-[60px]',
				className
			) }
		>
			<div className="flex flex-col h-full">
				<SiteMenu />

				<div className="mt-auto h-[103px] pt-5 border-white border-t border-opacity-10 app-no-drag-region">
					<div className={ cx( isMac() ? 'mx-5' : 'mx-4' ) }>
						<AddSite className="w-full mb-3" />
						<SidebarAuthFooter />
					</div>
				</div>
			</div>
		</div>
	);
}
