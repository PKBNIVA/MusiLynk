# Gzip JSON API responses for clients that accept it (every browser does). Listing payloads
# are large and repetitive: GET /api/jobs is ~350 kB of JSON for 250 listings and about a
# tenth of that compressed, which matters most on mobile connections. Only JSON is
# compressed; uploaded media (audio, images, PDFs) is already compressed and passes through.
# After CORS so preflight answers stay tiny and CORS headers are set on compressed responses too.
Rails.application.config.middleware.insert_after Rack::Cors, Rack::Deflater, include: %w[application/json]
