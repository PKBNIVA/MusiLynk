# One conversation's new messages, for its two participants only ({ type: "message", id }).
class ConversationChannel < ApplicationCable::Channel
  def subscribed
    conversation = Conversation.find_by(id: params[:id])
    return reject unless conversation&.includes_user?(current_user)
    stream_for conversation
  end
end
