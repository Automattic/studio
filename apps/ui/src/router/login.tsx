import { createRoute } from '@tanstack/react-router';
import { useConnector } from '@/data/core';
import { rootRoute } from './root';

function LoginPage() {
	const connector = useConnector();

	return (
		<div
			style={ {
				display: 'flex',
				height: '100vh',
				alignItems: 'center',
				justifyContent: 'center',
			} }
		>
			<div style={ { textAlign: 'center', maxWidth: 400 } }>
				<h1 style={ { fontSize: '1.5rem', fontWeight: 600, marginBottom: 8 } }>
					Welcome to Studio
				</h1>
				<p style={ { color: '#666', marginBottom: 24 } }>
					Log in with your WordPress.com account to get started.
				</p>
				<button
					onClick={ () => void connector.authenticate() }
					style={ {
						padding: '10px 24px',
						fontSize: '0.875rem',
						fontWeight: 500,
						backgroundColor: '#3858e9',
						color: '#fff',
						border: 'none',
						borderRadius: 4,
						cursor: 'pointer',
					} }
				>
					Log in to WordPress.com
				</button>
			</div>
		</div>
	);
}

export const loginRoute = createRoute( {
	getParentRoute: () => rootRoute,
	path: '/login',
	component: LoginPage,
} );
