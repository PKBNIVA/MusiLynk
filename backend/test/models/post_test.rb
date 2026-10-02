require "test_helper"

class PostTest < ActiveSupport::TestCase
  test "a system post needs no created_by_user_id but does need a known system_kind" do
    post = Post.new(author_type: "system", author_id: Post::SYSTEM_AUTHOR_ID, kind: "system", body: "Hello")
    assert_not post.valid?
    assert_includes post.errors[:system_kind], "is not included in the list"

    post.system_kind = "welcome"
    assert post.valid?
    post.save!
    assert_nil post.created_by_user_id
    assert_equal "MusiLynk", post.author_name
    assert_equal false, post.author_verified?
    assert_equal "/musilynk-mark.svg", post.api_json[:author][:avatar]
    assert post.api_json[:author][:system]
  end

  test "an event post needs a title, start time and venue, and validates without a body" do
    owner = User.create!(name: "Event Owner", email: "event-owner@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    post = Post.new(author_type: "user", author_id: owner.id, created_by_user_id: owner.id, kind: "event")
    assert_not post.valid?
    assert_includes post.errors[:event_title], "can't be blank"
    assert_includes post.errors[:event_starts_at], "can't be blank"
    assert_includes post.errors[:event_venue], "can't be blank"

    post.assign_attributes(event_title: "Open Mic", event_starts_at: 3.days.from_now, event_venue: "The Attic", city: "Mumbai")
    assert post.valid?
  end

  test "to_ics renders a VEVENT with the event's details, and nil for a non-event post" do
    owner = User.create!(name: "Ics Owner", email: "ics-owner@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    event = Post.create!(author_type: "user", author_id: owner.id, created_by_user_id: owner.id, kind: "event",
      event_title: "Jam Night", event_starts_at: Time.utc(2026, 10, 5, 19, 0), event_venue: "Blue Frog", city: "Mumbai")

    ics = event.to_ics
    assert_includes ics, "BEGIN:VEVENT"
    assert_includes ics, "SUMMARY:Jam Night"
    assert_includes ics, "DTSTART:20261005T190000Z"
    assert_includes ics, 'LOCATION:Blue Frog\, Mumbai'

    update = Post.create!(author_type: "user", author_id: owner.id, created_by_user_id: owner.id, kind: "update", body: "hi")
    assert_nil update.to_ics
  end

  test "pinned? and the pinned_first scope order a pinned post ahead of newer posts" do
    owner = User.create!(name: "Pin Owner", email: "pin-owner@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    older_pinned = Post.create!(author_type: "user", author_id: owner.id, created_by_user_id: owner.id, body: "old pinned",
      pinned_until: 1.day.from_now)
    older_pinned.update_column(:created_at, 2.days.ago)
    newer = Post.create!(author_type: "user", author_id: owner.id, created_by_user_id: owner.id, body: "new unpinned")

    assert older_pinned.pinned?
    assert_not newer.pinned?

    ordered = Post.where(id: [older_pinned.id, newer.id]).pinned_first.to_a
    assert_equal [older_pinned.id, newer.id], ordered.map(&:id)
  end

  test "upcoming_events scope excludes past events and filters by city" do
    owner = User.create!(name: "Events Owner", email: "events-owner@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    future_mumbai = Post.create!(author_type: "user", author_id: owner.id, created_by_user_id: owner.id, kind: "event",
      event_title: "Future Mumbai", event_starts_at: 2.days.from_now, event_venue: "Venue", city: "Mumbai")
    Post.create!(author_type: "user", author_id: owner.id, created_by_user_id: owner.id, kind: "event",
      event_title: "Future Pune", event_starts_at: 2.days.from_now, event_venue: "Venue", city: "Pune")
    past = Post.create!(author_type: "user", author_id: owner.id, created_by_user_id: owner.id, kind: "event",
      event_title: "Past Event", event_starts_at: 2.days.ago, event_venue: "Venue", city: "Mumbai")

    mumbai_events = Post.upcoming_events(city: "Mumbai")
    assert_includes mumbai_events, future_mumbai
    assert_not_includes mumbai_events, past
    assert_equal 1, mumbai_events.count
  end
end
