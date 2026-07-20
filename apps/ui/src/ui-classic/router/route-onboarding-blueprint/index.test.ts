import { describe, expect, it } from 'vitest';
import { onboardingBlueprintRoute } from './index';

describe( 'onboardingBlueprintRoute', () => {
	it( 'redirects the retired Blueprint route to Create', () => {
		const beforeLoad = onboardingBlueprintRoute.options.beforeLoad as () => void;

		expect( beforeLoad ).toThrowError(
			expect.objectContaining( {
				options: expect.objectContaining( {
					to: '/onboarding/create',
					replace: true,
				} ),
			} )
		);
	} );
} );
