# Web push (RFC 8030 / VAPID RFC 8292 / aes128gcm RFC 8291) through the web-push gem.
#
# Entirely optional: with VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT all set the
# feature is on; if any is missing `enabled?` is false, the API reports it, the web app hides
# every push control and nothing is ever enqueued. The private key never leaves the server.
#
# Categories are the per-user toggles on the Notifications settings: "urgent" (a matched urgent
# request, or a musician's response to yours), "messages" and "bookings". Marketing is never
# sent by push.
module PushNotifications
  CATEGORIES = %w[urgent messages bookings].freeze
  # Urgent is on once subscribed; the rest are opt-in.
  DEFAULT_PREFERENCES = { "urgent" => true, "messages" => false, "bookings" => false }.freeze

  # Hosts of the browser push services. The endpoint is chosen by the client, so only real push
  # services are accepted: otherwise a subscription could make the worker POST to an internal address.
  ENDPOINT_HOST_SUFFIXES = %w[
    fcm.googleapis.com push.services.mozilla.com notify.windows.com push.apple.com
  ].freeze

  # Permanent: the push service says this subscription is gone.
  GONE = [WebPush::InvalidSubscription, WebPush::ExpiredSubscription].freeze
  OPEN_TIMEOUT = 5
  READ_TIMEOUT = 10

  Result = Struct.new(:status, keyword_init: true) # :sent, :gone, :failed, :rejected

  class << self
    def enabled? = public_key.present? && private_key.present? && subject.present?
    def public_key = ENV["VAPID_PUBLIC_KEY"].to_s.strip
    def private_key = ENV["VAPID_PRIVATE_KEY"].to_s.strip
    def subject = ENV["VAPID_SUBJECT"].to_s.strip

    def valid_endpoint?(endpoint)
      uri = URI.parse(endpoint.to_s)
      return false unless uri.is_a?(URI::HTTPS) && uri.host.present? && uri.userinfo.nil? && uri.port == 443

      host = uri.host.downcase
      ENDPOINT_HOST_SUFFIXES.any? { |suffix| host == suffix || host.end_with?(".#{suffix}") }
    rescue URI::InvalidURIError
      false
    end

    def preferences_for(user)
      stored = user.profile&.push_preferences.to_h
      CATEGORIES.to_h { |category| [category, stored.key?(category) ? stored[category] == true : DEFAULT_PREFERENCES[category]] }
    end

    def category_enabled?(user, category) = preferences_for(user).fetch(category.to_s, false)

    # Queues a push for `user` unless the feature is off, the user has no subscription, or they
    # switched this category off. Never raises: a queue failure must not fail the request.
    def notify(user, category, title:, body:, url:, tag: nil)
      return unless enabled? && user && CATEGORIES.include?(category.to_s)
      return unless user.push_subscriptions.exists? && category_enabled?(user, category)

      PushDeliveryJob.perform_later(user.id, category.to_s, { "title" => title, "body" => body, "url" => url, "tag" => tag }.compact)
    rescue StandardError => error
      Rails.logger.error({ event: "push_enqueue_failed", error: error.class.name }.to_json)
      ErrorReporter.capture(error, tags: { source: "push_enqueue_failed" })
    end

    # Sends one payload to one subscription. Returns a Result; never raises for a push-service answer.
    def deliver(subscription, payload, category:)
      WebPush.payload_send(
        message: payload.to_json,
        endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth,
        vapid: { subject:, public_key:, private_key: },
        ttl: category == "urgent" ? 1.hour.to_i : 1.day.to_i,
        urgency: category == "urgent" ? "high" : "normal",
        open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT
      )
      Result.new(status: :sent)
    rescue *GONE
      Result.new(status: :gone)
    rescue WebPush::Unauthorized, WebPush::PayloadTooLarge
      Result.new(status: :rejected)
    rescue WebPush::Error, SocketError, SystemCallError, Timeout::Error, OpenSSL::SSL::SSLError, IOError
      Result.new(status: :failed)
    end

    # A short, non-identifying device label from the User-Agent ("Chrome on Android").
    def user_agent_summary(user_agent)
      ua = user_agent.to_s
      browser = case ua
                when /Edg\//i then "Edge"
                when /OPR\/|Opera/i then "Opera"
                when /SamsungBrowser/i then "Samsung Internet"
                when /Firefox|FxiOS/i then "Firefox"
                when /Chrome|CriOS/i then "Chrome"
                when /Safari/i then "Safari"
                else "Browser"
                end
      os = case ua
           when /Android/i then "Android"
           when /iPhone|iPad|iPod/i then "iOS"
           when /Windows/i then "Windows"
           when /Mac OS X|Macintosh/i then "macOS"
           when /Linux/i then "Linux"
           end
      os ? "#{browser} on #{os}" : browser
    end
  end
end
