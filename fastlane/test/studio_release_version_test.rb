# frozen_string_literal: true

# Sanity checks for fastlane/lib/studio_release_version.rb.
#
# Run with: `ruby fastlane/test/studio_release_version_test.rb`
# (No bundle / fastlane required — minitest ships with stdlib Ruby.)

require 'minitest/autorun'
require_relative '../lib/studio_release_version'

class StudioReleaseVersionTest < Minitest::Test
  # ---------- valid_version? (strict) ----------

  def test_valid_version_accepts_stable
    assert StudioReleaseVersion.valid_version?('1.8.0')
    assert StudioReleaseVersion.valid_version?('0.0.1')
    assert StudioReleaseVersion.valid_version?('10.20.30')
  end

  def test_valid_version_accepts_beta
    assert StudioReleaseVersion.valid_version?('1.8.0-beta1')
    assert StudioReleaseVersion.valid_version?('1.8.0-beta12')
  end

  def test_valid_version_rejects_invalid
    refute StudioReleaseVersion.valid_version?('1.8')
    refute StudioReleaseVersion.valid_version?('1.8.0.0')
    refute StudioReleaseVersion.valid_version?('v1.8.0')
    refute StudioReleaseVersion.valid_version?(' 1.8.0')
    refute StudioReleaseVersion.valid_version?('1.8.0 ')
    refute StudioReleaseVersion.valid_version?('1.8.0-rc1')
    refute StudioReleaseVersion.valid_version?('1.8.0-beta')
    refute StudioReleaseVersion.valid_version?('1.8.0-beta0a')
    refute StudioReleaseVersion.valid_version?('')
    refute StudioReleaseVersion.valid_version?(nil)
  end

  # ---------- next_patch_version (strict) ----------

  def test_next_patch_version_stable
    assert_equal '1.8.1', StudioReleaseVersion.next_patch_version!('1.8.0')
    assert_equal '1.8.10', StudioReleaseVersion.next_patch_version!('1.8.9')
    assert_equal '2.0.1', StudioReleaseVersion.next_patch_version!('2.0.0')
  end

  def test_next_patch_version_strips_beta
    assert_equal '1.8.1', StudioReleaseVersion.next_patch_version!('1.8.0-beta1')
    assert_equal '1.8.5', StudioReleaseVersion.next_patch_version!('1.8.4-beta3')
  end

  def test_next_patch_version_rejects_invalid
    assert_raises(ArgumentError) { StudioReleaseVersion.next_patch_version!('1.8') }
    assert_raises(ArgumentError) { StudioReleaseVersion.next_patch_version!('v1.8.0') }
    assert_raises(ArgumentError) { StudioReleaseVersion.next_patch_version!(nil) }
  end

  # ---------- npm_dist_tag_for (strict) ----------

  def test_npm_dist_tag_for_stable_returns_nil
    assert_nil StudioReleaseVersion.npm_dist_tag_for!('1.8.0')
    assert_nil StudioReleaseVersion.npm_dist_tag_for!('10.20.30')
  end

  def test_npm_dist_tag_for_beta_returns_next
    assert_equal 'next', StudioReleaseVersion.npm_dist_tag_for!('1.8.0-beta1')
    assert_equal 'next', StudioReleaseVersion.npm_dist_tag_for!('1.8.0-beta12')
  end

  def test_npm_dist_tag_for_rejects_invalid
    assert_raises(ArgumentError) { StudioReleaseVersion.npm_dist_tag_for!('1.8') }
  end

  # ---------- prerelease? (lenient) ----------

  def test_prerelease_true_for_betas
    assert StudioReleaseVersion.prerelease?('1.8.0-beta1')
    assert StudioReleaseVersion.prerelease?('v1.8.0-beta3')
    assert StudioReleaseVersion.prerelease?('release/1.8.0-beta1')
  end

  def test_prerelease_false_for_stable_and_garbage
    refute StudioReleaseVersion.prerelease?('1.8.0')
    refute StudioReleaseVersion.prerelease?('v1.8.0')
    refute StudioReleaseVersion.prerelease?('release/1.8.0')
    refute StudioReleaseVersion.prerelease?('something-else')
    refute StudioReleaseVersion.prerelease?('')
    refute StudioReleaseVersion.prerelease?(nil)
  end

  # ---------- base_version (lenient) ----------

  def test_base_version_strips_beta_suffix
    assert_equal '1.8.0', StudioReleaseVersion.base_version('1.8.0-beta1')
    assert_equal 'v1.8.0', StudioReleaseVersion.base_version('v1.8.0-beta3')
    assert_equal 'release/1.8.0', StudioReleaseVersion.base_version('release/1.8.0-beta1')
  end

  def test_base_version_returns_input_when_no_suffix
    assert_equal '1.8.0', StudioReleaseVersion.base_version('1.8.0')
    assert_equal 'v1.8.0', StudioReleaseVersion.base_version('v1.8.0')
  end

  def test_base_version_handles_nil
    assert_nil StudioReleaseVersion.base_version(nil)
  end

  # ---------- beta_number (lenient) ----------

  def test_beta_number_returns_integer_for_betas
    assert_equal 1, StudioReleaseVersion.beta_number('1.8.0-beta1')
    assert_equal 12, StudioReleaseVersion.beta_number('1.8.0-beta12')
    assert_equal 3, StudioReleaseVersion.beta_number('v1.8.0-beta3')
  end

  def test_beta_number_returns_nil_for_non_betas
    assert_nil StudioReleaseVersion.beta_number('1.8.0')
    assert_nil StudioReleaseVersion.beta_number('v1.8.0')
    assert_nil StudioReleaseVersion.beta_number('something-else')
    assert_nil StudioReleaseVersion.beta_number(nil)
  end
end
