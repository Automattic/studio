#!/usr/bin/env bash
# Windows jobs sometimes lose a process (PHP, node, npm) to exit code
# 3221226505 (0xC0000409, a fail-fast abort) at random steps. Source this
# file to keep a minidump of every crash in the job and print which module
# raised it, using Windows Error Reporting (WER).
#
#   source .buildkite/commands/windows-crash-reports.sh
#   start_windows_crash_reports
#   trap collect_windows_crash_reports EXIT
#
# Reports are collected into test-results/crash-reports for upload. Work
# happens in a temp directory because Playwright empties test-results when
# it starts.

WINDOWS_CRASH_REPORTS_DIR="test-results/crash-reports"
WER_LOCAL_DUMPS_KEY='HKLM\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps'

is_windows_agent() {
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

set_wer_local_dumps_value() {
  # MSYS rewrites arguments that look like paths (`/v`, `/d`); pass them as-is.
  MSYS2_ARG_CONV_EXCL='*' reg add "$WER_LOCAL_DUMPS_KEY" /v "$1" /t "$2" /d "$3" /f > /dev/null 2>&1
}

start_windows_crash_reports() {
  is_windows_agent || return 0

  WINDOWS_CRASH_REPORTS_WORK_DIR="$(mktemp -d)"
  mkdir -p "$WINDOWS_CRASH_REPORTS_WORK_DIR/dumps"
  touch "$WINDOWS_CRASH_REPORTS_WORK_DIR/since"

  local dump_folder
  dump_folder="$(cygpath -w "$WINDOWS_CRASH_REPORTS_WORK_DIR/dumps")"
  if set_wer_local_dumps_value DumpFolder REG_EXPAND_SZ "$dump_folder" &&
    set_wer_local_dumps_value DumpType REG_DWORD 1 &&
    set_wer_local_dumps_value DumpCount REG_DWORD 20; then
    echo "Crash minidumps for this job go to $dump_folder"
  else
    echo "warning: could not enable Windows crash dumps (writing HKLM needs an administrator); WER crash reports are still collected." >&2
  fi
}

print_crash_reports_header() {
  if [ "$1" -eq 0 ]; then
    echo '--- :rotating_light: Windows crash reports'
  fi
}

collect_windows_crash_reports() {
  local exit_code=$?
  is_windows_agent || return "$exit_code"
  [ -n "${WINDOWS_CRASH_REPORTS_WORK_DIR:-}" ] || return "$exit_code"

  local since="$WINDOWS_CRASH_REPORTS_WORK_DIR/since"
  local found=0

  # Reports WER wrote during this job. Each Report.wer names the crashed
  # program, the faulting module and the exception code.
  local wer_dirs=(/c/ProgramData/Microsoft/Windows/WER)
  if [ -n "${LOCALAPPDATA:-}" ]; then
    wer_dirs+=("$(cygpath -u "$LOCALAPPDATA")/Microsoft/Windows/WER")
  fi
  local wer_dir wer_root report
  for wer_dir in "${wer_dirs[@]}"; do
    for wer_root in "$wer_dir/ReportArchive" "$wer_dir/ReportQueue"; do
      [ -d "$wer_root" ] || continue
      while IFS= read -r report; do
        print_crash_reports_header "$found"
        found=$((found + 1))
        mkdir -p "$WINDOWS_CRASH_REPORTS_DIR/wer/$found"
        cp "$(dirname "$report")"/* "$WINDOWS_CRASH_REPORTS_DIR/wer/$found/" 2> /dev/null || true
        # Report.wer is UTF-16; print the fields that identify the crash.
        iconv -f UTF-16 -t UTF-8 "$report" 2> /dev/null |
          grep -E '^(EventType|AppName|AppPath|Sig\[[0-9]+\]\.(Name|Value))=' || true
        echo
      done < <(find "$wer_root" -name 'Report.wer' -newer "$since" 2> /dev/null)
    done
  done

  local dumps
  dumps="$(find "$WINDOWS_CRASH_REPORTS_WORK_DIR/dumps" -name '*.dmp' 2> /dev/null)"
  if [ -n "$dumps" ]; then
    print_crash_reports_header "$found"
    mkdir -p "$WINDOWS_CRASH_REPORTS_DIR/dumps"
    cp "$WINDOWS_CRASH_REPORTS_WORK_DIR"/dumps/*.dmp "$WINDOWS_CRASH_REPORTS_DIR/dumps/" 2> /dev/null || true
    echo "Minidumps (uploaded as artifacts):"
    ls -l "$WINDOWS_CRASH_REPORTS_DIR/dumps"
  fi

  rm -rf "$WINDOWS_CRASH_REPORTS_WORK_DIR"
  return "$exit_code"
}
