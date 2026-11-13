import { __ } from '@wordpress/i18n';
import { githubCopilotConfigSchema, type GithubCopilotConfig } from './config';
import type { AiModel, Provider } from '../types';

export const GITHUB_COPILOT_AI_MODELS = [
	{ id: 'claude-sonnet-5-5', label: () => 'Sonnet 5.5' },
	{ id: 'gpt-6.1-terra', label: () => 'GPT-6.1 Terra' },
	{ id: 'gemini-4-argon', label: () => 'Gemini 4 Argon' },
] as const satisfies readonly AiModel[];

// https://github.com/simple-icons/simple-icons/blob/develop/icons/githubcopilot.svg
const mark =
	'<path d="M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z"/>';

export const githubCopilotProvider: Provider< GithubCopilotConfig > = {
	id: 'github-copilot',
	label: 'GitHub Copilot',
	description: () => __( 'Use your GitHub Copilot plan. No API key required.' ),
	learnMoreUrl: 'https://github.com/features/copilot/plans',
	icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">${ mark }</svg>`,
	logo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 36 36"><rect x="-6" y="-6" width="36" height="36" fill="#000"/><g fill="#FFF">${ mark }</g></svg>`,
	account: {
		configSchema: githubCopilotConfigSchema,
		methods: [ { id: 'github', label: () => __( 'Continue with GitHub' ), kind: 'device' } ],
		describe: ( config ) => ( {
			method: 'github',
			summary: config.login,
			note: __( 'Using Copilot plan' ),
			links: [ { label: __( 'Manage usage' ), url: 'https://github.com/settings/copilot' } ],
		} ),
	},
	ai: {
		models: GITHUB_COPILOT_AI_MODELS,
		defaultModel: 'claude-sonnet-5-5',
	},
};
