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
	ruleTester.run( 'require-lock-before-save', rule, {
			valid: [
				// Functions not calling save functions (allowed)
				{
					code: `
        async function updateUserData() {
          await updateAppdata({ locale: 'en' });
        }
      `,
				},
				// saveUserData with lock (allowed)
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
				// saveAppdata with lock (allowed)
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
				// saveUserData without lock (not allowed)
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
				// saveAppdata without lock (not allowed)
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
				// Lock without try/finally block (not allowed)
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
				// Lock without unlock (not allowed)
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
