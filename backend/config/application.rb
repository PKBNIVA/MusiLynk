require_relative "boot"
require "rails/all"

Bundler.require(*Rails.groups)

module MusilynkApi
  class Application < Rails::Application
    config.load_defaults 8.1
    config.api_only = true
    # Uploads are served as-is; nothing generates image variants, so no image_processing/libvips.
    config.active_storage.variant_processor = :disabled
    config.autoload_lib(ignore: %w[assets tasks])
    # Relations marked strict_loading (the inbox, bookings and thread lists) must not lazy-load an
    # association: development and tests raise so the missing preload is fixed; production only logs,
    # so an unforeseen path costs a query rather than a failed request.
    config.active_record.action_on_strict_loading_violation = Rails.env.production? ? :log : :raise
  end
end
