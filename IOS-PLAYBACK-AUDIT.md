# iOS playback compatibility review

Scope: source script request/response bridge, URL handoff, queue loading, optional cache, native playback error reporting. This is a source review and automated regression check, not a device playback certification.

Confirmed defects addressed:
- Optional filesystem cache lookup could reject TrackPlayer.add before native playback. Fall back to the original URL; regression exercises a failed cache lookup and preserves HTTP headers.
- Native playback errors were console-only, absent from the in-app log. Record code/message with URLs redacted.
- Queue load failures had no explicit catch/reporting. Catch and report them, notify existing player error handlers, and settle the queue promise so later requests can proceed.
- Custom-source music URL failures were console-only. Record failures independently of source script console logging.

Reviewed without a demonstrated defect: iOS track headers reach AVURLAsset options; queue switching explicitly seeks/plays real tracks; Base64 and gzip paths have byte/Unicode regression coverage; source preload request/cancel negotiation has regression coverage.

Remaining uncertainty: no affected source script or failing audio response supplied; no local Apple simulator/Xcode. Source service availability, signed URL expiry, codec support, TLS failures, and actual AVPlayer playback remain unverified. The reported playback incident is not yet proven resolved. New logs distinguish source URL failures, queue load failures, and native audio errors. Never reset user lists as a playback repair.
