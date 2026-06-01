import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	buildFeatureFlags,
	getFeatureFlagFromEnv,
	setFeatureFlagInEnv,
} from 'src/lib/feature-flags';

const ENV_VAR = 'ENABLE_STUDIO_CODE_UI';

describe( 'feature-flags', () => {
	beforeEach( () => {
		delete process.env[ ENV_VAR ];
	} );

	afterEach( () => {
		delete process.env[ ENV_VAR ];
	} );

	describe( 'getFeatureFlagFromEnv', () => {
		it( 'returns the default (false) when the env var is unset', () => {
			expect( getFeatureFlagFromEnv( 'enableStudioCodeUi' ) ).toBe( false );
		} );

		it( 'returns true only for the exact string "true"', () => {
			process.env[ ENV_VAR ] = 'true';
			expect( getFeatureFlagFromEnv( 'enableStudioCodeUi' ) ).toBe( true );

			process.env[ ENV_VAR ] = 'false';
			expect( getFeatureFlagFromEnv( 'enableStudioCodeUi' ) ).toBe( false );

			process.env[ ENV_VAR ] = '1';
			expect( getFeatureFlagFromEnv( 'enableStudioCodeUi' ) ).toBe( false );
		} );

		it( 'returns false for an unknown flag', () => {
			expect( getFeatureFlagFromEnv( 'nope' as never ) ).toBe( false );
		} );
	} );

	describe( 'setFeatureFlagInEnv', () => {
		it( 'writes the env var so getFeatureFlagFromEnv reflects it', () => {
			setFeatureFlagInEnv( 'enableStudioCodeUi', true );
			expect( process.env[ ENV_VAR ] ).toBe( 'true' );
			expect( getFeatureFlagFromEnv( 'enableStudioCodeUi' ) ).toBe( true );

			setFeatureFlagInEnv( 'enableStudioCodeUi', false );
			expect( process.env[ ENV_VAR ] ).toBe( 'false' );
			expect( getFeatureFlagFromEnv( 'enableStudioCodeUi' ) ).toBe( false );
		} );
	} );

	describe( 'buildFeatureFlags', () => {
		it( 'includes enableStudioCodeUi resolved from the environment', () => {
			expect( buildFeatureFlags().enableStudioCodeUi ).toBe( false );

			setFeatureFlagInEnv( 'enableStudioCodeUi', true );
			expect( buildFeatureFlags().enableStudioCodeUi ).toBe( true );
		} );
	} );
} );
