import type { SupportedPHPVersion } from '@studio/common/types/php-versions';

// Pinned patch versions per PHP minor. Bump when new patch releases are available.
// PHP 7.4 is not available from the upstream static-php-cli CDN.
export const PHP_PATCH_VERSIONS: Partial< Record< SupportedPHPVersion, string > > = {
	'8.5': '8.5.5',
	'8.4': '8.4.20',
	'8.3': '8.3.30',
	'8.2': '8.2.30',
	'8.1': '8.1.34',
	'8.0': '8.0.30',
};

// PHP versions supported by the native-php runtime (subset of SupportedPHPVersions).
// PHP 7.4 is excluded: no static binaries are available from the upstream CDN.
export const NativePhpSupportedVersions = Object.keys(
	PHP_PATCH_VERSIONS
) as SupportedPHPVersion[];

// SHA-256 hashes keyed by '<phpMinorVersion>-<nodePlatform>-<nodeArch>'.
// Examples: '8.4-darwin-arm64', '8.3-linux-x64', '8.4-win32-x64'
// To recompute: download the archive and run `shasum -a 256 <file>`.
// Windows ARM64 falls back to x64, so there is no separate win32-arm64 entry.
export const PHP_BINARY_HASHES: Record< string, string > = {
	// PHP 8.5 (8.5.5)
	'8.5-darwin-arm64': 'd66ef557189baa9215cec65dba80eb5dcfa84ac87bfce565059263bce5c9cccb',
	'8.5-darwin-x64': 'f206193e86c6ca188fbb46532c432ff3f216f203be9fe67bfc839973de64f9b8',
	'8.5-linux-x64': '72a877af1cb93d7c14f79344bdbd78dc2a57a2e915a76b13e9a3141700df3f21',
	'8.5-linux-arm64': 'a45fc1f818497586bfd8f749c808f1f63c9d10bf48f439985e77bee607a2c76b',
	'8.5-win32-x64': 'ddd8098a1e71dfe53c147c392eeaa50eb61259a1c430e3cbe016b0edbdc1cf91',
	// PHP 8.4 (8.4.20)
	'8.4-darwin-arm64': '63b676b3e638aae10055a795ad25a820451fdfc79afb9f99b1605bad61560679',
	'8.4-darwin-x64': '6fc09f87d9676bf8f22b05cf77a91b99ee120414e9a028c6f357c18df531fa83',
	'8.4-linux-x64': '3624293e0556625e19f4483d74eac21d41b70d21bdbb7e8ea3e1247303886148',
	'8.4-linux-arm64': '1be37b0cc533edc691632828ecdaddd84eaa0f71bb9c06a3458347aa13da2987',
	'8.4-win32-x64': '174ee2fefa1da9727bfc3d89d37b0bc31b474d7cbbf2005d71bf364cf93fd3f2',
	// PHP 8.3 (8.3.30)
	'8.3-darwin-arm64': '8cfc16a7741c94bb1c7c991de554aeae7275308a6233e6da898e69d8d7e88920',
	'8.3-darwin-x64': 'a6389d12d35661a5e9428fa074397f6b086e1aaf5aa7a5461012986d2d2ca3da',
	'8.3-linux-x64': 'b23bd3cae443dc23f1013190456ce16406b5eb89115ba7c4b6e19ee613948739',
	'8.3-linux-arm64': 'd8c6c064585190d5ce27671b862c3acacf98b1b248efb402536051768edfa8a9',
	'8.3-win32-x64': '7eb9f5f45c24d984e69214e6b1f264bf9bf98f1469e32a720a39b849ab490837',
	// PHP 8.2 (8.2.30)
	'8.2-darwin-arm64': '71189159f072c2b0dec2c4c778f313187234725cc888dd648fde06b9671536b9',
	'8.2-darwin-x64': '51bbea18b71ee81a547a85fd6f64c671c3bb21e1e2aaaa8317b9ec786755f160',
	'8.2-linux-x64': 'f655fd34bdd8cc2fc48190feaa100eeec4a1e35d629316252fce16e9faca7652',
	'8.2-linux-arm64': 'e48d38ae0e2bfe1a4c1f7c2fb87cd4e2ff3ae391de99b3ed7860aa7d9ff0f1e5',
	'8.2-win32-x64': '004f0fec7c7e92135f88a37d04236433b3627ef2339218cbfe503f15a83b9be1',
	// PHP 8.1 (8.1.34)
	'8.1-darwin-arm64': '4feae4b89a6a2b1d0f1c9cc6bbb37e7a7f299a392a6f8f207946fc60c6ed631a',
	'8.1-darwin-x64': '91dddd79c1a8296eec6baa79e890d174a7ddcac40e0565390ae97eea09055e25',
	'8.1-linux-x64': '4caa8b82b574212b2f7af83cc800b23e0529b3dec85b8b2887547f909e717143',
	'8.1-linux-arm64': '134a0244b399c73792db3e91337fa3c18f0d773fd78ecfc26b14560fec7bcd6d',
	'8.1-win32-x64': '112f3a411280a91eb5a32716484b52124e874678edb8f1a0ffbe0db767afc5ff',
	// PHP 8.0 (8.0.30)
	'8.0-darwin-arm64': 'af2e06f1c0e872712177dda3478434890ed9bfc278f5435ed7d82f989b28a080',
	'8.0-darwin-x64': '8851a859b67e2abb6b15ec87eea547a47ec2380d7abc8297f26a9fb927eac46f',
	'8.0-linux-x64': '1a5b1d5e60bca9e0c06557640f878e88bd52ac4eb28e8a118103867b084e8ff8',
	'8.0-linux-arm64': '7515adedd9553d5c07f5fcead401a97e37b23e3cc0f156285b00a9232b2cdeff',
	'8.0-win32-x64': '67c98a95790d2dd9f79b051c2b6cab0cf9bb4d4cc0b4c5401c991bc99c99ac82',
};

type Platform = 'darwin' | 'linux' | 'win32';
type Arch = 'x64' | 'arm64';

const CDN_ARCH_MAP: Record< Arch, string > = { x64: 'x86_64', arm64: 'aarch64' };
const OS_SEGMENT: Record< Platform, string > = { darwin: 'macos', linux: 'linux', win32: 'win' };

export function buildPhpBinaryUrl(
	version: SupportedPHPVersion,
	platform: NodeJS.Platform,
	arch: string
): string {
	const patchVersion = PHP_PATCH_VERSIONS[ version ];
	if ( ! patchVersion ) {
		throw new Error(
			`PHP ${ version } is not available for the native-php runtime. ` +
				`Supported versions: ${ NativePhpSupportedVersions.join( ', ' ) }.`
		);
	}

	const p = platform as Platform;
	if ( p === 'win32' ) {
		return `https://dl.static-php.dev/static-php-cli/windows/spc-max/php-${ patchVersion }-cli-win.zip`;
	}

	const cdnArch = CDN_ARCH_MAP[ arch as Arch ] ?? arch;
	return `https://dl.static-php.dev/static-php-cli/common/php-${ patchVersion }-cli-${ OS_SEGMENT[ p ] }-${ cdnArch }.tar.gz`;
}

export function getPhpBinaryHash(
	version: SupportedPHPVersion,
	platform: NodeJS.Platform,
	arch: string
): string | undefined {
	// Windows ARM64 has no upstream binary — x64 runs under OS emulation.
	const effectiveArch = platform === 'win32' ? 'x64' : arch;
	return PHP_BINARY_HASHES[ `${ version }-${ platform }-${ effectiveArch }` ] || undefined;
}
