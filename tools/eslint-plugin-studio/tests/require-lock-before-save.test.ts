import { RuleTester } from 'eslint';
import { describe } from 'vitest';
import rule from '../src/rules/require-lock-before-save';

const ruleTester = new RuleTester( {
	languageOptions: {
		ecmaVersion: 2018,
		sourceType: 'module',
	},
} );

describe( 'require-lock-before-save', () => {
	describe( 'default pairs (appdata)', () => {
		ruleTester.run( 'require-lock-before-save', rule, {
			valid: [
				{
					code: `
        async function updateUserData() {
          await updateAppdata({ locale: 'en' });
        }
      `,
				},
				{
					code: `
        async function updateUserData() {
          await lockAppdata();
          try {
            const data = await loadUserData();
            data.sites.push(newSite);
            await saveUserData(data);
          } finally {
            await unlockAppdata();
          }
        }
      `,
				},
				{
					code: `
        const updateUserData = async () => {
          await lockAppdata();
          try {
            const data = await loadUserData();
            data.snapshots.splice(0, 1);
            await saveAppdata(data);
          } finally {
            await unlockAppdata();
          }
        };
      `,
				},
			],
			invalid: [
				{
					code: `
        const updateUserData = async () => {
          const data = await loadUserData();
          data.snapshots.splice(0, 1);
          await saveUserData(data);
        };
      `,
					errors: [ { messageId: 'missingLock' } ],
				},
				{
					code: `
        async function updateUserData() {
          const data = await loadUserData();
          data.sites[0].name = 'New Name';
          await saveAppdata(data);
        }
      `,
					errors: [ { messageId: 'missingLock' } ],
				},
				{
					code: `
        async function updateUserData() {
          await lockAppdata();
          const data = await loadUserData();
          data.sites.push(newSite);
          await saveUserData(data);
          await unlockAppdata();
        }
      `,
					errors: [ { messageId: 'missingUnlock' } ],
				},
				{
					code: `
        async function updateUserData() {
          await lockAppdata();
          try {
            const data = await loadUserData();
            data.sites.push(newSite);
            await saveUserData(data);
          } catch (error) {
            console.error(error);
          }
        }
      `,
					errors: [ { messageId: 'missingUnlock' } ],
				},
			],
		} );
	} );

	describe( 'custom pairs (cli-config)', () => {
		const options = [
			{
				pairs: [
					{
						save: [ 'saveUserData', 'saveAppdata' ],
						lock: 'lockAppdata',
						unlock: 'unlockAppdata',
					},
					{
						save: 'saveCliConfig',
						lock: 'lockCliConfig',
						unlock: 'unlockCliConfig',
					},
				],
			},
		];

		ruleTester.run( 'require-lock-before-save (custom pairs)', rule, {
			valid: [
				{
					code: `
        async function updateSite() {
          await lockCliConfig();
          try {
            const config = await readCliConfig();
            config.sites.push(newSite);
            await saveCliConfig(config);
          } finally {
            await unlockCliConfig();
          }
        }
      `,
					options,
				},
				{
					code: `
        async function updateAppAndCli() {
          await lockAppdata();
          try {
            await saveAppdata(data);
          } finally {
            await unlockAppdata();
          }
        }
      `,
					options,
				},
			],
			invalid: [
				{
					code: `
        async function updateSite() {
          const config = await readCliConfig();
          config.sites.push(newSite);
          await saveCliConfig(config);
        }
      `,
					options,
					errors: [ { messageId: 'missingLock' } ],
				},
				{
					code: `
        async function updateSite() {
          await lockCliConfig();
          const config = await readCliConfig();
          await saveCliConfig(config);
          await unlockCliConfig();
        }
      `,
					options,
					errors: [ { messageId: 'missingUnlock' } ],
				},
				{
					code: `
        async function updateSite() {
          await lockAppdata();
          try {
            await saveCliConfig(config);
          } finally {
            await unlockAppdata();
          }
        }
      `,
					options,
					errors: [ { messageId: 'missingLock' } ],
				},
			],
		} );
	} );
} );
