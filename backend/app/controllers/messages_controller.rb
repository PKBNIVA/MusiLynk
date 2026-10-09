class MessagesController < ApplicationController
  include UserRateLimit

  HISTORY_LIMIT = 200
  SEND_LIMIT_PER_HOUR = RateLimits.limit("message")
  MAX_LENGTH = 5_000

  before_action -> { authenticate! }
  before_action :load_conversation

  # Opening (or polling) a conversation marks the counterpart's messages and the
  # matching message notification as read. Returns the most recent HISTORY_LIMIT
  # messages oldest-first; `before=<message id>` pages further back from that message.
  # `after=<message id>` returns only messages newer than that one (oldest-first), so a
  # tight poll interval stays cheap once the thread is already loaded. `truncated` means
  # older messages exist before the first one returned (always false for `after`).
  def index
    # strict_loading: serialize reads message columns only; no association load per message.
    scope = @conversation.messages.strict_loading
    if params[:before].present?
      return render_error("before must be a single value.", :bad_request, "INVALID_PARAMETER") unless params[:before].is_a?(String)
      anchor = scope.find_by(id: params[:before])
      return render_error("Message not found", :not_found) unless anchor
      scope = scope.where("(messages.created_at, messages.id) < (?, ?)", anchor.created_at, anchor.id)
      recent = scope.order(created_at: :desc, id: :desc).limit(HISTORY_LIMIT + 1).to_a
      truncated = recent.size > HISTORY_LIMIT
      return render json: { messages: recent.first(HISTORY_LIMIT).reverse.map { serialize(_1) }, truncated:, limit: HISTORY_LIMIT, theirReadAt: their_read_at }
    end

    if params[:after].present?
      return render_error("after must be a single value.", :bad_request, "INVALID_PARAMETER") unless params[:after].is_a?(String)
      anchor = scope.find_by(id: params[:after])
      return render_error("Message not found", :not_found) unless anchor
      scope = scope.where("(messages.created_at, messages.id) > (?, ?)", anchor.created_at, anchor.id)
      mark_read!(always_clear: false)
      newer = scope.order(created_at: :asc, id: :asc).limit(HISTORY_LIMIT).to_a
      return render json: { messages: newer.map { serialize(_1) }, truncated: false, limit: HISTORY_LIMIT, theirReadAt: their_read_at }
    end

    mark_read!(always_clear: true)
    recent = scope.order(created_at: :desc, id: :desc).limit(HISTORY_LIMIT + 1).to_a
    truncated = recent.size > HISTORY_LIMIT
    render json: { messages: recent.first(HISTORY_LIMIT).reverse.map { serialize(_1) }, truncated:, limit: HISTORY_LIMIT, theirReadAt: their_read_at }
  end

  def create
    body = params[:body].to_s.strip
    return render_error("Write a message before sending.", :unprocessable_content, "MESSAGE_EMPTY") if body.empty?
    if body.length > MAX_LENGTH
      return render_error("Messages can be at most #{MAX_LENGTH} characters.", :unprocessable_content, "MESSAGE_TOO_LONG")
    end
    counterpart = @conversation.counterpart_for(current_user)
    unless counterpart.active?
      return render_error("#{counterpart.name}'s account is no longer active, so they can't receive messages.", :forbidden, "RECIPIENT_INACTIVE")
    end
    if UserBlock.between?(current_user, counterpart)
      return render_error("You can't send messages in this conversation.", :forbidden, "MESSAGING_BLOCKED")
    end
    return unless within_user_rate_limit?("message")

    message = Message.transaction do
      # Lock the conversation first. Saving a message checks the conversation row (foreign key) and
      # then touches it; two concurrent sends to one conversation deadlocked between those steps.
      # Taking the row lock up front makes them queue instead.
      @conversation.lock!
      # Scam signals never block sending; they drive a notice for the recipient and a moderator count.
      @conversation.messages.new(sender: current_user, body:).tap { _1.flag_scam_signals; _1.save! }.tap { Notifier.new_message(_1) }
    end
    render json: { message: serialize(message) }, status: :created
  end

  private

  # Opening the thread (a full load) always clears its message notification, so a stale unread one
  # (from before this rule, or any path that ever got out of step) is cleared on the next open.
  # A poll (`after=`) clears it only when the poll actually read something: most polls, every 3 s per
  # open thread, find nothing new and then run one UPDATE that matches no row instead of two. That is
  # safe because every message is committed in the same transaction as its notification
  # (MessagesController#create, BookingsController#post_change_request), so a poll that reads a
  # message also sees, and clears, its notification.
  def mark_read!(always_clear:)
    now = Time.current
    read = @conversation.messages.where.not(sender: current_user).where(read_at: nil).update_all(read_at: now, updated_at: now)
    Notifier.conversation_read(@conversation, current_user) if always_clear || read.positive?
  end

  # The most recent time the counterpart read one of the current user's own messages, so a poll that
  # only fetches new messages (`after=`) can still update the sender's "Seen" receipt on an older one.
  def their_read_at
    @conversation.messages.where(sender: current_user).where.not(read_at: nil).maximum(:read_at)
  end

  def load_conversation
    @conversation = Conversation.find_by(id: params[:conversation_id])
    render_error("Conversation not found", :not_found) unless @conversation&.includes_user?(current_user)
  end

  # Only the recipient sees safety flags (as a gentle notice); telling the sender would teach evasion.
  def serialize(message)
    payload = { id: message.id, senderId: message.sender_id, body: message.body, createdAt: message.created_at, readAt: message.read_at }
    payload[:safetyFlags] = message.safety_flags if message.sender_id != current_user.id && message.safety_flags.present?
    payload
  end
end
