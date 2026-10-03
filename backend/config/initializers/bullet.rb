# N+1 detection (the bullet gem, development and test only; it is not in the production bundle).
#
# Tests: an N+1 inside a request raises Bullet::Notification::UnoptimizedQueryError, so the request
# fails and the test with it. Development: the same findings go to the Rails log instead.
# Unused eager loading and counter-cache hints are off: both are advisory and noisy for an API
# whose serializers deliberately preload for the common case.
if defined?(Bullet)
  Rails.application.config.after_initialize do
    Bullet.enable = Rails.env.test? || Rails.env.development?
    Bullet.raise = Rails.env.test?
    Bullet.rails_logger = Rails.env.development?
    Bullet.n_plus_one_query_enable = true
    Bullet.unused_eager_loading_enable = false
    Bullet.counter_cache_enable = false
  end
end
