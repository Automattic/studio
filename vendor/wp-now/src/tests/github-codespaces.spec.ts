import getWpNowConfig from '../config';
import * as codespaces from '../github-codespaces';

describe('Test GitHub Codespaces', () => {
	let processEnv;
	beforeAll(() => {
		processEnv = process.env;
		process.env = {};
	});

	afterAll(() => {
		process.env = processEnv;
	});

	test('getAbsoluteURL returns the localhost URL', async () => {
		vi.spyOn(codespaces, 'isGitHubCodespace', 'get').mockReturnValue(false);
		const options = await getWpNowConfig({ port: 7777 });

		expect(options.absoluteUrl).toBe('http://localhost:7777');
		vi.resetAllMocks();
	});

	test('getAbsoluteURL returns the codespace URL', async () => {
		vi.spyOn(codespaces, 'isGitHubCodespace', 'get').mockReturnValue(true);
		process.env.CODESPACE_NAME = 'my-codespace-name';
		process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN =
			'preview.app.github.dev';
		const options = await getWpNowConfig({ port: 7777 });

		expect(options.absoluteUrl).toBe(
			'https://my-codespace-name-7777.preview.app.github.dev'
		);
		vi.resetAllMocks();
	});
});
