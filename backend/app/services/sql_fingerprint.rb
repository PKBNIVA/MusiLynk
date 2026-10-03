# Reduces a SQL statement to its shape so a slow query can be logged without any of the
# values it carried (emails, names, message bodies, tokens). Every literal becomes `?`, lists
# of literals collapse to one, bind placeholders ($1) become `?` as well, whitespace is squashed.
#
#   SELECT * FROM users WHERE email = 'a@b.c' AND id IN (1, 2, 3) LIMIT 1
#   => SELECT * FROM users WHERE email = ? AND id IN (?) LIMIT ?
module SqlFingerprint
  MAX_LENGTH = 2_000
  # 'text' with doubled quotes inside, E'...' and $$...$$ dollar quoting, then "quoted idents"
  # are left alone (they are column names), then numbers that are not part of a word.
  # E'…' strings also escape with backslashes.
  STRING = /\bE'(?:[^'\\]|\\.|'')*'|'(?:[^']|'')*'/i
  DOLLAR = /\$\w*\$.*?\$\w*\$/m
  # $1, $2… bind placeholders become ? too, so IN ($1, $2) and IN ($1, $2, $3) share a fingerprint.
  BIND = /\$\d+\b/
  NUMBER = /(?<![\w$.])[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?\b/i
  LIST = /\(\s*\?(?:\s*,\s*\?)+\s*\)/
  COMMENT = %r{/\*.*?\*/|--[^\n]*}m

  module_function

  def call(sql)
    sql.to_s
      .gsub(COMMENT, " ")
      .gsub(DOLLAR, "?")
      .gsub(STRING, "?")
      .gsub(BIND, "?")
      .gsub(NUMBER, "?")
      .gsub(LIST, "(?)")
      .squish
      .first(MAX_LENGTH)
  end
end
