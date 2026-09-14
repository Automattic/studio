import {
	lockCliConfigFile,
	readCliConfigFileRaw,
	unlockCliConfigFile,
	writeCliConfigFileRaw,
} from '@studio/common/lib/cli-config-file';
import {
	lockSharedConfig,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
} from '@studio/common/lib/shared-config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveAiSettingsToShared } from '../08-move-ai-settings-to-shared';

vi.mock( '@studio/common/lib/cli-config-file', () => ( {
	lockCliConfigFile: vi.fn(),
	readCliConfigFileRaw: vi.fn(),
	unlockCliConfigFile: vi.fn(),
	writeCliConfigFileRaw: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/shared-config', () => ( {
	lockSharedConfig: vi.fn(),
	readSharedConfig: vi.fn(),
	saveSharedConfig: vi.fn(),
	unlockSharedConfig: vi.fn(),
} ) );

const mockReadCli = vi.mocked( readCliConfigFileRaw );
const mockWriteCli = vi.mocked( writeCliConfigFileRaw );
const mockReadShared = vi.mocked( readSharedConfig );
const mockSaveShared = vi.mocked( saveSharedConfig );

describe( 'moveAiSettingsToShared', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mockReadShared.mockResolvedValue( { version: 1 } as never );
	} );

	it( 'does not run when cli.json carries no AI settings', async () => {
		mockReadCli.mockResolvedValue( { version: 1, sites: [], snapshots: [] } );

		await expect( moveAiSettingsToShared.needsToRun() ).resolves.toBe( false );
	} );

	it( 'runs when cli.json still carries either field', async () => {
		mockReadCli.mockResolvedValue( { version: 1, anthropicApiKey: 'sk-ant-legacy' } );

		await expect( moveAiSettingsToShared.needsToRun() ).resolves.toBe( true );
	} );

	it( 'copies both fields into shared.json and strips them from cli.json', async () => {
		mockReadCli.mockResolvedValue( {
			version: 1,
			sites: [],
			aiProvider: 'anthropic-api-key',
			anthropicApiKey: 'sk-ant-legacy',
		} );

		await moveAiSettingsToShared.run();

		expect( mockSaveShared ).toHaveBeenCalledWith( {
			version: 1,
			aiProvider: 'anthropic-api-key',
			anthropicApiKey: 'sk-ant-legacy',
		} );
		expect( mockWriteCli ).toHaveBeenCalledWith( { version: 1, sites: [] } );
		expect( unlockSharedConfig ).toHaveBeenCalled();
		expect( unlockCliConfigFile ).toHaveBeenCalled();
	} );

	it( 'keeps the newer shared.json values and only drops the stale copies', async () => {
		mockReadShared.mockResolvedValue( {
			version: 1,
			aiProvider: 'wpcom',
			anthropicApiKey: 'sk-ant-current',
		} as never );
		mockReadCli.mockResolvedValue( {
			version: 1,
			aiProvider: 'anthropic-api-key',
			anthropicApiKey: 'sk-ant-legacy',
		} );

		await moveAiSettingsToShared.run();

		expect( mockSaveShared ).not.toHaveBeenCalled();
		expect( mockWriteCli ).toHaveBeenCalledWith( { version: 1 } );
	} );

	it( 'preserves unrelated cli.json fields', async () => {
		mockReadCli.mockResolvedValue( {
			version: 1,
			sites: [ { id: 'local-a' } ],
			snapshots: [],
			aiProvider: 'anthropic-api-key',
		} );

		await moveAiSettingsToShared.run();

		expect( mockWriteCli ).toHaveBeenCalledWith( {
			version: 1,
			sites: [ { id: 'local-a' } ],
			snapshots: [],
		} );
	} );

	it( 'takes both locks before writing', async () => {
		mockReadCli.mockResolvedValue( { version: 1, aiProvider: 'anthropic-api-key' } );

		await moveAiSettingsToShared.run();

		expect( lockSharedConfig ).toHaveBeenCalled();
		expect( lockCliConfigFile ).toHaveBeenCalled();
	} );
} );
