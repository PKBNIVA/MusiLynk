require "test_helper"

class ShareCardTest < ActiveSupport::TestCase
  test "renders a story and landscape SVG with the musician's name and a QR code linking to their profile" do
    user = User.create!(name: "Card Musician", email: "card-musician@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    user.create_profile!(roles: ["Guitarist"], location: "Bengaluru", verified: true)

    story = ShareCard.story(user)
    assert_includes story, "<svg"
    assert_includes story, "1080"
    assert_includes story, "1920"
    assert_includes story, "Card Musician"
    assert_includes story, "Guitarist"
    assert_includes story, "Bengaluru"
    assert_includes story, "Verified on MusiLynk"

    landscape = ShareCard.landscape(user)
    assert_includes landscape, "1200"
    assert_includes landscape, "630"
  end

  test "escapes the musician's name so it cannot inject markup into the card" do
    user = User.create!(name: "<script>alert(1)</script>", email: "card-xss@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    user.create_profile!

    svg = ShareCard.story(user)
    assert_not_includes svg, "<script>"
    assert_includes svg, "&lt;script&gt;"
  end
end
