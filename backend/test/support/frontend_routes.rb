# The marketplace's real page addresses, read from src/app/routes.tsx, so a test can tell whether
# a link in an email or notification lands on a page or on the 404. Also a Ruby port of the
# client's notificationDestination (src/app/pages/Notifications.tsx), which maps the role-neutral
# links the API stores into each workspace; its tables are read from that file.
module FrontendRoutes
  ROOT = Rails.root.join("..").expand_path
  SOURCE = File.read(ROOT.join("src/app/routes.tsx"))
  NOTIFICATIONS_SOURCE = File.read(ROOT.join("src/app/pages/Notifications.tsx"))
  RESUME_PAGES = %w[career resumes resume resumePrint].freeze

  module_function

  def patterns
    @patterns ||= begin
      marketplace = SOURCE[/function publicRoutes\(\).*?\nfunction adminRoutes/m]
      jobseeker_at = marketplace.index("path: '/jobseeker'")
      employer_at = marketplace.index("path: '/employer'")
      stage_at = marketplace.index("path: '/stage'")
      top = marketplace[0...jobseeker_at].scan(/path: '(\/[^']*)'/).flatten
      js = marketplace[jobseeker_at...employer_at].scan(/path: '([^'\/][^']*)'/).flatten.map { "/jobseeker/#{_1}" }
      em = marketplace[employer_at...stage_at].scan(/path: '([^'\/][^']*)'/).flatten.map { "/employer/#{_1}" }
      stage = marketplace[stage_at..].scan(/path: '(\/stage[^']*)'/).flatten
      showcase = marketplace[/showcasePaths = \{(.*?)\}/m, 1].scan(/(\w+): '([^']+)'/).reject { RESUME_PAGES.include?(_1.first) }
      js += showcase.map { "/jobseeker/#{_2}" }
      em += showcase.reject { _1.first == "library" }.map { "/employer/#{_2}" }
      (top + ["/jobseeker", "/employer"] + js + em + stage).uniq.reject { _1 == "*" }
    end
  end

  def regexes = @regexes ||= patterns.map { Regexp.new("\\A#{Regexp.escape(_1).gsub(/:\w+/, '[^/]+')}/?\\z") }

  # True when a page exists at this path (query and fragment are ignored).
  def exist?(path) = regexes.any? { _1.match?(path.to_s.sub(/[?#].*\z/, "")) }

  def shared = @shared ||= NOTIFICATIONS_SOURCE[/const SHARED[^{]*\{(.*?)\}/m, 1].scan(/'([^']+)': '([^']+)'/).to_h
  def public_pages = @public_pages ||= NOTIFICATIONS_SOURCE[/PUBLIC_PAGES = new Set\(\[(.*?)\]\)/m, 1].scan(/'([^']+)'/).flatten
  def kind_fallback
    @kind_fallback ||= NOTIFICATIONS_SOURCE[/const KIND_FALLBACK[^{]*\{(.*?)\n\};/m, 1].scan(/(\w+): \{ jobseeker: '([^']+)', employer: '([^']+)' \}/)
      .to_h { |kind, js, em| [kind, { "jobseeker" => js, "employer" => em }] }
  end

  # Where the client sends a viewer of `role` who opens a notification with this stored link; nil
  # when there is nowhere to go.
  def notification_destination(link, role, kind)
    base = role == "employer" ? "/employer" : "/jobseeker"
    fallback = kind_fallback.dig(kind.to_s, role)
    return fallback if link.blank?

    path = link.sub(/[?#].*\z/, "")
    suffix = link[path.length..]
    return(role == "jobseeker" ? "#{base}/reviews#{suffix}" : base) if path == "/reviews"
    return "#{base}/#{shared[path]}#{suffix}" if shared[path]
    return link if public_pages.include?(path) || path.match?(%r{\A/stage(/|\z)})
    return(role == "employer" ? "/employer/applications" : "/jobseeker/hiring/applicants") if path == "/hiring/applicants"
    return "#{base}#{path}#{suffix}" if path.match?(%r{\A/jobs/[^/]+\z})

    other = role == "employer" ? "/jobseeker" : "/employer"
    return(fallback || base) if path == other
    if path.start_with?("#{other}/")
      rest = path[(other.length + 1)..]
      return "#{base}/#{rest}#{suffix}" if rest.match?(%r{\Ajobs/[^/]+\z}) || shared.value?(rest)
      return "/employer/applications" if role == "employer" && rest == "hiring/applicants"
      return "/jobseeker/hiring/applicants" if role == "jobseeker" && rest == "applications"
      return fallback || base
    end
    return link if path == base || path.start_with?("#{base}/")

    fallback || base
  end
end
