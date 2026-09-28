# Browsers on the public site (ALLOWED_ORIGINS) may call every API route except the admin
# API. With ADMIN_ORIGIN set (production once the separate admin site exists), the admin API
# answers only the admin site, which also needs sign-in, sign-out, sign-in methods and /me.
# Both origin lists are read per request so a deploy-time change needs no code change and the
# behaviour is testable; with ADMIN_ORIGIN unset the second block accepts the public origins
# too, which is exactly today's single-block behaviour.
Rails.application.config.middleware.insert_before 0, Rack::Cors do
  public_origins = -> { ENV.fetch("ALLOWED_ORIGINS", "http://localhost:5173").split(",").map(&:strip).reject(&:empty?) }
  public_origin = ->(source, _env) { public_origins.call.include?(source) }
  admin_origin = lambda do |source, env|
    admin = AdminOrigin.configured
    admin ? ActiveSupport::SecurityUtils.secure_compare(source.to_s, admin) : public_origin.call(source, env)
  end
  methods = %i[get post put patch delete options head]

  allow do
    origins(public_origin)
    resource %r{\A/api/(?!admin/)}, headers: :any, methods:
  end

  allow do
    origins(admin_origin)
    resource %r{\A/api/(admin/|auth/login\z|auth/second-factor\z|auth/logout\z|auth/methods\z|me\z)}, headers: :any, methods:
  end
end
