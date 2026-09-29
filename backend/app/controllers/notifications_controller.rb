class NotificationsController < ApplicationController
  before_action -> { authenticate! }, except: %i[unsubscribe unsubscribe_status unsubscribe_update]

  def index
    scope = current_user.notifications
    notifications = scope.order(created_at: :desc).limit(100).as_json.map do |row|
      row.transform_keys { _1.camelize(:lower) }.merge(type: row.delete("kind"))
    end
    render json: { notifications:, unread: scope.where(read_at: nil).count }
  end

  # Polled by the navigation (about every 30 s while the tab is visible).
  def unread
    render json: { unread: current_user.notifications.where(read_at: nil).count, unreadMessages: unread_messages }
  end

  def update
    notification = current_user.notifications.find(params[:id])
    notification.update!(read_at: params[:read] == false ? nil : Time.current)
    render json: { ok: true }
  end

  def read_all
    now = Time.current
    updated = current_user.notifications.where(read_at: nil).update_all(read_at: now, updated_at: now)
    render json: { ok: true, updated: }
  end

  def preferences
    render json: { emailNotifications: NotificationEmail.opted_in?(current_user) }
  end

  def update_preferences
    value = params[:emailNotifications]
    return render_error("emailNotifications must be true or false.", :bad_request, "INVALID_PREFERENCE") unless [true, false].include?(value)

    profile = current_user.profile || current_user.create_profile!
    profile.update!(email_notifications: value)
    render json: { emailNotifications: profile.email_notifications }
  end

  # PUT /api/me/email-preferences: the four granular toggles (digest/lifecycle/requests/
  # product). The master switch (emailNotifications, above) is separate and always wins.
  def update_email_preferences
    updates = params[:emailPreferences]
    return render_error("emailPreferences must be an object.", :bad_request, "INVALID_PREFERENCE") unless updates.respond_to?(:to_unsafe_h) || updates.is_a?(Hash)

    updates = updates.to_unsafe_h if updates.respond_to?(:to_unsafe_h)
    invalid = updates.keys.map(&:to_s) - Profile::EMAIL_PREFERENCE_CATEGORIES
    return render_error("Unknown preference: #{invalid.join(', ')}", :bad_request, "INVALID_PREFERENCE") if invalid.any?
    return render_error("Each preference must be true or false.", :bad_request, "INVALID_PREFERENCE") unless updates.values.all? { [true, false].include?(_1) }

    profile = current_user.profile || current_user.create_profile!
    profile.update!(email_preferences: profile.email_preferences.to_h.merge(updates.stringify_keys))
    render json: { emailPreferences: profile.email_preferences }
  end

  # One-click unsubscribe from a notification email: no sign-in, the signed token names the
  # user. GET (link) and POST (RFC 8058 List-Unsubscribe-Post) both turn emails off.
  def unsubscribe
    user = NotificationEmail.user_for_unsubscribe_token(params[:token])
    return render_error("This unsubscribe link is invalid.", :bad_request, "INVALID_TOKEN") unless user

    (user.profile || user.create_profile!).update!(email_notifications: false)
    Rails.logger.info({ event: "notification_email_unsubscribed", userId: user.id }.to_json)
    render json: { ok: true, emailNotifications: false }
  end

  # GET /api/notifications/unsubscribe/preferences?token=...: the "Manage emails" page's
  # read, no sign-in required — same signed token as the unsubscribe link.
  def unsubscribe_status
    user = NotificationEmail.user_for_unsubscribe_token(params[:token])
    return render_error("This unsubscribe link is invalid.", :bad_request, "INVALID_TOKEN") unless user

    profile = user.profile
    render json: { emailNotifications: profile.nil? || profile.email_notifications?, emailPreferences: profile&.email_preferences.to_h.presence || default_preferences }
  end

  # PATCH/POST /api/notifications/unsubscribe/preferences: the "Manage emails" page's write,
  # no sign-in required. Can flip the master switch and/or any of the four categories.
  def unsubscribe_update
    user = NotificationEmail.user_for_unsubscribe_token(params[:token])
    return render_error("This unsubscribe link is invalid.", :bad_request, "INVALID_TOKEN") unless user

    profile = user.profile || user.create_profile!
    attrs = {}
    attrs[:email_notifications] = params[:emailNotifications] if [true, false].include?(params[:emailNotifications])
    preferences = params[:emailPreferences]
    preferences = preferences.to_unsafe_h if preferences.respond_to?(:to_unsafe_h)
    if preferences.is_a?(Hash)
      allowed = preferences.slice(*Profile::EMAIL_PREFERENCE_CATEGORIES, *Profile::EMAIL_PREFERENCE_CATEGORIES.map(&:to_sym))
      attrs[:email_preferences] = profile.email_preferences.to_h.merge(allowed.stringify_keys) if allowed.values.all? { [true, false].include?(_1) }
    end
    profile.update!(attrs) if attrs.any?
    Rails.logger.info({ event: "notification_email_unsubscribed", userId: user.id }.to_json) if attrs[:email_notifications] == false
    render json: { ok: true, emailNotifications: profile.email_notifications, emailPreferences: profile.email_preferences }
  end

  private

  def default_preferences
    { "digest" => true, "lifecycle" => true, "requests" => true, "product" => true }
  end

  def unread_messages
    Message.joins(:conversation)
      .where("conversations.candidate_id = :id OR conversations.employer_id = :id", id: current_user.id)
      .where(read_at: nil).where.not(sender_id: current_user.id).count
  end
end
