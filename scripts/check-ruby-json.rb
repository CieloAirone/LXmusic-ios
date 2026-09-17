require 'json'

abort "Expected json 2.7.2, got #{JSON::VERSION}" unless JSON::VERSION == '2.7.2'
sample = { 'codegen' => ['ios', true] }
encoded = JSON.generate(sample, quirks_mode: true)
abort 'JSON compatibility round trip failed' unless JSON.parse(encoded, quirks_mode: true) == sample
JSON.pretty_generate(sample, quirks_mode: true)
puts "Ruby #{RUBY_VERSION}; json #{JSON::VERSION}: quirks_mode compatibility passed"
