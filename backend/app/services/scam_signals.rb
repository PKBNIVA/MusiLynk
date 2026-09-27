# Flags messages that look like the common marketplace scams seen in music and casting work:
#
#   upfront_fee      - the talent is asked to pay a "registration", "audition" or similar fee
#   payment_details  - the hiring side shares a UPI handle or bank details to be paid into
#   off_platform     - an early message pushes the chat to WhatsApp/Telegram with a phone number
#
# Signals never block a message; they only drive a gentle notice to the recipient and a count
# for moderators, so the patterns are deliberately narrow (low false positives beat coverage).
# Context that the text alone cannot give is passed in:
#   from_hiring_side: the sender is the employer/requester side of the conversation. Talent
#                     sharing their own UPI or asking for a booking advance is normal business.
#   early:            the sender has only sent a few messages in this conversation so far.
module ScamSignals
  SIGNALS = %w[upfront_fee payment_details off_platform].freeze

  # What the fee is supposedly for. A real employer never charges the talent for these.
  PURPOSE = "(?:\\b(?:registration|regist?ration|registeration|audition|joining|processing|portfolio|profile(?:\\s+activation)?|selection|shortlisting|confirmation|onboarding|enrol?ment|casting|membership|slot\\s+booking|id\\s+card)\\b|रजिस्ट्रेशन|पंजीकरण|ऑडिशन)"
  FEE_PURPOSE = /#{PURPOSE}/i
  FEE_NOUN = "(?:\\b(?:fee|fees|charges?|deposit)\\b|फीस|शुल्क)"
  # "registration fee", "audition ke liye fees", "fees for registration": the fee must be tied to the purpose.
  PURPOSE_FEE = /#{PURPOSE}(?:[\s\-]+(?:ke\s+liye|ki|ka|ke|ko|of|for|round|process)){0,2}[\s\-:]+#{FEE_NOUN}|#{FEE_NOUN}\s+(?:for|of)\s+(?:the\s+|your\s+)?#{PURPOSE}/i
  # Being told to pay (English and common Hinglish), as opposed to being offered a payment.
  PAY_REQUEST = /\b(?:(?:you|u|aap|aapko|tum|tumhe|tumko)\s+(?:will\s+)?(?:need\s+to|have\s+to|has\s+to|must|should|to)\s+(?:pay|deposit|transfer|send)|(?:please|kindly|pls|plz)\s+(?:pay(?!\s+attention)|deposit|transfer)|pay\s+(?:karo|kar\s+do|karna\s+(?:hoga|padega|hai))|(?:dena|deni|dene)\s+(?:hoga|hogi|honge|padega|padegi)|jama\s+(?:karo|kar\s+do|karna|karein|karen)|bhej\s*(?:do|dijiye|dena)|bhejo)\b/i
  # "no/without/free of ... fee" and "fee nahi hai" are reassurances, not requests.
  NEGATION_BEFORE = /\b(?:no|zero|without|never|not|don'?t|doesn'?t|free\s+of|koi\s+bhi)\b[^.!?\n]{0,25}\z/i
  NEGATION_AFTER = /\A[^.!?\n]{0,15}\b(?:nahi|nahin|nhi|not\s+required|waived|is\s+free)\b/i
  # Talent being told to pay an "advance" (hiring side only: talent asking a hirer for an advance is normal).
  ADVANCE_REQUEST = /\badvance\b[^.!?\n]{0,30}#{PAY_REQUEST.source}|#{PAY_REQUEST.source}[^.!?\n]{0,20}\badvance\b/i

  UPI_HANDLE = /[a-z0-9.\-_]{2,}@(?:ok[a-z]+|ybl|ibl|axl|apl|upi|paytm|ptyes|ptaxis|pthdfc|ptsbi|axisbank|icici|hdfcbank|sbi|kotak|yesbank|idfcbank|freecharge|airtel|fam|jupiteraxis|slc|waicici|waaxis|wasbi|wahdfcbank)\b/i
  IFSC = /\b[A-Z]{4}0[A-Z0-9]{6}\b/
  ACCOUNT_NUMBER = /\b(?:a\/c|acc(?:ount)?|khata)\s*(?:no\.?|number|num)?\s*[:\-]?\s*\d{9,18}\b/i
  PAY_TO_WALLET = /\b(?:pay|send|transfer|bhejo|bhej\s+do|jama)\b[^.!?\n]{0,30}\b(?:on|to|pe|par|via)\s+(?:my\s+|this\s+|is\s+|mere\s+)?(?:upi|gpay|google\s+pay|phonepe|phone\s+pe|paytm)\b|\b(?:upi|gpay|google\s+pay|phonepe|paytm)\s+(?:pe|par|on|se)\s+(?:\S+\s+)?(?:bhejo|bhej\s+do|pay\s+karo|transfer\s+karo|jama\s+karo)\b/i

  CHAT_APP = /\b(?:whats\s?app|watsapp|whatsap|telegram|wa\.me|t\.me)\b|व्हाट्सएप|टेलीग्राम/i
  INDIAN_PHONE = /(?<!\d)(?:\+?91[\s\-]?)?[6-9]\d{4}[\s\-]?\d{5}(?!\d)/

  module_function

  # Returns the signal codes (subset of SIGNALS, in that order) found in `text`.
  def detect(text, from_hiring_side: true, early: true)
    text = text.to_s
    return [] if text.strip.empty?

    found = []
    found << "upfront_fee" if upfront_fee?(text, from_hiring_side:)
    found << "payment_details" if from_hiring_side && payment_details?(text)
    found << "off_platform" if early && off_platform?(text)
    found
  end

  def upfront_fee?(text, from_hiring_side: true)
    return true if each_match(PURPOSE_FEE, text).any? { !negated?(text, _1) }
    # "registration ke liye 500 dena hoga": a demand to pay close to what it is supposedly for.
    return true if each_match(FEE_PURPOSE, text).any? do |match|
      window = text[[match.begin(0) - 60, 0].max...[match.end(0) + 60, text.length].min]
      window.match?(PAY_REQUEST) && !negated?(text, match)
    end
    from_hiring_side && text.match?(ADVANCE_REQUEST)
  end

  def payment_details?(text)
    text.match?(UPI_HANDLE) || text.match?(IFSC) || text.match?(ACCOUNT_NUMBER) || text.match?(PAY_TO_WALLET)
  end

  def off_platform?(text)
    text.match?(CHAT_APP) && (text.match?(INDIAN_PHONE) || text.match?(%r{wa\.me/\d}i))
  end

  def each_match(pattern, text)
    text.to_enum(:scan, pattern).map { Regexp.last_match }
  end

  def negated?(text, match)
    before = text[[match.begin(0) - 40, 0].max...match.begin(0)]
    after = text[match.end(0), 40].to_s
    # "no registration fee", "registration fee nahi hai", "registration is free".
    before.match?(NEGATION_BEFORE) || after.sub(/\A\W*(?:fee|fees|charges?|फीस)?/i, "").match?(NEGATION_AFTER) || after.match?(/\A\s*(?:is\s+)?(?:totally\s+|completely\s+)?free\b/i)
  end
end
