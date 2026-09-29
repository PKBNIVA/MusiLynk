# Runs hourly (config/initializers/good_job.rb):
#  1. Creates a ReviewPrompt for each party once an urgent request is filled, or a booking is
#     completed (status "completed", or "accepted" with its event date passed) — one row per
#     party, each notified in-app and by email ("How did it go with <name>?").
#  2. Sends the one-time, 3-day reminder for any prompt still unwritten.
#
# Idempotent: the unique (source_type, source_id, user_id) index on review_prompts means a
# prompt is created at most once per party per source.
class ReviewPromptSweepJob < ApplicationJob
  queue_as :scheduled
  LOOKBACK = 14.days

  def perform(now = Time.current)
    prompt_filled_urgent_requests(now)
    prompt_completed_bookings(now)
    send_reminders(now)
  end

  private

  def prompt_filled_urgent_requests(now)
    UrgentRequest.where(status: "filled", updated_at: LOOKBACK.ago..now).find_each do |request|
      filled_by = request.filled_by
      next unless filled_by
      create_pair!(source_type: "urgent_request", source_id: request.id,
        a: request.requester, a_counterpart_name: filled_by.name,
        b: filled_by, b_counterpart_name: request.requester.name)
    end
  end

  def prompt_completed_bookings(now)
    completed = BookingRequest.where(status: "completed", updated_at: LOOKBACK.ago..now)
    past_event = BookingRequest.where(status: "accepted").where("event_date IS NOT NULL AND event_date <= ?", now)
    (completed.to_a + past_event.to_a).uniq(&:id).each do |booking|
      owner = booking.act.owner
      create_pair!(source_type: "booking_request", source_id: booking.id,
        a: booking.requester, a_counterpart_name: booking.act.name,
        b: owner, b_counterpart_name: booking.requester.name)
    end
  end

  def create_pair!(source_type:, source_id:, a:, a_counterpart_name:, b:, b_counterpart_name:)
    return if a.nil? || b.nil? || a.id == b.id
    create_prompt!(source_type:, source_id:, user: a, counterpart: b, counterpart_name: a_counterpart_name)
    create_prompt!(source_type:, source_id:, user: b, counterpart: a, counterpart_name: b_counterpart_name)
  end

  def create_prompt!(source_type:, source_id:, user:, counterpart:, counterpart_name:)
    prompt = ReviewPrompt.create!(source_type:, source_id:, user:, counterpart:, counterpart_name:)
    Notifier.review_prompt(prompt)
    prompt.update!(notified_at: Time.current)
  rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
    nil
  end

  def send_reminders(now)
    ReviewPrompt.due_for_reminder.find_each do |prompt|
      Notifier.review_prompt(prompt, reminder: true)
      prompt.update!(reminded_at: now)
    end
  end
end
