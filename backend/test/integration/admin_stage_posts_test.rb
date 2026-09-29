require "test_helper"

# Admin moderation of The Stage beyond the reports flow: pin/unpin, feature (events) and delete.
class AdminStagePostsTest < ActionDispatch::IntegrationTest
  setup do
    @seq = 0
    @admin = create_user("Stage Admin", "admin")
    @author = create_user("Stage Post Author", "jobseeker")
  end

  test "pins a post, defaulting to a week, and unpins it" do
    post_record = Post.create!(author_type: "user", author_id: @author.id, created_by_user_id: @author.id, body: "Pin me", visibility: "public")

    post "/api/admin/stage-posts/#{post_record.id}/pin", headers: auth(@admin), as: :json
    assert_response :success
    post_record.reload
    assert post_record.pinned?
    assert_in_delta 7.days.from_now, post_record.pinned_until, 1.minute

    post "/api/admin/stage-posts/#{post_record.id}/unpin", headers: auth(@admin), as: :json
    assert_response :success
    assert_nil post_record.reload.pinned_until
  end

  test "pins a post until a given time" do
    post_record = Post.create!(author_type: "user", author_id: @author.id, created_by_user_id: @author.id, body: "Pin me until", visibility: "public")
    until_at = 3.days.from_now.iso8601

    post "/api/admin/stage-posts/#{post_record.id}/pin", params: { until: until_at }, headers: auth(@admin), as: :json
    assert_response :success
    assert_in_delta Time.zone.parse(until_at), post_record.reload.pinned_until, 1.second
  end

  test "features and unfeatures an event post, but refuses on a non-event post" do
    event = Post.create!(author_type: "user", author_id: @author.id, created_by_user_id: @author.id, kind: "event",
      event_title: "Jam", event_starts_at: 2.days.from_now, event_venue: "Venue", city: "Mumbai")
    ordinary = Post.create!(author_type: "user", author_id: @author.id, created_by_user_id: @author.id, body: "Not an event", visibility: "public")

    post "/api/admin/stage-posts/#{event.id}/feature", headers: auth(@admin), as: :json
    assert_response :success
    assert event.reload.featured?

    post "/api/admin/stage-posts/#{event.id}/feature", headers: auth(@admin), as: :json
    assert_response :success
    assert_not event.reload.featured?

    post "/api/admin/stage-posts/#{ordinary.id}/feature", headers: auth(@admin), as: :json
    assert_response :unprocessable_content
  end

  test "deletes any post" do
    post_record = Post.create!(author_type: "user", author_id: @author.id, created_by_user_id: @author.id, body: "Delete me", visibility: "public")

    delete "/api/admin/stage-posts/#{post_record.id}", headers: auth(@admin), as: :json
    assert_response :success
    assert_equal "deleted", post_record.reload.status
  end

  test "requires admin" do
    post_record = Post.create!(author_type: "user", author_id: @author.id, created_by_user_id: @author.id, body: "No admin", visibility: "public")
    post "/api/admin/stage-posts/#{post_record.id}/pin", headers: auth(@author), as: :json
    assert_response :forbidden
  end

  private

  def create_user(name, role)
    @seq += 1
    User.create!(name:, email: "admin-stage-#{@seq}-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role:, status: "active").tap do
      _1.create_profile! unless role == "admin"
    end
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
