import { createRoute } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { OnboardingLayout } from '@/components/onboarding-layout';
import { rootRoute } from './root';

function OnboardingPage() {
	return (
		<OnboardingLayout>
			<div style={ { textAlign: 'center' } }>
				<h1
					style={ {
						fontSize: '2rem',
						fontWeight: 600,
						marginBottom: 8,
					} }
				>
					{ __( 'Start a new project' ) }
				</h1>
				<p style={ { color: '#666', marginBottom: 32 } }>
					{ __( 'WordPress can power anything. What are you building?' ) }
				</p>
				<div
					style={ {
						display: 'flex',
						gap: 16,
						justifyContent: 'center',
					} }
				>
					<div
						style={ {
							border: '1px solid #ddd',
							borderRadius: 8,
							padding: 24,
							width: 240,
							textAlign: 'left',
							cursor: 'pointer',
						} }
					>
						<h3 style={ { fontWeight: 600, marginBottom: 8 } }>{ __( 'Create new' ) }</h3>
						<p style={ { color: '#666', fontSize: '0.875rem' } }>
							{ __( 'Start fresh with a blank project and build it with AI' ) }
						</p>
					</div>
					<div
						style={ {
							border: '1px solid #ddd',
							borderRadius: 8,
							padding: 24,
							width: 240,
							textAlign: 'left',
							cursor: 'pointer',
						} }
					>
						<h3 style={ { fontWeight: 600, marginBottom: 8 } }>{ __( 'Bring existing' ) }</h3>
						<p style={ { color: '#666', fontSize: '0.875rem' } }>
							{ __( 'Import from WordPress.com, a backup, or an export file' ) }
						</p>
					</div>
				</div>
			</div>
		</OnboardingLayout>
	);
}

export const onboardingRoute = createRoute( {
	getParentRoute: () => rootRoute,
	path: '/onboarding',
	component: OnboardingPage,
} );
