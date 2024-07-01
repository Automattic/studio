#!/bin/bash -eu

# Prepares the CI environment to successfully build the macOS app.
# Building the app is done via npm run make:macos-*.

echo "--- :rubygems: Setting up Gems"
install_gems

echo "--- :closed_lock_with_key: Installing Secrets"
bundle exec fastlane run configure_apply

echo "--- :testflight: Fetching Signing Certificates"
bundle exec fastlane set_up_signing