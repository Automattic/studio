import { Library } from '@/components/library';
import { AppProviders } from './app-providers';
import '@/index.css';

export function App() {
	return (
		<AppProviders>
			<Library />
		</AppProviders>
	);
}
