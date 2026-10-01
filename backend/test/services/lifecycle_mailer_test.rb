require "test_helper"

class LifecycleMailerTest < ActiveSupport::TestCase
  # Every in-app route a lifecycle CTA may point at (src/app/routes.tsx). A path missing here
  # lands on the 404 page, so add the route to the SPA first.
  SPA_ROUTES = %w[
    /jobseeker/library /jobseeker/profile /jobseeker/availability /jobseeker/urgent
    /employer/post-job /employer/candidates /employer/applications /employer/urgent
  ].freeze

  PARAMS = { "count" => 3, "city" => "Mumbai", "role" => "Drummer", "title" => "Wedding set", "hours" => 2,
             "candidate" => "A. Singh", "job" => "Wedding set", "minutes" => 12 }.freeze

  test "every template builds one workspace-prefixed link to a real route, never a doubled prefix" do
    LifecycleMailer::STEPS.each_key do |key|
      role = key.include?("hirer") ? "employer" : "jobseeker"
      user = User.create!(name: "Mailer #{key}", email: "mailer-#{SecureRandom.hex(4)}@example.com",
        password: "StrongPass123!", role:, status: "active", email_verified: true)
      user.create_profile!

      content = LifecycleMailer.render_step(key, PARAMS, user)
      link = LifecycleMailer.step_link(key)
      uri = URI.parse(link)

      assert_no_match %r{/(jobseeker|employer)/(jobseeker|employer)/}, link, "#{key} doubles the workspace prefix"
      assert_includes SPA_ROUTES, uri.path, "#{key} links to #{uri.path}, which is not an app route"
      assert uri.path.start_with?("/#{role}/"), "#{key} must stay inside the #{role} workspace"
      assert_includes content[:text], link
      assert_includes content[:html], ERB::Util.html_escape(link)
    end
  end
end
