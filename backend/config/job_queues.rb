require "yaml"

# Reads config/job_queues.yml (see there). Plain Ruby, no autoloading: config/database.yml's ERB and
# the GoodJob initializer load it before the app is set up.
module JobQueues
  PATH = File.expand_path("job_queues.yml", __dir__)
  URGENT = "urgent".freeze

  module_function

  def config = @config ||= YAML.safe_load_file(PATH).freeze

  # GoodJob's queue string: "urgent:2;notifications,mailers:2;default,scheduled:1".
  def queue_string(env: ENV)
    custom = env["GOOD_JOB_QUEUES"].to_s.strip
    return custom unless custom.empty?
    config.fetch("pools").map { "#{_1.fetch('queues').join(',')}:#{_1.fetch('threads')}" }.join(";")
  end

  # Job threads one process runs: the sum of the pools, a pool with no count taking
  # GOOD_JOB_MAX_THREADS (GoodJob's rule). Sizes the database pool.
  def thread_count(env: ENV)
    default = Integer(env.fetch("GOOD_JOB_MAX_THREADS", "2"), 10)
    queue_string(env:).split(";").sum do |pool|
      _queues, threads = pool.split(":", 2)
      threads.to_s.strip.empty? ? default : Integer(threads.strip, 10)
    end
  end

  def urgent_email?(template) = config.dig("urgent", "email_templates").include?(template.to_s)
  def urgent_push?(category) = config.dig("urgent", "push_categories").include?(category.to_s)
end
