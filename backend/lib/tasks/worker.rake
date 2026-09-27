namespace :worker do
  desc "Checks run by bin/worker before starting GoodJob: uploads reachable, migrations applied"
  task preflight: :environment do
    WorkerPreflight.new.call
  rescue WorkerPreflight::NotAllowed => error
    abort error.message
  end
end
