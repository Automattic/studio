if [ -z "$APP_PATH" ]; then
  echo "Error: APP_PATH is undefined; Studio's bundled \`wp-cli\` is only usable in shell sessions originating from Studio's \"Open in Terminal\" feature."
  exit 1
fi

CLI="wp $@"
"$APP_PATH" --cli="$CLI"
