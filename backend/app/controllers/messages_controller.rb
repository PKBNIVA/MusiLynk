class MessagesController < ApplicationController
  include UserRateLimit

  HISTORY_LIMIT = 200
  SEND_LIMIT_PER_HOUR = 120
  MAX_LENGTH = 5_000

  before_action -> { authenticate! }
  before_action :load_conversation

  # Opening (or polling) a conversation marks the counterpart's messages and the
  # matching message notification as read. Returns the most recent HISTORY_LIMIT
  # messages oldest-first; `before=<message id>` pages further back from that message.
  # `truncated` means older messages exist before the first one returned.
  def index
    scope = @conversation.messages
    if params[:before].present?
      return render_error("before must be a single value.", :bad_request, "INVALID_PARAMETER") unless params[:before].is_a?(String)
      anchor = scope.find_by(id: params[:before])
      return render_error("Message not found", :not_found) unless anchor
      scope = scope.where("(messages.created_at, messages.id) < (?, ?)", anchor.created_at, anchor.id)
    else
      now = Time.current
      @conversation.messages.where.not(sender: current_user).where(read_at: nil).update_all(read_at: now, updated_at: now)
      Notifier.conversation_read(@conversation, current_user)
    end
    recent = scope.order(created_at: :desc, id: :desc).limit(HISTORY_LIMIT + 1).to_a
    truncated = recent.size > HISTORY_LIMIT
    render json: { messages: recent.first(HISTORY_LIMIT).reverse.map { serialize(_1) }, truncated:, limit: HISTORY_LIMIT }
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
    return unless within_user_rate_limit?("message", limit: SEND_LIMIT_PER_HOUR, period: 1.hour)

    message = Message.transaction do
      # Scam signals never block sending; they drive a notice for the recipient and a moderator count.
      @conversation.messages.new(sender: current_user, body:).tap { _1.flag_scam_signals; _1.save! }.tap { Notifier.new_message(_1) }
    end
    render json: { message: serialize(message) }, status: :created
  end

  private

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
