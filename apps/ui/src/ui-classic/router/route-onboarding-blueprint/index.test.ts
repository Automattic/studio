import { describe, expect, it } from 'vitest';
import { onboardingBlueprintRoute } from './index';

describe( 'onboardingBlueprintRoute', () => {
	it( 'renders the gallery page as a component route', () => {
		expect( onboardingBlueprintRoute.options.component ).toBeDefined();
		expect( onboardingBlueprintRoute.options.beforeLoad ).toBeUndefined();
	} );
} );
