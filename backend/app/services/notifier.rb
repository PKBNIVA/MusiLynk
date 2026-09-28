# Single entry point for marketplace notifications. Controllers call one method per
# event; it writes the in-app notification and, for the events that warrant it,
# queues a transactional email (NotificationEmailJob) when a provider is configured.
#
# Links are stored role-neutral ("/bookings", "/messages?c=<id>"); the web client
# maps them into the viewer's workspace (/jobseeker/... or /employer/...).
class Notifier
  MESSAGE_KIND = "message".freeze
  # At most one new-message email per conversation per recipient in this window.
  MESSAGE_EMAIL_INTERVAL = 1.hour

  BOOKING_STATUS_LABELS = {
    "viewed" => "viewed", "negotiating" => "in negotiation", "quoted" => "quoted",
    "accepted" => "accepted", "completed" => "completed", "disputed" => "disputed",
    "declined" => "declined", "cancelled" => "cancelled"
  }.freeze

  class << self
    def booking_enquiry(booking)
      owner = booking.act.owner
      notify(owner, kind: "booking", title: "New booking enquiry", link: "/bookings",
        body: "#{booking.requester.name} enquired about #{booking.act.name}.")
      email(owner, "booking_enquiry", act: booking.act.name, name: booking.requester.name)
    end

    def booking_quote(booking)
      notify(booking.requester, kind: "booking_quote", title: "Booking quote received", link: "/bookings",
        body: "Quote received for #{booking.act.name}.")
      email(booking.requester, "booking_status", act: booking.act.name, status: "quoted")
    end

    # Tells the other side of the booking that `actor` changed its status.
    def booking_status(booking, actor:)
      recipient = actor.id == booking.requester_id ? booking.act.owner : booking.requester
      return if recipient.nil? || recipient.id == actor.id

      label = BOOKING_STATUS_LABELS.fetch(booking.status, booking.status)
      notify(recipient, kind: "booking_status", title: "Booking update", link: "/bookings",
        body: "#{booking.act.name}: #{label} by #{actor.name}.")
      email(recipient, "booking_status", act: booking.act.name, status: label)
    end

    def new_application(application)
      job = application.job
      notify(job.employer, kind: "application", title: "New application", link: "/hiring/applicants",
        body: "#{application.candidate.name} applied to #{job.title}.")
    end

    def application_status(application)
      job = application.job
      notify(application.candidate, kind: "application_status", title: "Application update", link: "/jobseeker/applications",
        body: "#{job.title}: #{application.status}")
      email(application.candidate, "application_status", job: job.title, status: application.status)
    end

    # Debounced: the recipient keeps at most one unread notification per conversation,
    # refreshed (and moved to the top) as further messages arrive. An email goes out only
    # when a fresh notification is raised and none was raised for this conversation in the
    # last MESSAGE_EMAIL_INTERVAL. Never copies the message body anywhere.
    def new_message(message)
      conversation = message.conversation
      sender = message.sender
      recipient = conversation.candidate_id == sender.id ? conversation.employer : conversation.candidate
      return if recipient.nil? || recipient.id == sender.id

      link = message_link(conversation)
      body = conversation.job ? "About #{conversation.job.title}." : "Open the conversation to reply."
      Notification.transaction do
        # Serialises concurrent sends in one conversation so only one unread row exists.
        conversation.lock!
        pending = conversation.messages.where(sender_id: sender.id, read_at: nil).count
        title = pending > 1 ? "#{pending} new messages from #{sender.name}" : "New message from #{sender.name}"
        existing = recipient.notifications.where(kind: MESSAGE_KIND, link:, read_at: nil).order(created_at: :desc).first
        if existing
          existing.update!(title:, body:, created_at: Time.current)
          next
        end

        recent = recipient.notifications.where(kind: MESSAGE_KIND, link:).where(created_at: MESSAGE_EMAIL_INTERVAL.ago..).exists?
        notify(recipient, kind: MESSAGE_KIND, title:, body:, link:)
        email(recipient, "new_message", name: sender.name, job: conversation.job&.title, path: link) unless recent
      end
    end

    # Called when the recipient opens the conversation.
    def conversation_read(conversation, user)
      user.notifications.where(kind: MESSAGE_KIND, link: message_link(conversation), read_at: nil).update_all(read_at: Time.current, updated_at: Time.current)
    end

    # A moderator's warning after a report. In-app only; links to the rules that apply.
    def moderation_warning(user, note = nil)
      notify(user, kind: "moderation_warning", title: "A warning from Verse moderation", link: "/community-guidelines",
        body: note || "We received a report about your activity on Verse. Please review the community guidelines; repeated or serious breaches lead to suspension.")
    end

    def message_link(conversation) = "/messages?c=#{conversation.id}"

    STAGE_APPLAUSE_KIND = "stage_applause".freeze
    STAGE_COMMENT_KIND = "stage_comment".freeze

    # Someone applauded your post. Coalesced per post the same way new-message notifications
    # are: the recipient keeps at most one unread "applause" notice per post, refreshed as
    # further applause arrives, instead of one row per reaction.
    def stage_applause(post, actor)
      recipient = post.created_by
      return if recipient.nil? || recipient.id == actor.user&.id
      link = "/stage/posts/#{post.id}"
      coalesce(recipient, kind: STAGE_APPLAUSE_KIND, link:,
        title: "New applause on your post", body: "#{actor.name} applauded your post.")
    end

    # Someone commented on your post. Same per-post coalescing as applause.
    def stage_comment(post, comment, actor)
      recipient = post.created_by
      return if recipient.nil? || recipient.id == comment.created_by_user_id
      link = "/stage/posts/#{post.id}"
      coalesce(recipient, kind: STAGE_COMMENT_KIND, link:,
        title: "New comment on your post", body: "#{actor.name} commented: #{comment.body.to_s.truncate(140)}")
    end

    def stage_new_follower(follow, follower)
      return unless follow.followable_type == "user"
      recipient = User.find_by(id: follow.followable_id)
      return if recipient.nil? || recipient.id == follower.id
      notify(recipient, kind: "stage_follower", title: "New follower", link: "/stage/authors/user/#{follower.id}",
        body: "#{follower.name} started following you.")
    end

    private

    def notify(user, **attributes)
      return unless user

      Notification.create!(user:, **attributes)
    end

    # Keeps at most one unread notification per (user, kind, link), refreshed in place as
    # further events arrive, the same debouncing new_message uses for conversations.
    def coalesce(user, kind:, link:, title:, body:)
      existing = user.notifications.where(kind:, link:, read_at: nil).order(created_at: :desc).first
      if existing
        existing.update!(title:, body:, created_at: Time.current)
      else
        notify(user, kind:, title:, body:, link:)
      end
    end

    def email(user, template, **params)
      return unless user && NotificationEmail.deliverable_to?(user)

      NotificationEmailJob.perform_later(user.id, template, params.compact.transform_keys(&:to_s))
    rescue StandardError => error
      # The in-app notification is the record of truth; a queue failure must not fail the request.
      Rails.logger.error({ event: "notification_email_enqueue_failed", template:, error: error.class.name }.to_json)
      ErrorReporter.capture(error, tags: { source: "notification_email_enqueue_failed", template: })
    end
  end
end
