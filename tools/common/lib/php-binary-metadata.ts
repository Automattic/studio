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
	'8.5-darwin-arm64': '0974ce32e29d78436fd54c9af4449294f6b138b384c8117a31026d705ac7caa2',
	'8.5-darwin-x64': '61bb57b22c24f91fd884147533d643cb32d6414b6a1bf848af21504cb3e7b7bf',
	'8.5-linux-x64': 'b1f5f88287c75432fc8ef256bd05930f156d1f4fb5064f97a2bc59a0b7db10ce',
	'8.5-linux-arm64': 'b9b7570b586846d19b79077b7dc95ac39a3f8e34a59c01f748672fe65db08c8c',
	'8.5-win32-x64': 'ddd8098a1e71dfe53c147c392eeaa50eb61259a1c430e3cbe016b0edbdc1cf91',
	// PHP 8.4 (8.4.20)
	'8.4-darwin-arm64': 'f0c8e545f77f45d4331e004effa34c863071ea9400c668e4462e41b22ded980d',
	'8.4-darwin-x64': '837402a1a5d01a01fd5b3db08443376b3c962087a9ab3d7462b68b6724576579',
	'8.4-linux-x64': '8a6bf4113d4ba950f153ad2898e51c94e6d2b42ef40609e94ad57ad3b585fbfa',
	'8.4-linux-arm64': '7d08c5e18ba3377dd1d49a5720e3b4b91b1ac7f027c04fc07827c7814f530a57',
	'8.4-win32-x64': '174ee2fefa1da9727bfc3d89d37b0bc31b474d7cbbf2005d71bf364cf93fd3f2',
	// PHP 8.3 (8.3.30)
	'8.3-darwin-arm64': 'd641f029a3f7e7e86623d6042afee4c3ad4edcf93caa24d8410fc7159e572271',
	'8.3-darwin-x64': '0d053fa61beeb02df69bb98c250e1ad9ce83271669678b9d0a55f939575fa923',
	'8.3-linux-x64': '1204e4036fb61ef4afd8009c9818d99840914d2b2ce550693d4842a1fd48472b',
	'8.3-linux-arm64': '991cd2d0c2bd95d847e68b529765264a0ca3fd3a91446de8f4cf8ee40fba2ce1',
	'8.3-win32-x64': '7eb9f5f45c24d984e69214e6b1f264bf9bf98f1469e32a720a39b849ab490837',
	// PHP 8.2 (8.2.30)
	'8.2-darwin-arm64': '6d2185d5d64cd4c1df355ab319aeafcc545067a7d5611f098b09d33792ff8b74',
	'8.2-darwin-x64': '433eb55845ec0f527074ec0a429dd36966d00885c9e7628e3395a934b7ddc400',
	'8.2-linux-x64': '6a1367e50609ed13fe583fb07be3b416e46a971bb21631dedff02a3e14e4abdd',
	'8.2-linux-arm64': 'af8e03c7fe5650535434758767c4c03482c27de65de85a60d1aa90270cebbd26',
	'8.2-win32-x64': '004f0fec7c7e92135f88a37d04236433b3627ef2339218cbfe503f15a83b9be1',
	// PHP 8.1 (8.1.34)
	'8.1-darwin-arm64': 'b721271659d6e3448c29c0dc5755ffc4b8a1498c4709e1aba6602cfb584a84e4',
	'8.1-darwin-x64': '5fe69256365f96a270e34208ec574be7012c8c08a23bdf52948d0d16d4d8ec6a',
	'8.1-linux-x64': 'e2932192836731163bf8d16d634f4bdda76c422ceb40c2c4d7c55ae63680f1aa',
	'8.1-linux-arm64': 'fcaad73ceadad5afe6820ab3510de4452dadc875b3a295bf22dc2678845922b2',
	'8.1-win32-x64': '112f3a411280a91eb5a32716484b52124e874678edb8f1a0ffbe0db767afc5ff',
	// PHP 8.0 (8.0.30)
	'8.0-darwin-arm64': '13c77c837cd50c027e1c614c192b25205123311a30d2335e9a3c8f82d23acb9a',
	'8.0-darwin-x64': 'b025f2c343916dd97d4cad543f0cc4c07ac882af10bc72773ad27ab8f6c9f59a',
	'8.0-linux-x64': '805fadfc7eaa97541344d53a5ef2912d7be1e6bdeab753fddc2ce0c63b40c1a5',
	'8.0-linux-arm64': '2c3fbc72d878862cf3b3d18849d4ab2ca7c02d38821d880eb8fb74a2e6f5c1d3',
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
	return `https://dl.static-php.dev/static-php-cli/bulk/php-${ patchVersion }-cli-${ OS_SEGMENT[ p ] }-${ cdnArch }.tar.gz`;
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
