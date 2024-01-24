import { SiteDetailsProvider } from '../hooks/use-site-details';
import SiteList from './site-list';
import CreateSiteButton from './create-site-button';
import Button from './button';
import useAuth from '../hooks/use-auth';

export default function App() {
	const { isAuthenticated, authenticate, logout } = useAuth();
	return (
		<div className="relative p-8 min-h-screen">
			<SiteDetailsProvider>
					<div className="flex justify-between mb-4">
						<h1 className="text-2xl font-semibold">Sites</h1>
						<CreateSiteButton />
					<Button onClick={ isAuthenticated ? logout : authenticate }>
						{ isAuthenticated ? 'Logout' : 'Connect' }
					</Button>
					</div>
				<SiteList />
			</SiteDetailsProvider>
		</div>
	);
}
