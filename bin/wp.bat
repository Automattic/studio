@ECHO OFF
IF "%STUDIO_APP_PATH%"=="" (
  ECHO Error: STUDIO_APP_PATH is undefined; Studio's bundled 'wp-cli' is only usable in shell sessions originating from Studio's "Open in Terminal" feature.
  EXIT /B 1
)

SET COMMAND=%*
SET CLI=wp %COMMAND%

IF "%COMMAND%"=="" (
  REM Mimic core `wp-cli`'s behavior of using `more` for `help` output.
  %STUDIO_APP_PATH% --cli="%CLI%" | more
) ELSE (
  IF "%COMMAND:~0,4%"=="help" (
    REM Mimic core `wp-cli`'s behavior of using `more` for `help` output.
    %STUDIO_APP_PATH% --cli="%CLI%" | more
  ) ELSE (
    %STUDIO_APP_PATH% --cli="%CLI%"
  )
)
