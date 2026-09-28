# One-off, idempotent repair for "message" notifications created before every one of them
# carried a `link` (see Notifier.new_message). Only touches rows with a blank link; running it
# again is a no-op. The sender's name is recovered from the notification title ("New message
# from X" / "N new messages from X") and matched against the recipient's conversations to find
# the one conversation with a counterpart of that name closest in time to the notification.
class MessageNotificationLinkBackfill
  TITLE_PATTERN = /\A(?:\d+ new messages|New message) from (.+)\z/

  class << self
    # Returns the number of notifications it filled in a link for.
    def run!
      fixed = 0
      Notification.where(kind: Notifier::MESSAGE_KIND).where(link: [nil, ""]).find_each do |note|
        link = link_for(note)
        next unless link

        note.update_column(:link, link)
        fixed += 1
      end
      fixed
    end

    private

    def link_for(note)
      match = TITLE_PATTERN.match(note.title.to_s)
      return nil unless match

      sender_name = match[1].strip
      return nil if sender_name.blank?

      user = User.find_by(id: note.user_id)
      return nil unless user

      conversation = Conversation
        .where("candidate_id = :id OR employer_id = :id", id: user.id)
        .includes(:candidate, :employer)
        .select { |c| c.counterpart_for(user)&.name == sender_name }
        .min_by { |c| (c.updated_at - note.created_at).abs }
      conversation && "/messages?c=#{conversation.id}"
    end
  end
end
