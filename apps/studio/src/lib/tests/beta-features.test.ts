import { SITE_RUNTIME_NATIVE_PHP } from '@studio/common/lib/site-runtime';
import { vi } from 'vitest';
import { EMPTY_USER_DATA } from 'src/storage/storage-types';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import { getBetaFeatures, getBetaFeaturesDefinition, updateBetaFeature } from '../beta-features';

vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: vi.fn(),
	saveUserData: vi.fn(),
	lockAppdata: vi.fn(),
	unlockAppdata: vi.fn(),
} ) );

const originalStudioRuntime = process.env.STUDIO_RUNTIME;
let mockUserData = structuredClone( EMPTY_USER_DATA );

beforeEach( () => {
	vi.clearAllMocks();
	mockUserData = structuredClone( EMPTY_USER_DATA );
	vi.mocked( lockAppdata ).mockResolvedValue( undefined );
	vi.mocked( unlockAppdata ).mockResolvedValue( undefined );
	vi.mocked( loadUserData ).mockImplementation( async () => structuredClone( mockUserData ) );
	vi.mocked( saveUserData ).mockImplementation( async ( userData ) => {
		mockUserData = structuredClone( userData );
	} );
} );

afterEach( () => {
	if ( originalStudioRuntime === undefined ) {
		delete process.env.STUDIO_RUNTIME;
		return;
	}
	process.env.STUDIO_RUNTIME = originalStudioRuntime;
} );

describe( 'beta features', () => {
	it( 'defines the Desks UI beta feature', () => {
		expect( getBetaFeaturesDefinition().desksUi ).toMatchObject( {
			key: 'desksUi',
			label: 'Desks UI',
			default: false,
			description: 'Try the new Desks UI for Studio.',
		} );
	} );

	it( 'returns defaults for beta features not persisted yet', async () => {
		mockUserData.betaFeatures = { nativePhpRuntime: true };

		await expect( getBetaFeatures() ).resolves.toEqual( {
			nativePhpRuntime: true,
			desksUi: false,
		} );
		expect( process.env.STUDIO_RUNTIME ).toBe( SITE_RUNTIME_NATIVE_PHP );
	} );

	it( 'persists Desks UI changes without overwriting existing beta features', async () => {
		mockUserData.betaFeatures = { nativePhpRuntime: true };

		await updateBetaFeature( 'desksUi', true );

		expect( lockAppdata ).toHaveBeenCalled();
		expect( unlockAppdata ).toHaveBeenCalled();
		expect( mockUserData.betaFeatures ).toEqual( {
			nativePhpRuntime: true,
			desksUi: true,
		} );
	} );
} );
