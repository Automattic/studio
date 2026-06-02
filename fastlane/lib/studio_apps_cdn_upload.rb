# frozen_string_literal: true

module StudioAppsCdnUpload
  # Returns the Apps CDN visibility (`'internal'` or `'external'`) for a build.
  #
  # Nightly full installers are restricted to logged-in Automatticians via the
  # Apps CDN visibility filter, so the `/nightly` link only resolves for
  # internal users. Update binaries stay external — the in-app auto-updater is
  # unauthenticated and would otherwise stop seeing nightly updates. Beta and
  # Production stay external across the board.
  def self.visibility_for(build_type:, install_type:)
    return 'internal' if build_type == 'Nightly' && install_type == 'Full Install'

    'external'
  end
end
