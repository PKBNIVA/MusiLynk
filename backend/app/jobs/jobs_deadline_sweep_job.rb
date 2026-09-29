# "Jobs close on their deadline": runs hourly (see config/initializers/good_job.rb). Any
# published job whose application_deadline has passed is closed and its hirer is notified
# once. Closing only ever moves published -> closed; nothing else touches application_deadline.
class JobsDeadlineSweepJob < ApplicationJob
  queue_as :default

  def perform
    Job.published.where.not(application_deadline: nil).where("application_deadline < ?", Time.current).find_each do |job|
      job.update!(status: "closed")
      Notifier.job_deadline_closed(job)
    end
  end
end
