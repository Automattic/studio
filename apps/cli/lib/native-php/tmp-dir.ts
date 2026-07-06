import fs from 'node:fs';
import os from 'node:os';

// Returns `os.tmpdir()` resolved to its long-form path on Windows.
//
// When the OS account name is longer than 8 characters (e.g. CI's `buildkite-agent`),
// Windows exposes an 8.3 short name and `os.tmpdir()` can return something like
// `C:\Users\BUILDK~1\AppData\Local\Temp`. PHP's INI/argument scanner treats the `~` as a
// special token, so any temp path we hand to PHP — auto_prepend_file, opcache.file_cache,
// the phpMyAdmin config, … — breaks with `syntax error, unexpected '~'`. Resolving to the
// long form removes the tilde. No-op on macOS/Linux, which don't have 8.3 short names.
export function getFullyResolvedTmpDirPath(): string {
	return process.platform === 'win32' ? fs.realpathSync.native( os.tmpdir() ) : os.tmpdir();
}
