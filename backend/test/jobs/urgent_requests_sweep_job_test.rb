require "test_helper"

class UrgentRequestsSweepJobTest < ActiveSupport::TestCase
  setup do
    @hirer = User.create!(name: "Hirer", email: "sweep-hirer@example.com", password: "StrongPass123!", role: "employer", status: "active")
    @musician = User.create!(name: "Musician", email: "sweep-musician@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    @musician.create_profile!(headline: "Drummer", location: "Mumbai", roles: ["Drummer"])
  end

  def build_request(expires_at:)
    UrgentRequest.create!(requester: @hirer, title: "Drummer needed", role_name: "Drummer", city: "Mumbai",
      start_at: 1.hour.from_now, currency: "INR", status: "open", expires_at:)
  end

  test "warns the hirer 6 hours before expiry when there is at least one response" do
    request = build_request(expires_at: 5.hours.from_now)
    UrgentRequestResponse.create!(urgent_request: request, user: @musician, status: "available")

    UrgentRequestsSweepJob.perform_now

    assert request.reload.expiry_warned_at.present?
    assert Notification.exists?(user: @hirer, kind: "urgent_expiry_warning")
  end

  test "does not warn a request with no responses" do
    request = build_request(expires_at: 5.hours.from_now)
    UrgentRequestsSweepJob.perform_now
    assert_nil request.reload.expiry_warned_at
    assert_not Notification.exists?(user: @hirer, kind: "urgent_expiry_warning")
  end

  test "does not warn twice" do
    request = build_request(expires_at: 5.hours.from_now)
    UrgentRequestResponse.create!(urgent_request: request, user: @musician, status: "available")
    UrgentRequestsSweepJob.perform_now
    first_warned_at = request.reload.expiry_warned_at
    UrgentRequestsSweepJob.perform_now
    assert_equal first_warned_at, request.reload.expiry_warned_at
    assert_equal 1, Notification.where(user: @hirer, kind: "urgent_expiry_warning").count
  end

  test "expires an open request past its expires_at and notifies every responder" do
    request = build_request(expires_at: 1.hour.ago)
    UrgentRequestResponse.create!(urgent_request: request, user: @musician, status: "available")

    UrgentRequestsSweepJob.perform_now

    assert_equal "expired", request.reload.status
    assert Notification.exists?(user: @musician, kind: "urgent_expired")
  end

  test "does not touch a request that is already filled" do
    request = build_request(expires_at: 1.hour.ago)
    request.update!(status: "filled")
    UrgentRequestsSweepJob.perform_now
    assert_equal "filled", request.reload.status
  end
end
