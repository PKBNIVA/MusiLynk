module SyntheticQa
  # The hand-written content packs behind SyntheticQa::Showcase (config/demo/*.yml): names, bios,
  # companies, opportunities, urgent requests, conversations, Stage posts, reviews, acts, cover notes
  # and the CC BY tracks. Read once per process; the files are data, not code.
  module ShowcaseContent
    DIR = Rails.root.join("config/demo").freeze

    module_function

    def names = read("names")
    def roles = read("bios").fetch("roles")
    def bios = read("bios").fetch("bios")
    def companies = read("companies").fetch("companies")
    def jobs = read("jobs").fetch("jobs")
    def urgent_requests = read("urgent").fetch("urgent_requests")
    def threads = read("messages").fetch("threads")
    def posts = read("posts").fetch("posts")
    def booking_reviews = read("reviews").fetch("bookings")
    def tracks = read("tracks").fetch("tracks")
    def acts = read("acts").fetch("acts")
    def application_notes = read("applications").fetch("applications")

    def read(name)
      @cache ||= {}
      @cache[name] ||= YAML.safe_load_file(DIR.join("#{name}.yml")).freeze
    end
  end
end
