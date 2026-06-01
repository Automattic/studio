# frozen_string_literal: true

# Sanity checks for fastlane/lib/studio_apps_cdn_upload.rb.
#
# Run with: `ruby fastlane/test/studio_apps_cdn_upload_test.rb`
# (No bundle / fastlane required — minitest ships with stdlib Ruby.)

require 'minitest/autorun'
require_relative '../lib/studio_apps_cdn_upload'

class StudioAppsCdnUploadTest < Minitest::Test
  def test_nightly_full_install_is_internal
    assert_equal 'internal', StudioAppsCdnUpload.visibility_for(build_type: 'Nightly', install_type: 'Full Install')
  end

  def test_nightly_update_is_external
    assert_equal 'external', StudioAppsCdnUpload.visibility_for(build_type: 'Nightly', install_type: 'Update')
  end

  def test_beta_full_install_is_external
    assert_equal 'external', StudioAppsCdnUpload.visibility_for(build_type: 'Beta', install_type: 'Full Install')
  end

  def test_beta_update_is_external
    assert_equal 'external', StudioAppsCdnUpload.visibility_for(build_type: 'Beta', install_type: 'Update')
  end

  def test_production_full_install_is_external
    assert_equal 'external', StudioAppsCdnUpload.visibility_for(build_type: 'Production', install_type: 'Full Install')
  end

  def test_production_update_is_external
    assert_equal 'external', StudioAppsCdnUpload.visibility_for(build_type: 'Production', install_type: 'Update')
  end
end
