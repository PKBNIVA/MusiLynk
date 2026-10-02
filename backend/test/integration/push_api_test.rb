require "test_helper"
require "minitest/mock"
require_relative "../support/showcase_helpers"
require_relative "../support/push_helpers"

class PushApiTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper
  include ShowcaseHelpers
  include PushHelpers

  setup do
    @user = make_user("Push Musician")
    @user.create_profile!
    clear_enqueued_jobs
  end

  test "config reports disabled with no key when the VAPID variables are unset, without signing in" do
    with_push_env(enabled: false) do
      get "/api/push/config"
      assert_response :success
      assert_equal({ "enabled" => false, "publicKey" => nil }, response.parsed_body)
    end
  end

  test "config stays disabled when any one of the three variables is missing" do
    with_push_env do
      ENV.delete("VAPID_SUBJECT")
      get "/api/push/config"
      assert_equal false, response.parsed_body["enabled"]
      assert_nil response.parsed_body["publicKey"]
    end
  end

  test "config returns the public key only, never the private key" do
    with_push_env do |key|
      get "/api/push/config"
      assert_equal({ "enabled" => true, "publicKey" => key.public_key }, response.parsed_body)
      refute_includes response.body, key.private_key
    end
  end

  test "subscribe and unsubscribe need a signed-in user" do
    with_push_env do
      post "/api/push/subscriptions", params: subscription_params, as: :json
      assert_response :unauthorized
      delete "/api/push/subscriptions", params: { endpoint: "#{ENDPOINT_BASE}x" }, as: :json
      assert_response :unauthorized
      get "/api/push/preferences"
      assert_response :unauthorized
      put "/api/push/preferences", params: { preferences: { urgent: false } }, as: :json
      assert_response :unauthorized
    end
  end

  test "subscribing stores the device with encrypted endpoint and keys and a short device label" do
    with_push_env do
      params = subscription_params
      post "/api/push/subscriptions", params:, headers: auth(@user).merge("User-Agent" => "Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36"), as: :json
      assert_response :created
      subscription = @user.push_subscriptions.sole
      assert_equal params[:endpoint], subscription.endpoint
      assert_equal "Chrome on Android", subscription.user_agent_summary
      raw = PushSubscription.with_connection { |c| c.select_rows("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE id = #{c.quote(subscription.id)}").first } # undecrypted columns
      refute_includes raw[0], "googleapis"
      refute_includes raw[1], params[:keys][:p256dh]
      refute_includes raw[2], params[:keys][:auth]
      refute_includes response.body, params[:endpoint]
    end
  end

  test "subscribing again with the same endpoint updates one row; another user signing in on that device takes it over" do
    with_push_env do
      params = subscription_params
      2.times { post "/api/push/subscriptions", params:, headers: auth(@user), as: :json }
      assert_equal 1, PushSubscription.count

      other = make_user("Shared Device")
      post "/api/push/subscriptions", params:, headers: auth(other), as: :json
      assert_response :created
      assert_equal 1, PushSubscription.count
      assert_equal other.id, PushSubscription.sole.user_id
    end
  end

  test "subscribing is refused when push is not configured" do
    with_push_env(enabled: false) do
      post "/api/push/subscriptions", params: subscription_params, headers: auth(@user), as: :json
      assert_response :not_found
      assert_equal "PUSH_DISABLED", response.parsed_body["code"]
      assert_equal 0, PushSubscription.count
    end
  end

  test "subscribing rejects missing keys and endpoints that are not a browser push service" do
    with_push_env do
      post "/api/push/subscriptions", params: { endpoint: "#{ENDPOINT_BASE}x" }, headers: auth(@user), as: :json
      assert_response :unprocessable_content

      [ "http://fcm.googleapis.com/fcm/send/x", "https://169.254.169.254/latest", "https://evil.example.com/push",
        "https://fcm.googleapis.com.evil.example.com/x", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "not a url" ].each do |endpoint|
        post "/api/push/subscriptions", params: subscription_params(endpoint:), headers: auth(@user), as: :json
        assert_response :unprocessable_content, endpoint
      end
      assert_equal 0, PushSubscription.count
    end
  end

  test "accepts the endpoints of the major browser push services" do
    with_push_env do
      %w[https://fcm.googleapis.com/fcm/send/a https://updates.push.services.mozilla.com/wpush/v2/a
         https://web.push.apple.com/a https://wns2-par02p.notify.windows.com/w/?token=a].each do |endpoint|
        post "/api/push/subscriptions", params: subscription_params(endpoint:), headers: auth(@user), as: :json
        assert_response :created, endpoint
      end
    end
  end

  test "keeps at most ten devices per user, dropping the oldest" do
    with_push_env do
      first = make_subscription(@user, created_at: 1.day.ago)
      9.times { make_subscription(@user) }
      post "/api/push/subscriptions", params: subscription_params, headers: auth(@user), as: :json
      assert_equal 10, @user.push_subscriptions.count
      assert_nil PushSubscription.find_by(id: first.id)
    end
  end

  test "unsubscribe removes the caller's own subscription by endpoint and never someone else's" do
    with_push_env do
      mine = make_subscription(@user)
      theirs = make_subscription(make_user("Other Person"))

      delete "/api/push/subscriptions", params: { endpoint: theirs.endpoint }, headers: auth(@user), as: :json
      assert_response :success
      assert PushSubscription.exists?(theirs.id)

      delete "/api/push/subscriptions", params: { endpoint: mine.endpoint }, headers: auth(@user), as: :json
      assert_response :success
      refute PushSubscription.exists?(mine.id)

      delete "/api/push/subscriptions", params: {}, headers: auth(@user), as: :json
      assert_response :bad_request
    end
  end

  test "subscribe is rate limited per user" do
    with_push_env do
      Rails.cache = ActiveSupport::Cache::MemoryStore.new
      PushController::CHANGES_PER_HOUR.times { post "/api/push/subscriptions", params: subscription_params, headers: auth(@user), as: :json }
      post "/api/push/subscriptions", params: subscription_params, headers: auth(@user), as: :json
      assert_response :too_many_requests
    ensure
      Rails.cache = ActiveSupport::Cache::NullStore.new
    end
  end

  test "preferences default to urgent on, messages and bookings off, and save per category" do
    get "/api/push/preferences", headers: auth(@user)
    assert_equal({ "urgent" => true, "messages" => false, "bookings" => false }, response.parsed_body["preferences"])

    put "/api/push/preferences", params: { preferences: { messages: true, urgent: false } }, headers: auth(@user), as: :json
    assert_response :success
    assert_equal({ "urgent" => false, "messages" => true, "bookings" => false }, response.parsed_body["preferences"])
    assert_equal({ "urgent" => false, "messages" => true, "bookings" => false }, @user.profile.reload.push_preferences)
  end

  test "preferences reject unknown categories and non-boolean values" do
    put "/api/push/preferences", params: { preferences: { marketing: true } }, headers: auth(@user), as: :json
    assert_response :bad_request
    put "/api/push/preferences", params: { preferences: { urgent: "no" } }, headers: auth(@user), as: :json
    assert_response :bad_request
    put "/api/push/preferences", params: {}, headers: auth(@user), as: :json
    assert_response :bad_request
  end

  test "deleting an account removes its devices" do
    make_subscription(@user)
    assert_difference -> { PushSubscription.count }, -1 do
      @user.destroy!
    end
  end

  # Notifier -> PushNotifications.notify -> PushDeliveryJob

  test "an urgent alert queues a push for a subscribed musician, with a link to their own workspace" do
    with_push_env do
      make_subscription(@user)
      hirer = make_user("Urgent Hirer", "employer")
      request = UrgentRequest.create!(requester: hirer, title: "Drummer for tomorrow", role_name: "Drummer", city: "Mumbai", start_at: 1.day.from_now, currency: "INR", status: "open")
      clear_enqueued_jobs
      Notifier.urgent_request_alert(request, @user, ["Plays Drummer"])
      job = enqueued_jobs.find { _1["job_class"] == "PushDeliveryJob" }
      assert job, "a push job is queued"
      user_id, category, payload = ActiveJob::Arguments.deserialize(job["arguments"])
      assert_equal [@user.id, "urgent"], [user_id, category]
      assert_equal "/jobseeker/urgent", payload["url"]
      assert_match(/Urgent: Drummer needed in Mumbai/, payload["title"])
    end
  end

  test "nothing is queued when push is off, the user has no device, or the category is switched off" do
    request = nil
    hirer = make_user("Urgent Hirer 2", "employer")
    request = UrgentRequest.create!(requester: hirer, title: "Keys for tomorrow", role_name: "Keys", city: "Pune", start_at: 1.day.from_now, currency: "INR", status: "open")
    make_subscription(@user)
    clear_enqueued_jobs

    with_push_env(enabled: false) { Notifier.urgent_request_alert(request, @user) }
    assert_empty enqueued_jobs.select { _1["job_class"] == "PushDeliveryJob" }

    with_push_env do
      Notifier.urgent_request_alert(request, make_user("No Device"))
      @user.profile.update!(push_preferences: { "urgent" => false })
      Notifier.urgent_request_alert(request, @user.reload)
    end
    assert_empty enqueued_jobs.select { _1["job_class"] == "PushDeliveryJob" }
  end

  test "a new message pushes only when the recipient opted in to messages, and never carries the text" do
    with_push_env do
      sender = make_user("Message Sender", "employer")
      conversation = Conversation.create!(candidate: @user, employer: sender)
      message = conversation.messages.create!(sender:, body: "Secret text about the gig")
      make_subscription(@user)
      clear_enqueued_jobs

      Notifier.new_message(message)
      assert_empty enqueued_jobs.select { _1["job_class"] == "PushDeliveryJob" }, "messages are off by default"

      @user.profile.update!(push_preferences: { "messages" => true })
      Notification.where(user: @user).delete_all
      Notifier.new_message(message)
      job = enqueued_jobs.find { _1["job_class"] == "PushDeliveryJob" }
      assert job
      refute_includes job["arguments"].to_json, "Secret text"
      assert_equal "/jobseeker/messages?c=#{conversation.id}", ActiveJob::Arguments.deserialize(job["arguments"]).last["url"]
    end
  end

  test "a confirmed or cancelled booking pushes to the other side when bookings are on; other statuses do not" do
    with_push_env do
      owner = make_user("Act Owner")
      hirer = make_user("Booking Hirer", "employer")
      hirer.create_profile!(push_preferences: { "bookings" => true }) unless hirer.profile
      hirer.profile.update!(push_preferences: { "bookings" => true })
      make_subscription(hirer)
      act = make_act(owner)
      booking = BookingRequest.create!(act:, requester: hirer, status: "accepted", event_type: "Wedding", city: "Goa", currency: "INR")
      clear_enqueued_jobs

      Notifier.booking_status(booking, actor: owner)
      payload = ActiveJob::Arguments.deserialize(enqueued_jobs.find { _1["job_class"] == "PushDeliveryJob" }["arguments"]).last
      assert_equal "Booking confirmed", payload["title"]
      assert_equal "/employer/bookings", payload["url"]

      clear_enqueued_jobs
      booking.update!(status: "viewed")
      Notifier.booking_status(booking, actor: owner)
      assert_empty enqueued_jobs.select { _1["job_class"] == "PushDeliveryJob" }
    end
  end
end
