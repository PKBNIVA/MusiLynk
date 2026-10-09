class NotificationsController < ApplicationController
  include ScalarParams
  before_action -> { authenticate! }, except: %i[unsubscribe unsubscribe_status unsubscribe_update]

  PAGE_SIZE = 30
  MAX_PAGE_SIZE = 100

  # Newest first, keyset-paged on (created_at, id) (R4): `?limit=` (default PAGE_SIZE, 1..MAX_PAGE_SIZE)
  # and `?cursor=` from the previous page's `nextCursor`; a notification created mid-scroll never
  # shifts a later page.
  def index
    return unless require_scalar_params!(:limit, :cursor)
    after = decode_cursor(params[:cursor])
    return render_error("This list position is no longer valid. Reload the page.", :bad_request, "INVALID_CURSOR") if after == :invalid
    limit = Integer(params[:limit].to_s, 10, exception: false)&.clamp(1, MAX_PAGE_SIZE) || PAGE_SIZE
    scope = current_user.notifications
    page = after ? scope.where("(notifications.created_at, notifications.id) < (?, ?)", after[:created_at], after[:id]) : scope
    rows = page.order(created_at: :desc, id: :desc).limit(limit + 1).to_a
    more = rows.length > limit
    rows = rows.first(limit)
    notifications = rows.as_json.map do |row|
      row.transform_keys { _1.camelize(:lower) }.merge(type: row.delete("kind"))
    end
    next_cursor = more ? Base64.urlsafe_encode64({ t: rows.last.created_at.utc.iso8601(6), i: rows.last.id }.to_json, padding: false) : nil
    render json: { notifications:, unread: scope.where(read_at: nil).count, nextCursor: next_cursor }
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
    render json: { emailNotifications: NotificationEmail.opted_in?(current_user), paymentsNotify: current_user.profile&.payments_notify? == true }
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
    invalid = updates.keys.map(&:to_s) - Profile::EMAIL_PREFERENCE_CATEGORIES - [Profile::PAYMENTS_NOTIFY_KEY]
    return render_error("Unknown preference: #{invalid.join(', ')}", :bad_request, "INVALID_PREFERENCE") if invalid.any?
    return render_error("Each preference must be true or false.", :bad_request, "INVALID_PREFERENCE") unless updates.values.all? { [true, false].include?(_1) }

    profile = current_user.profile || current_user.create_profile!
    profile.update!(email_preferences: profile.email_preferences.to_h.merge(updates.stringify_keys))
    render json: { emailPreferences: profile.email_preferences, paymentsNotify: profile.payments_notify? }
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

  # { created_at:, id: } after a valid cursor, nil without one, :invalid when it cannot be read.
  def decode_cursor(raw)
    return nil if raw.blank?
    data = JSON.parse(Base64.urlsafe_decode64(raw.to_s))
    return :invalid unless data.is_a?(Hash) && data["i"].is_a?(String) && data["t"].is_a?(String)
    { created_at: Time.iso8601(data["t"]), id: data["i"] }
  rescue ArgumentError, JSON::ParserError, TypeError
    :invalid
  end

  def default_preferences
    { "digest" => true, "lifecycle" => true, "requests" => true, "product" => true }
  end

  def unread_messages
    Message.joins(:conversation)
      .where("conversations.candidate_id = :id OR conversations.employer_id = :id", id: current_user.id)
      .where(read_at: nil).where.not(sender_id: current_user.id).count
  end
end
