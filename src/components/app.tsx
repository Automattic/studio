import SiteList from './site-list';
import CreateSiteButton from './create-site-button';
import Button from './button';
import useAuth from '../hooks/use-auth';
import {
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import MainSidebar from './main-sidebar';

export default function App() {
	const { isAuthenticated, authenticate, logout } = useAuth();
	return (
		<VStack className="h-screen bg-chrome backdrop-blur-3xl p-chrome app-drag-region" spacing="0">
			<HStack spacing="0" alignment="left" className="flex-grow !gap-chrome">
				<MainSidebar className="basis-48 flex-shrink-0 h-full" />
				<div className="p-8 bg-white overflow-y-auto h-full flex-grow rounded-chrome app-no-drag-region">
					<div className="flex justify-between mb-4">
						<h1 className="text-2xl font-semibold">Sites</h1>
						<CreateSiteButton />
						<Button variant="primary" onClick={ isAuthenticated ? logout : authenticate }>
							{ isAuthenticated ? 'Logout' : 'Connect' }
						</Button>
					</div>
					<SiteList />
				</div>
			</HStack>
		</VStack>
	);
}
