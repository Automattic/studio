import path from 'path';
import { executePHP } from '../execute-php';
import getWpNowConfig from '../config';

const exampleDir = path.join(__dirname, 'execute-php');

describe('validate php execution', () => {
	let output = '';
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation((newLine: string) => {
			output += `${newLine}`;
		});
	});

	afterEach(() => {
		output = '';
		vi.restoreAllMocks();
	});
	test('php file execution in index mode', async () => {
		const options = await getWpNowConfig({
			path: exampleDir,
		});
		await executePHP(
			['php', path.join(exampleDir, 'hello-world.php')],
			options
		);

		expect(output).toMatch(/Hello World!/);
	});
	test('php file execution for each PHP Version', async () => {
		const options = await getWpNowConfig({
			path: exampleDir,
		});
		await executePHP(['php', path.join(exampleDir, 'php-version.php')], {
			...options,
			phpVersion: '7.4',
		});
		expect(output.substring(0, 16)).toBe('PHP Version: 7.4');

		output = '';
		await executePHP(['php', path.join(exampleDir, 'php-version.php')], {
			...options,
			phpVersion: '8.0',
		});
		expect(output.substring(0, 16)).toBe('PHP Version: 8.0');

		output = '';
		await executePHP(['php', path.join(exampleDir, 'php-version.php')], {
			...options,
			phpVersion: '8.2',
		});
		expect(output.substring(0, 16)).toBe('PHP Version: 8.2');
	});
	test('php file execution with non absolute path', async () => {
		const options = await getWpNowConfig({
			path: exampleDir,
		});
		await executePHP(['php', 'hello-world.php'], options);

		expect(output).toMatch(/Hello World!/);
	});

	test('php throws an error if the first element is not the string "php"', async () => {
		const options = await getWpNowConfig({
			path: exampleDir,
		});
		try {
			await executePHP(
				[
					'word-different-to-php',
					path.join(exampleDir, 'php-version.php'),
				],
				{
					...options,
					phpVersion: '7.4',
				}
			);
		} catch (error) {
			expect(error.message).toBe(
				'The first argument to executePHP must be the string "php".'
			);
		}
	});
});
