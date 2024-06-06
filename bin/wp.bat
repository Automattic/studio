@ECHO OFF
IF "%APP_PATH%"=="" (
  ECHO "Error: APP_PATH is undefined; Studio's bundled 'wp-cli' is only usable in shell sessions originating from Studio's \"Open in Terminal\" feature."
  EXIT /B 1
)

SET CLI=wp %*
"%APP_PATH%" --cli="%CLI%"
