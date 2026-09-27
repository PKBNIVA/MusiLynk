# Coverage must start before the app loads. The report is written to coverage/index.html.
# COVERAGE=0 turns it off entirely.
unless ENV["COVERAGE"] == "0"
  require "simplecov"
  SimpleCov.start do
    enable_coverage :branch
    # Report only app code, and count every app file, including ones no test loads
    # (eager_load is off locally).
    cover "{app,lib}/**/*.rb"
    group "Controllers", "app/controllers"
    group "Models", "app/models"
    group "Services", "app/services"
    group "Jobs", "app/jobs"
    # A few points under the measured full-suite figure (96.6% line, 81.4% branch) so
    # coverage cannot quietly slide; raise it as coverage goes up. Enforced on CI (and with
    # COVERAGE_FLOOR=1) only, because running a single test file locally is far below it.
    minimum_coverage line: 94, branch: 78 if ENV["CI"].present? || ENV["COVERAGE_FLOOR"] == "1"
  end
end

ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"

class ActiveSupport::TestCase
  parallelize(workers: 1)
end
