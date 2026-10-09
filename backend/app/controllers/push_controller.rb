# Web push: the public config the browser needs to subscribe, the signed-in user's device
# subscriptions, and their per-category preferences. Sending is PushDeliveryJob's business.
class PushController < ApplicationController
  include UserRateLimit

  MAX_SUBSCRIPTIONS_PER_USER = Limits.push_subscriptions_per_user
  CHANGES_PER_HOUR = 30

  before_action -> { authenticate! }, except: :settings

  # GET /api/push/config -> { enabled, publicKey }. The public key is public by design; the
  # private key and subject never leave the server.
  def settings
    enabled = PushNotifications.enabled?
    response.set_header("Cache-Control", "no-store")
    render json: { enabled:, publicKey: enabled ? PushNotifications.public_key : nil }
  end

  # POST /api/push/subscriptions { endpoint, keys: { p256dh, auth } } (a PushSubscription.toJSON()).
  # One row per endpoint: re-subscribing refreshes the keys, and a device that signs in as someone
  # else moves to that user (a browser has one push subscription, whoever is signed in).
  def subscribe
    return render_error("Push notifications are not available right now.", :not_found, "PUSH_DISABLED") unless PushNotifications.enabled?
    return unless within_user_rate_limit?("push-subscribe", limit: CHANGES_PER_HOUR, period: 1.hour)

    endpoint = params[:endpoint].to_s
    keys = params[:keys].respond_to?(:permit) ? params[:keys] : {}
    p256dh = keys[:p256dh].to_s
    auth = keys[:auth].to_s
    subscription = PushSubscription.find_by_endpoint(endpoint) || PushSubscription.new
    subscription.assign_attributes(user: current_user, endpoint:, p256dh:, auth:, failure_count: 0, last_failure_at: nil,
      user_agent_summary: PushNotifications.user_agent_summary(request.user_agent))
    unless subscription.save
      return render_error("That doesn't look like a valid push subscription.", :unprocessable_content, "INVALID_SUBSCRIPTION")
    end

    prune_old_subscriptions
    render json: { ok: true, id: subscription.id }, status: :created
  end

  # DELETE /api/push/subscriptions { endpoint }. Idempotent, and only ever removes the caller's own.
  def unsubscribe
    return unless within_user_rate_limit?("push-unsubscribe", limit: CHANGES_PER_HOUR, period: 1.hour)

    endpoint = params[:endpoint].to_s
    return render_error("Say which subscription to remove.", :bad_request, "INVALID_SUBSCRIPTION") if endpoint.blank?

    current_user.push_subscriptions.where(endpoint_digest: PushSubscription.digest(endpoint)).destroy_all
    render json: { ok: true }
  end

  # GET /api/push/preferences -> { preferences: { urgent, messages, bookings }, devices }
  def preferences
    render json: preferences_json
  end

  # PUT /api/push/preferences { preferences: { urgent: bool, ... } }
  def update_preferences
    updates = params[:preferences]
    updates = updates.to_unsafe_h if updates.respond_to?(:to_unsafe_h)
    return render_error("preferences must be an object.", :bad_request, "INVALID_PREFERENCE") unless updates.is_a?(Hash) && updates.any?

    updates = updates.stringify_keys
    unknown = updates.keys - PushNotifications::CATEGORIES
    return render_error("Unknown preference: #{unknown.join(', ')}", :bad_request, "INVALID_PREFERENCE") if unknown.any?
    return render_error("Each preference must be true or false.", :bad_request, "INVALID_PREFERENCE") unless updates.values.all? { [true, false].include?(_1) }

    profile = current_user.profile || current_user.create_profile!
    profile.update!(push_preferences: PushNotifications.preferences_for(current_user).merge(updates))
    current_user.reload
    render json: preferences_json
  end

  private

  def preferences_json
    { preferences: PushNotifications.preferences_for(current_user), devices: current_user.push_subscriptions.count }
  end

  def prune_old_subscriptions
    extra = current_user.push_subscriptions.count - MAX_SUBSCRIPTIONS_PER_USER
    return unless extra.positive?

    current_user.push_subscriptions.order(:created_at).limit(extra).destroy_all
  end
end
