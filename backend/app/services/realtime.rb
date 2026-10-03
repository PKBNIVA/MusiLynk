# Broadcasts to the Action Cable channels from model callbacks and jobs. Payloads are ids, types
# and states only: the app refetches anything else from the API, so authorisation stays there.
# A failed broadcast is reported and swallowed: the write it follows has already committed, and
# polling (the fallback) picks the change up.
module Realtime
  module_function

  def broadcast(channel, record, payload)
    channel.broadcast_to(record, payload)
  rescue StandardError => e
    ErrorReporter.capture(e, tags: { source: "realtime", channel: channel.name })
    Rails.logger.warn("[realtime] #{channel.name} broadcast failed: #{e.class}")
  end

  def message_created(message)
    conversation = message.conversation
    broadcast(ConversationChannel, conversation, { type: "message", id: message.id, conversationId: conversation.id })
    recipient = conversation.counterpart_for(message.sender)
    broadcast(UserChannel, recipient, { type: "message", conversationId: conversation.id }) if recipient
  end

  def notification_created(notification)
    broadcast(UserChannel, notification.user, { type: "notification", id: notification.id })
  end

  def urgent_request_changed(request, change = "status")
    broadcast(UrgentRequestChannel, request, { type: change, id: request.id, status: request.status, matchStatus: request.match_status })
  end
end
