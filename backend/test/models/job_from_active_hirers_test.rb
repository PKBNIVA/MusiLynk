require "test_helper"

class JobFromActiveHirersTest < ActiveSupport::TestCase
  def build_job(employer)
    Job.create!(employer:, title: "Guitarist", company: "Band Co", location: "Mumbai", kind: "gig", genre: "rock",
      description: "A" * 80, status: "published", published_at: Time.current)
  end

  test "includes a job whose hirer signed in recently" do
    hirer = User.create!(name: "Active Hirer", email: "active-hirer@example.com", password: "StrongPass123!", role: "employer",
      status: "active", last_login_at: 1.day.ago)
    job = build_job(hirer)
    assert_includes Job.from_active_hirers, job
  end

  test "includes a job whose hirer has never signed in again (no evidence either way)" do
    hirer = User.create!(name: "New Hirer", email: "new-hirer@example.com", password: "StrongPass123!", role: "employer", status: "active")
    job = build_job(hirer)
    assert_includes Job.from_active_hirers, job
  end

  test "excludes a job whose hirer last signed in more than 90 days ago" do
    hirer = User.create!(name: "Stale Hirer", email: "stale-hirer@example.com", password: "StrongPass123!", role: "employer",
      status: "active", last_login_at: 100.days.ago)
    job = build_job(hirer)
    assert_not_includes Job.from_active_hirers, job
  end
end
