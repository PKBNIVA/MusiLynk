# The fixed allow-list of AiAssist tasks. Each entry owns its server-side system prompt, its
# prompt template, its input shape (so the client only ever sends structured context, never a
# raw prompt) and its output caps. Nothing here is client-configurable.
module AiAssist::Tasks
  Field = Struct.new(:type, :max, :required, :items_max, :allowed, keyword_init: true) do
    def required? = !!required
  end

  Task = Struct.new(:key, :system_prompt, :fields, :max_output_tokens, :max_output_chars, :long, :template, keyword_init: true) do
    def long? = !!long
    def build_prompt(context) = template.call(context)
  end

  COMMON_SYSTEM_PROMPT = <<~PROMPT.freeze
    You are the writing assistant inside Verse, a professional network and hiring marketplace for
    India's music industry (musicians, engineers, crew, studios, labels, venues and event
    companies). Write for that Indian market. Match the user's language when it is evident from
    the context provided; otherwise write in clear English. Use only the facts given in the
    context below — never invent names, numbers, credits, dates, awards or achievements. When a
    fact is needed but missing, leave a bracketed placeholder such as [company name] rather than
    guessing. Never include phone numbers, email addresses, social handles or links unless one is
    explicitly given in the context. Reply with plain text only: no markdown, no headings, no code
    fences, no preamble or explanation — only the requested text itself.
  PROMPT

  def self.sanitizer
    @sanitizer ||= Rails::Html::FullSanitizer.new
  end

  # Strips HTML, trims, and caps every string field; validates presence and array sizes.
  # Raises AiAssist::Error(code: "INVALID_CONTEXT") on anything out of shape.
  def self.validate!(spec, context)
    context = context.is_a?(Hash) ? context : {}
    out = {}
    spec.fields.each do |name, field|
      raw = context[name.to_s] || context[name.to_sym]
      if raw.nil? || (raw.is_a?(String) && raw.strip.empty?)
        raise AiAssist::Error.new("#{name} is required.", code: "INVALID_CONTEXT") if field.required?
        out[name] = field.type == :array ? [] : nil
        next
      end
      out[name] = coerce(name, field, raw)
      if field.allowed && !field.allowed.include?(out[name])
        raise AiAssist::Error.new("#{name} must be one of #{field.allowed.join(', ')}.", code: "INVALID_CONTEXT")
      end
    end
    out
  end

  def self.coerce(name, field, raw)
    case field.type
    when :array
      values = Array(raw).first(field.items_max || 20)
      values.map { clean_string(_1.to_s, field.max || 200) }
    else
      raise AiAssist::Error.new("#{name} must be text.", code: "INVALID_CONTEXT") unless raw.is_a?(String) || raw.respond_to?(:to_s)
      clean_string(raw.to_s, field.max || 500)
    end
  end

  def self.clean_string(value, max)
    sanitizer.sanitize(value).strip[0, max]
  end

  def self.join_lines(values) = values.reject(&:blank?).map { "- #{_1}" }.join("\n")

  REGISTRY = {
    "job_description" => Task.new(
      key: "job_description",
      system_prompt: COMMON_SYSTEM_PROMPT + "\nWrite a single job description of 120 to 250 words, in flowing paragraphs (a short intro plus what the role covers), based only on the fields given.",
      fields: {
        title: Field.new(type: :string, max: 160, required: true),
        type: Field.new(type: :string, max: 80),
        function: Field.new(type: :string, max: 80),
        city: Field.new(type: :string, max: 80),
        pay: Field.new(type: :string, max: 120),
        keyPoints: Field.new(type: :array, max: 200, items_max: 15)
      },
      max_output_tokens: 500, max_output_chars: 2200, long: true,
      template: ->(c) {
        <<~PROMPT
          Write a job description for this opening.
          Title: #{c[:title]}
          Type: #{c[:type].presence || "[not given]"}
          Function area: #{c[:function].presence || "[not given]"}
          City: #{c[:city].presence || "[not given]"}
          Pay: #{c[:pay].presence || "[not given]"}
          Key points to include:
          #{join_lines(c[:keyPoints])}
        PROMPT
      }
    ),

    "job_screening_questions" => Task.new(
      key: "job_screening_questions",
      system_prompt: COMMON_SYSTEM_PROMPT + "\nWrite 3 to 5 short screening questions an applicant would answer when applying, one per line, no numbering, no extra commentary.",
      fields: {
        title: Field.new(type: :string, max: 160, required: true),
        type: Field.new(type: :string, max: 80),
        function: Field.new(type: :string, max: 80),
        city: Field.new(type: :string, max: 80),
        pay: Field.new(type: :string, max: 120),
        keyPoints: Field.new(type: :array, max: 200, items_max: 15)
      },
      max_output_tokens: 300, max_output_chars: 1200, long: false,
      template: ->(c) {
        <<~PROMPT
          Write 3 to 5 screening questions for applicants to this opening.
          Title: #{c[:title]}
          Type: #{c[:type].presence || "[not given]"}
          Function area: #{c[:function].presence || "[not given]"}
          City: #{c[:city].presence || "[not given]"}
          Pay: #{c[:pay].presence || "[not given]"}
          Key points:
          #{join_lines(c[:keyPoints])}
        PROMPT
      }
    ),

    "profile_headline" => Task.new(
      key: "profile_headline",
      system_prompt: COMMON_SYSTEM_PROMPT + "\nWrite one short, professional profile headline (max 12 words, no full stop at the end).",
      fields: {
        roles: Field.new(type: :array, max: 80, items_max: 10),
        skills: Field.new(type: :array, max: 80, items_max: 15),
        genres: Field.new(type: :array, max: 80, items_max: 10),
        city: Field.new(type: :string, max: 80),
        credits: Field.new(type: :array, max: 120, items_max: 10)
      },
      max_output_tokens: 60, max_output_chars: 120, long: false,
      template: ->(c) {
        <<~PROMPT
          Write a professional headline for this person.
          Roles: #{c[:roles].join(", ").presence || "[not given]"}
          Skills: #{c[:skills].join(", ").presence || "[not given]"}
          Genres: #{c[:genres].join(", ").presence || "[not given]"}
          City: #{c[:city].presence || "[not given]"}
          Credits:
          #{join_lines(c[:credits])}
        PROMPT
      }
    ),

    "profile_bio" => Task.new(
      key: "profile_bio",
      system_prompt: COMMON_SYSTEM_PROMPT + "\nWrite a short first-person professional bio, 60 to 150 words.",
      fields: {
        roles: Field.new(type: :array, max: 80, items_max: 10),
        skills: Field.new(type: :array, max: 80, items_max: 15),
        genres: Field.new(type: :array, max: 80, items_max: 10),
        city: Field.new(type: :string, max: 80),
        credits: Field.new(type: :array, max: 120, items_max: 10)
      },
      max_output_tokens: 260, max_output_chars: 1200, long: false,
      template: ->(c) {
        <<~PROMPT
          Write a first-person professional bio for this person.
          Roles: #{c[:roles].join(", ").presence || "[not given]"}
          Skills: #{c[:skills].join(", ").presence || "[not given]"}
          Genres: #{c[:genres].join(", ").presence || "[not given]"}
          City: #{c[:city].presence || "[not given]"}
          Credits:
          #{join_lines(c[:credits])}
        PROMPT
      }
    ),

    "portfolio_blurb" => Task.new(
      key: "portfolio_blurb",
      system_prompt: COMMON_SYSTEM_PROMPT + "\nWrite a short portfolio blurb, 40 to 100 words, describing this body of work.",
      fields: {
        title: Field.new(type: :string, max: 160, required: true),
        roles: Field.new(type: :array, max: 80, items_max: 10),
        skills: Field.new(type: :array, max: 80, items_max: 15),
        genres: Field.new(type: :array, max: 80, items_max: 10),
        highlights: Field.new(type: :array, max: 200, items_max: 10)
      },
      max_output_tokens: 200, max_output_chars: 900, long: false,
      template: ->(c) {
        <<~PROMPT
          Write a blurb for this portfolio.
          Portfolio title: #{c[:title]}
          Roles: #{c[:roles].join(", ").presence || "[not given]"}
          Skills: #{c[:skills].join(", ").presence || "[not given]"}
          Genres: #{c[:genres].join(", ").presence || "[not given]"}
          Highlights:
          #{join_lines(c[:highlights])}
        PROMPT
      }
    ),

    "cover_letter" => Task.new(
      key: "cover_letter",
      system_prompt: COMMON_SYSTEM_PROMPT + "\nWrite a short cover letter (100 to 200 words) applying for this job, tailored to the job and the applicant's background given. No salutation with a name unless one is given; a generic greeting is fine.",
      fields: {
        jobTitle: Field.new(type: :string, max: 160, required: true),
        company: Field.new(type: :string, max: 120),
        jobDescription: Field.new(type: :string, max: 2000),
        headline: Field.new(type: :string, max: 120),
        skills: Field.new(type: :array, max: 80, items_max: 15),
        resumeSummary: Field.new(type: :string, max: 1200)
      },
      max_output_tokens: 400, max_output_chars: 1800, long: true,
      template: ->(c) {
        <<~PROMPT
          Write a cover letter for this application.
          Job title: #{c[:jobTitle]}
          Company: #{c[:company].presence || "[not given]"}
          Job description: #{c[:jobDescription].presence || "[not given]"}
          Applicant headline: #{c[:headline].presence || "[not given]"}
          Applicant skills: #{c[:skills].join(", ").presence || "[not given]"}
          Applicant resume summary: #{c[:resumeSummary].presence || "[not given]"}
        PROMPT
      }
    ),

    "post_caption" => Task.new(
      key: "post_caption",
      system_prompt: COMMON_SYSTEM_PROMPT + "\nWrite a short, engaging feed post caption, 15 to 60 words, matching the kind of post given.",
      fields: {
        kind: Field.new(type: :string, max: 60, required: true),
        notes: Field.new(type: :string, max: 800)
      },
      max_output_tokens: 150, max_output_chars: 600, long: false,
      template: ->(c) {
        <<~PROMPT
          Write a feed post caption.
          Kind of post: #{c[:kind]}
          Notes: #{c[:notes].presence || "[not given]"}
        PROMPT
      }
    ),

    "message_reply" => Task.new(
      key: "message_reply",
      system_prompt: COMMON_SYSTEM_PROMPT + "\nSuggest one short, natural reply (1 to 3 sentences) to the end of this conversation, from the viewer's side. Do not restate the conversation.",
      fields: {
        messages: Field.new(type: :array, max: 600, items_max: 5)
      },
      max_output_tokens: 200, max_output_chars: 700, long: false,
      template: ->(c) {
        <<~PROMPT
          Here is the recent conversation, oldest first. Each line is "them:" or "me:".
          #{c[:messages].join("\n")}

          Suggest my (the "me" side's) next reply.
        PROMPT
      }
    ),

    "resume_summary" => Task.new(
      key: "resume_summary",
      system_prompt: COMMON_SYSTEM_PROMPT + "\nWrite a short professional resume summary, 40 to 90 words, third person is not needed — first person is fine.",
      fields: {
        roles: Field.new(type: :array, max: 80, items_max: 10),
        skills: Field.new(type: :array, max: 80, items_max: 15),
        credits: Field.new(type: :array, max: 120, items_max: 10),
        yearsExperience: Field.new(type: :string, max: 20),
        highlights: Field.new(type: :array, max: 200, items_max: 10)
      },
      max_output_tokens: 220, max_output_chars: 900, long: true,
      template: ->(c) {
        <<~PROMPT
          Write a resume summary for this person.
          Roles: #{c[:roles].join(", ").presence || "[not given]"}
          Skills: #{c[:skills].join(", ").presence || "[not given]"}
          Years of experience: #{c[:yearsExperience].presence || "[not given]"}
          Credits:
          #{join_lines(c[:credits])}
          Highlights:
          #{join_lines(c[:highlights])}
        PROMPT
      }
    ),

    "improve_text" => Task.new(
      key: "improve_text",
      system_prompt: COMMON_SYSTEM_PROMPT + "\nRewrite the given text to match the requested tone, keeping its meaning, length in the same ballpark, and language. Return only the rewritten text.",
      fields: {
        tone: Field.new(type: :string, max: 20, required: true, allowed: %w[clearer shorter friendlier]),
        text: Field.new(type: :string, max: 2000, required: true)
      },
      max_output_tokens: 700, max_output_chars: 2400, long: false,
      template: ->(c) {
        <<~PROMPT
          Rewrite the following text to be #{ALLOWED_TONES.fetch(c[:tone], "clearer")}.

          Text:
          #{c[:text]}
        PROMPT
      }
    )
  }

  ALLOWED_TONES = { "clearer" => "clearer", "shorter" => "shorter, keeping the key information", "friendlier" => "warmer and friendlier" }.freeze

  # Internal only: fills gaps in taxonomy autocomplete (AiController#autocomplete). Not part of
  # the public task allow-list returned by AiAssist.tasks / GET /api/ai/status, and not reachable
  # through POST /api/ai/suggest.
  REGISTRY["autocomplete"] = Task.new(
    key: "autocomplete",
    system_prompt: COMMON_SYSTEM_PROMPT + "\nSuggest up to 5 additional, plausible values for the given field in the Indian music industry. One per line, no numbering, no explanation, no duplicates of the existing values.",
    fields: {
      field: Field.new(type: :string, max: 30, required: true),
      query: Field.new(type: :string, max: 60, required: true),
      existing: Field.new(type: :array, max: 60, items_max: 10)
    },
    max_output_tokens: 100, max_output_chars: 400, long: false,
    template: ->(c) {
      <<~PROMPT
        Field: #{c[:field]}
        What the user has typed so far: #{c[:query]}
        Values already matched (do not repeat these): #{c[:existing].join(", ").presence || "none"}
      PROMPT
    }
  )

  # Recruiter tasks (Haiku; access-checked in AiController — the caller must be the job's
  # employer, an admin, or a member of the organization that owns the job) and talent tasks
  # (draft_portfolio, tailor_resume) that accept structured, id-tagged inputs so their output can
  # be validated against the ids actually given, never invented ones.
  REGISTRY["candidate_summary"] = Task.new(
    key: "candidate_summary",
    system_prompt: COMMON_SYSTEM_PROMPT + "\nWrite exactly 3 short bullet points (one per line, starting with \"- \") summarizing this candidate for a recruiter, then one final line starting \"Fit: \" with a one-sentence fit note. Use only the facts given.",
    fields: {
      candidateHeadline: Field.new(type: :string, max: 160),
      candidateSkills: Field.new(type: :array, max: 80, items_max: 15),
      candidateSummary: Field.new(type: :string, max: 1200),
      jobTitle: Field.new(type: :string, max: 160, required: true),
      screeningAnswers: Field.new(type: :array, max: 400, items_max: 10)
    },
    max_output_tokens: 200, max_output_chars: 900, long: false,
    template: ->(c) {
      <<~PROMPT
        Job: #{c[:jobTitle]}
        Candidate headline: #{c[:candidateHeadline].presence || "[not given]"}
        Candidate skills: #{c[:candidateSkills].join(", ").presence || "[not given]"}
        Candidate summary: #{c[:candidateSummary].presence || "[not given]"}
        Screening answers:
        #{join_lines(c[:screeningAnswers])}
      PROMPT
    }
  )

  REGISTRY["rank_applicants"] = Task.new(
    key: "rank_applicants",
    system_prompt: COMMON_SYSTEM_PROMPT + "\nScore each applicant's fit for the job on 0-100 with a one-sentence reason. Reply with strict JSON only: a single array of {\"applicationId\": string, \"score\": number, \"reason\": string}, one entry per applicant given, same order, no other text.",
    fields: {
      jobTitle: Field.new(type: :string, max: 160, required: true),
      jobRequirements: Field.new(type: :string, max: 1200),
      applicants: Field.new(type: :array, max: 4000, items_max: 100)
    },
    max_output_tokens: 200, max_output_chars: 4000, long: false,
    template: ->(c) {
      <<~PROMPT
        Job: #{c[:jobTitle]}
        Requirements: #{c[:jobRequirements].presence || "[not given]"}
        Applicants (one JSON object per line, "id" is the applicationId to use in your output):
        #{c[:applicants].join("\n")}
      PROMPT
    }
  )

  REGISTRY["outreach_message"] = Task.new(
    key: "outreach_message",
    system_prompt: COMMON_SYSTEM_PROMPT + "\nWrite a short, friendly outreach message (60-120 words) inviting this person to apply or connect about the opening. No salutation with a name unless one is given.",
    fields: {
      jobTitle: Field.new(type: :string, max: 160, required: true),
      candidateHeadline: Field.new(type: :string, max: 160),
      notes: Field.new(type: :string, max: 500)
    },
    max_output_tokens: 160, max_output_chars: 700, long: false,
    template: ->(c) {
      <<~PROMPT
        Write outreach for this opening.
        Job: #{c[:jobTitle]}
        Candidate headline: #{c[:candidateHeadline].presence || "[not given]"}
        Notes: #{c[:notes].presence || "[not given]"}
      PROMPT
    }
  )

  REGISTRY["interview_questions"] = Task.new(
    key: "interview_questions",
    system_prompt: COMMON_SYSTEM_PROMPT + "\nWrite 5 interview questions for this candidate and role, one per line, no numbering.",
    fields: {
      jobTitle: Field.new(type: :string, max: 160, required: true),
      candidateHeadline: Field.new(type: :string, max: 160),
      focusAreas: Field.new(type: :array, max: 80, items_max: 10)
    },
    max_output_tokens: 200, max_output_chars: 1200, long: false,
    template: ->(c) {
      <<~PROMPT
        Job: #{c[:jobTitle]}
        Candidate headline: #{c[:candidateHeadline].presence || "[not given]"}
        Focus areas: #{c[:focusAreas].join(", ").presence || "[not given]"}
      PROMPT
    }
  )

  REGISTRY["rejection_note"] = Task.new(
    key: "rejection_note",
    system_prompt: COMMON_SYSTEM_PROMPT + "\nWrite a short, kind rejection note (40-90 words) for this candidate, no specifics that could be taken as legal commitments.",
    fields: {
      jobTitle: Field.new(type: :string, max: 160, required: true),
      candidateHeadline: Field.new(type: :string, max: 160)
    },
    max_output_tokens: 160, max_output_chars: 700, long: false,
    template: ->(c) {
      <<~PROMPT
        Job: #{c[:jobTitle]}
        Candidate headline: #{c[:candidateHeadline].presence || "[not given]"}
      PROMPT
    }
  )

  REGISTRY["draft_portfolio"] = Task.new(
    key: "draft_portfolio",
    system_prompt: COMMON_SYSTEM_PROMPT + "\nPropose a new portfolio for the stated goal, drawn only from the given items. Reply with strict JSON only: {\"title\": string, \"blurb\": string, \"itemIds\": [string]} using only ids from the items given.",
    fields: {
      goal: Field.new(type: :string, max: 300, required: true),
      items: Field.new(type: :array, max: 4000, items_max: 60)
    },
    max_output_tokens: 550, max_output_chars: 2000, long: true,
    template: ->(c) {
      <<~PROMPT
        Goal: #{c[:goal]}
        Items (one JSON object per line, "id" is the itemId to use in your output):
        #{c[:items].join("\n")}
      PROMPT
    }
  )

  REGISTRY["tailor_resume"] = Task.new(
    key: "tailor_resume",
    system_prompt: COMMON_SYSTEM_PROMPT + "\nPropose which given career entries best fit the stated job, and write a short tailored summary. Reply with strict JSON only: {\"summary\": string, \"entryIds\": [string]} using only ids from the entries given.",
    fields: {
      jobTitle: Field.new(type: :string, max: 160, required: true),
      jobSummary: Field.new(type: :string, max: 1200),
      entries: Field.new(type: :array, max: 4000, items_max: 60)
    },
    max_output_tokens: 550, max_output_chars: 2000, long: true,
    template: ->(c) {
      <<~PROMPT
        Job: #{c[:jobTitle]}
        Job summary: #{c[:jobSummary].presence || "[not given]"}
        Career entries (one JSON object per line, "id" is the entryId to use in your output):
        #{c[:entries].join("\n")}
      PROMPT
    }
  )

  # Admin-only (system-initiated by Verification::Summarizer, never reachable through
  # POST /api/ai/suggest: it is left out of PUBLIC_TASKS). Its own INR budget line lives in
  # config/ai_pricing.yml (`verification_summary_monthly_budget_inr`).
  VERIFICATION_SUMMARY_PROMPT = <<~PROMPT.squish.freeze
    You write a short summary of verification evidence for a Verse admin deciding whether to
    verify a musician. Use only the facts provided. Do not infer or invent. Reply in plain text:
    at most 3 short lines, factual, no markdown, no preamble.
  PROMPT

  REGISTRY["verification_summary"] = Task.new(
    key: "verification_summary",
    system_prompt: VERIFICATION_SUMMARY_PROMPT,
    fields: { facts: Field.new(type: :string, max: 2000, required: true) },
    max_output_tokens: 120, max_output_chars: 400, long: false,
    template: ->(c) { "Facts:\n#{c[:facts]}" }
  )

  ADMIN_TASKS = %w[verification_summary].freeze
  PUBLIC_TASKS = (REGISTRY.keys - ["autocomplete"] - ADMIN_TASKS).freeze
  REGISTRY.freeze
end
