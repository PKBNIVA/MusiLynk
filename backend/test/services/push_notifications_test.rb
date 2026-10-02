require "test_helper"

class PushNotificationsServiceTest < ActiveSupport::TestCase
  test "describes a device without keeping the raw user agent" do
    assert_equal "Chrome on Android", PushNotifications.user_agent_summary("Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/126 Mobile Safari/537.36")
    assert_equal "Safari on iOS", PushNotifications.user_agent_summary("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17 Mobile Safari/604")
    assert_equal "Firefox on Windows", PushNotifications.user_agent_summary("Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0")
    assert_equal "Browser", PushNotifications.user_agent_summary(nil)
  end

  test "endpoint validation accepts https push services only" do
    assert PushNotifications.valid_endpoint?("https://fcm.googleapis.com/fcm/send/abc")
    refute PushNotifications.valid_endpoint?("https://localhost/x")
    refute PushNotifications.valid_endpoint?("https://fcm.googleapis.com.attacker.test/x")
    refute PushNotifications.valid_endpoint?("ftp://fcm.googleapis.com/x")
    refute PushNotifications.valid_endpoint?(nil)
  end
end
