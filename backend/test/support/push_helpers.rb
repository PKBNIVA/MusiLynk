# Throwaway VAPID and subscriber keys for the web push tests: nothing here is a real credential.
module PushHelpers
  ENDPOINT_BASE = "https://fcm.googleapis.com/fcm/send/".freeze

  def with_push_env(enabled: true)
    key = WebPush.generate_key
    values = if enabled
      { "VAPID_PUBLIC_KEY" => key.public_key, "VAPID_PRIVATE_KEY" => key.private_key, "VAPID_SUBJECT" => "mailto:support@example.com" }
    else
      { "VAPID_PUBLIC_KEY" => nil, "VAPID_PRIVATE_KEY" => nil, "VAPID_SUBJECT" => nil }
    end
    previous = values.to_h { |name, _| [name, ENV[name]] }
    values.each { |name, value| value.nil? ? ENV.delete(name) : ENV[name] = value }
    yield key
  ensure
    previous.each { |name, value| value.nil? ? ENV.delete(name) : ENV[name] = value }
  end

  # A browser PushSubscription.toJSON() with real P-256 keys.
  def subscription_params(endpoint: "#{ENDPOINT_BASE}#{SecureRandom.hex(8)}")
    key = OpenSSL::PKey::EC.generate("prime256v1")
    { endpoint:, keys: { p256dh: WebPush.encode64(key.public_key.to_octet_string(:uncompressed)), auth: WebPush.encode64(SecureRandom.random_bytes(16)) } }
  end

  def make_subscription(user, **overrides)
    params = subscription_params
    PushSubscription.create!({ user:, endpoint: params[:endpoint], p256dh: params[:keys][:p256dh], auth: params[:keys][:auth] }.merge(overrides))
  end
end
