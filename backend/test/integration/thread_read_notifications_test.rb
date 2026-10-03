require "test_helper"
require "minitest/mock"
require_relative "../support/query_budget"

# The unread-message badge and thread reads (MessagesController#mark_read!): a poll with nothing new
# writes nothing, a poll that reads a message clears its notification, opening a thread clears any
# stale one, and a message is never committed without its notification.
class ThreadReadNotificationsTest < ActionDispatch::IntegrationTest
  include QueryBudget

  setup do
    @seq = 0
    @hirer = person("Badge Hirer", "employer")
    @artist = person("Badge Artist", "jobseeker")
    @hirer_auth = auth(@hirer)
    @artist_auth = auth(@artist)
    @conversation = Conversation.create!(candidate: @artist, employer: @hirer)
    @path = "/api/conversations/#{@conversation.id}/messages"
  end

  test "a poll with nothing new runs no UPDATE on notifications" do
    send_message(@hirer_auth, "Are you free on the 12th?")
    get @path, headers: @artist_auth
    last = response.parsed_body.fetch("messages").last.fetch("id")
    sqls = capture_queries { get @path, params: { after: last }, headers: @artist_auth }
    assert_response :success
    assert_empty sqls.grep(/\AUPDATE "notifications"/), "a no-op poll must not touch notifications"
  end

  test "the badge clears when a new message arrives while the thread is open" do
    get @path, headers: @artist_auth
    send_message(@hirer_auth, "Rehearsal moved to 6 pm")
    assert_equal 1, unread_badge
    newest = @conversation.messages.order(:created_at).last
    get @path, params: { after: anchor_before(newest).id }, headers: @artist_auth
    assert_equal [newest.id], response.parsed_body.fetch("messages").pluck("id")
    assert_equal 0, unread_badge
  end

  test "opening a thread clears a stale unread notification even when every message is already read" do
    send_message(@hirer_auth, "Set list attached")
    # The state a poll racing the old two-commit send could leave behind: message read, badge unread.
    @conversation.messages.update_all(read_at: Time.current)
    assert_equal 1, unread_badge
    get @path, params: { after: @conversation.messages.first.id }, headers: @artist_auth
    assert_equal 1, unread_badge, "a poll that reads nothing leaves it for the next open"
    get @path, headers: @artist_auth
    assert_equal 0, unread_badge
  end

  test "a message is committed with its notification or not at all, so a poll cannot read one without the other" do
    Notifier.stub(:new_message, ->(*) { raise ActiveRecord::StatementInvalid, "notification insert failed" }) do
      post @path, params: { body: "Half a send" }, headers: @hirer_auth, as: :json
    end
    assert_equal 500, response.status
    assert_equal 0, @conversation.messages.count, "the message rolled back with its notification"
    send_message(@hirer_auth, "Whole send")
    assert_equal 1, @conversation.messages.count
    assert_equal 1, unread_badge
  end

  private

  def anchor_before(message)
    Message.create!(conversation: @conversation, sender: @artist, body: "anchor", created_at: message.created_at - 1.second)
  end

  def send_message(headers, body)
    post @path, params: { body: }, headers:, as: :json
    assert_response :created
  end

  def unread_badge = @artist.notifications.where(kind: Notifier::MESSAGE_KIND, read_at: nil).count

  def person(name, role)
    @seq += 1
    User.create!(name:, email: "badge-#{@seq}-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role:, status: "active", profile_complete: true).tap { _1.create_profile! }
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(32)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 1.day.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
