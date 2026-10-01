require "test_helper"

class ReviewPromptSweepJobTest < ActiveJob::TestCase
  def make_user(name, email, role: "jobseeker")
    user = User.create!(name:, email:, password: "StrongPass123!", role:, status: "active", email_verified: true)
    user.create_profile!
    user
  end

  test "prompts both parties once an urgent request is filled, notifying and emailing each" do
    requester = make_user("Urgent Hirer", "urgent-hirer@example.com", role: "employer")
    filled_by = make_user("Urgent Player", "urgent-player@example.com")
    request = UrgentRequest.create!(requester:, title: "Need a keys player", role_name: "Keys", city: "Delhi",
      currency: "INR", start_at: 1.hour.from_now, status: "open")
    request.update!(status: "filled", filled_by:)

    ReviewPromptSweepJob.perform_now

    requester_prompt = ReviewPrompt.find_by(source_type: "urgent_request", source_id: request.id, user_id: requester.id)
    player_prompt = ReviewPrompt.find_by(source_type: "urgent_request", source_id: request.id, user_id: filled_by.id)
    assert requester_prompt
    assert player_prompt
    assert_equal filled_by.id, requester_prompt.counterpart_user_id
    assert_equal requester.id, player_prompt.counterpart_user_id
    assert requester_prompt.notified_at.present?
    assert_equal 1, requester.notifications.where(kind: "review_prompt").count
    assert_equal 1, filled_by.notifications.where(kind: "review_prompt").count
    assert_equal "/jobseeker/reviews?employerId=#{requester.id}", filled_by.notifications.find_by(kind: "review_prompt").link
    assert_equal "/employer", requester.notifications.find_by(kind: "review_prompt").link
  end

  test "never creates a second prompt for the same source and party" do
    requester = make_user("Repeat Hirer", "repeat-review-hirer@example.com", role: "employer")
    filled_by = make_user("Repeat Player", "repeat-review-player@example.com")
    request = UrgentRequest.create!(requester:, title: "Need a keys player", role_name: "Keys", city: "Delhi",
      currency: "INR", start_at: 1.hour.from_now, status: "open")
    request.update!(status: "filled", filled_by:)

    2.times { ReviewPromptSweepJob.perform_now }

    assert_equal 1, ReviewPrompt.where(source_type: "urgent_request", source_id: request.id, user_id: requester.id).count
    assert_equal 1, requester.notifications.where(kind: "review_prompt").count
  end

  test "sends the one-time reminder after 3 days, and never a second one" do
    requester = make_user("Reminder Hirer", "reminder-hirer@example.com", role: "employer")
    counterpart = make_user("Reminder Player", "reminder-player@example.com")
    prompt = ReviewPrompt.create!(source_type: "urgent_request", source_id: "urge_fixture", user: requester,
      counterpart:, counterpart_name: counterpart.name, notified_at: 4.days.ago)

    ReviewPromptSweepJob.perform_now
    assert prompt.reload.reminded_at.present?
    assert_equal 1, requester.notifications.where(kind: "review_prompt").count

    reminded_at = prompt.reminded_at
    ReviewPromptSweepJob.perform_now
    assert_equal reminded_at, prompt.reload.reminded_at
    assert_equal 1, requester.notifications.where(kind: "review_prompt").count
  end

  test "does not remind before 3 days, or once the review is written" do
    requester = make_user("No Reminder Hirer", "no-reminder-hirer@example.com", role: "employer")
    counterpart = make_user("No Reminder Player", "no-reminder-player@example.com")
    too_soon = ReviewPrompt.create!(source_type: "urgent_request", source_id: "urge_soon", user: requester,
      counterpart:, counterpart_name: counterpart.name, notified_at: 1.day.ago)
    already_done = ReviewPrompt.create!(source_type: "urgent_request", source_id: "urge_done", user: requester,
      counterpart:, counterpart_name: counterpart.name, notified_at: 4.days.ago, completed_at: 1.hour.ago)

    ReviewPromptSweepJob.perform_now

    assert_nil too_soon.reload.reminded_at
    assert_nil already_done.reload.reminded_at
  end

  test "prompts both parties once a booking completes" do
    owner = make_user("Act Owner", "act-owner-review@example.com")
    act = Act.create!(owner:, name: "Review Test Act", act_type: "Band", currency: "INR", fee_basis: "event", status: "active")
    requester = make_user("Booking Requester", "booking-requester-review@example.com", role: "employer")
    booking = BookingRequest.create!(act:, requester:, event_type: "Wedding", city: "Goa", currency: "INR", status: "requested")
    booking.update!(status: "completed")

    ReviewPromptSweepJob.perform_now

    assert ReviewPrompt.exists?(source_type: "booking_request", source_id: booking.id, user_id: owner.id)
    assert ReviewPrompt.exists?(source_type: "booking_request", source_id: booking.id, user_id: requester.id)
  end
end
