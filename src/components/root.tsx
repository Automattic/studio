import ErrorBoundary from './error-boundary';
import { AuthProvider } from '../lib/AuthProvider';
import CrashTester from './crash-tester';
import App from './app';

const Root = () => {
	return (
		<ErrorBoundary>
			<CrashTester />
			<AuthProvider>
				<App />
			</AuthProvider>
		</ErrorBoundary>
	);
};
export default Root;
