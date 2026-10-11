// Native compatibility tests for the iOS port. Run with npm run test:ios:native on macOS.
#import <XCTest/XCTest.h>
#import <Security/Security.h>
#import <AVFoundation/AVFoundation.h>
#import <math.h>
#import <JavaScriptCore/JavaScriptCore.h>
#import <LXPlatform/LXCrypto.h>
#import <React/RCTBridgeModule.h>
#import <RNCAsyncStorage/RNCAsyncStorage.h>

@interface RNCAsyncStorage (LXTestPrivate)
- (NSDictionary *)_writeManifest:(NSMutableArray<NSDictionary *> *__autoreleasing *)errors;
- (void)multiRemove:(NSArray<NSString *> *)keys callback:(RCTResponseSenderBlock)callback;
@end
@interface LXFailingStorage : RNCAsyncStorage
@property(nonatomic) BOOL failManifest;
@end
@implementation LXFailingStorage
- (NSDictionary *)_writeManifest:(NSMutableArray<NSDictionary *> *__autoreleasing *)errors {
  if (!self.failManifest) return [super _writeManifest:errors];
  NSDictionary *failure = @{@"message": @"injected manifest write failure"};
  if (errors) {
    if (!*errors) *errors = [NSMutableArray new];
    [*errors addObject:failure];
  }
  return failure;
}
@end

@protocol LXMetadataBridge <NSObject>
- (void)updateNowPlayingMetadata:(NSDictionary *)metadata resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)clearNowPlayingMetadata:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
@end

@protocol LXTimingBridge <NSObject>
- (void)setupPlayer:(NSDictionary *)config resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)add:(NSArray *)tracks before:(NSNumber *)index resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)getDuration:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)getPosition:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)getBufferedPosition:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)seekTo:(double)seconds resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)play:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)pause:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)reset:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
@end

@interface LxMusicMobileTests : XCTestCase
@end
@implementation LxMusicMobileTests
// Poll the actual RNTrackPlayer/AVPlayer instance on the main queue, without
// substituting native values. CI runs this before permitting the IPA archive.
- (void)waitForTimingCondition:(BOOL (^)(void))condition description:(NSString *)description {
  XCTestExpectation *done = [self expectationWithDescription:description];
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:12];
  __block void (^poll)(void);
  poll = ^{
    if (condition()) { [done fulfill]; poll = nil; return; }
    if ([deadline timeIntervalSinceNow] <= 0) {
      XCTFail(@"Timed out: %@", description);
      [done fulfill]; poll = nil; return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_main_queue(), poll);
  };
  dispatch_async(dispatch_get_main_queue(), poll);
  [self waitForExpectationsWithTimeout:15 handler:nil];
}
- (void)testNativePlaybackTimeUsesSecondsAndAdvances {
  NSURL *url = [[NSURL fileURLWithPath:NSTemporaryDirectory()] URLByAppendingPathComponent:
    [NSString stringWithFormat:@"lx-timing-%@.caf", NSUUID.UUID.UUIDString]];
  AVAudioFormat *format = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:44100 channels:1];
  AVAudioPCMBuffer *buffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:44100 * 16];
  buffer.frameLength = buffer.frameCapacity;
  for (AVAudioFrameCount i = 0; i < buffer.frameLength; i++) {
    buffer.floatChannelData[0][i] = 0.02f * sin(2 * M_PI * 440 * i / 44100.0);
  }
  NSError *error = nil;
  AVAudioFile *file = [[AVAudioFile alloc] initForWriting:url settings:format.settings error:&error];
  XCTAssertNotNil(file); XCTAssertNil(error);
  XCTAssertTrue([file writeFromBuffer:buffer error:&error]); XCTAssertNil(error);
  file = nil; // Close the fixture before AVPlayer reads it.

  RCTPromiseRejectBlock reject = ^(NSString *code, NSString *message, NSError *error) {
    XCTFail(@"Native timing rejection: %@ %@", code, message);
  };
  RCTPromiseResolveBlock ignore = ^(id value) {};
  __block id<LXTimingBridge> player;
  XCTestExpectation *loaded = [self expectationWithDescription:@"load local timing fixture"];
  dispatch_async(dispatch_get_main_queue(), ^{
    Class playerClass = NSClassFromString(@"RNTrackPlayer");
    XCTAssertNotNil(playerClass);
    player = [[playerClass alloc] init];
    [player setupPlayer:@{@"autoUpdateMetadata": @NO, @"waitForBuffer": @YES} resolver:^(id value) {
      [player add:@[@{@"id": @"timing-fixture", @"url": url.absoluteString, @"title": @"Timing fixture", @"artist": @"Test"}]
        before:@(-1) resolver:^(id value) { [loaded fulfill]; } rejecter:reject];
    } rejecter:reject];
  });
  [self waitForExpectationsWithTimeout:10 handler:nil];
  [self waitForTimingCondition:^BOOL {
    __block double duration = 0;
    [player getDuration:^(id value) { duration = [value doubleValue]; } rejecter:reject];
    return fabs(duration - 16) < 0.1;
  } description:@"native duration is 16 seconds, not 16000 milliseconds"];
  dispatch_async(dispatch_get_main_queue(), ^{ [player seekTo:6 resolver:ignore rejecter:reject]; });
  [self waitForTimingCondition:^BOOL {
    __block double position = 0;
    [player getPosition:^(id value) { position = [value doubleValue]; } rejecter:reject];
    return fabs(position - 6) < 0.1;
  } description:@"native seek and position use seconds"];
  dispatch_async(dispatch_get_main_queue(), ^{ [player play:ignore rejecter:reject]; });
  [self waitForTimingCondition:^BOOL {
    __block double position = 0;
    [player getPosition:^(id value) { position = [value doubleValue]; } rejecter:reject];
    return position > 7 && position < 12;
  } description:@"actual audio playback advances native position"];
  XCTestExpectation *paused = [self expectationWithDescription:@"pause preserves native position"];
  dispatch_async(dispatch_get_main_queue(), ^{
    [player pause:ignore rejecter:reject];
    __block double stoppedAt = 0;
    [player getPosition:^(id value) { stoppedAt = [value doubleValue]; } rejecter:reject];
    [player getBufferedPosition:^(id value) {
      XCTAssertGreaterThan([value doubleValue], 0);
      XCTAssertLessThanOrEqual([value doubleValue], 16.1);
    } rejecter:reject];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 350 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [player getPosition:^(id value) { XCTAssertEqualWithAccuracy([value doubleValue], stoppedAt, 0.15); } rejecter:reject];
      [player reset:ignore rejecter:reject];
      [[NSFileManager defaultManager] removeItemAtURL:url error:nil];
      [paused fulfill];
    });
  });
  [self waitForExpectationsWithTimeout:5 handler:nil];
}
- (void)testStorageRetainsFileWhenManifestCommitFails {
  XCTestExpectation *done = [self expectationWithDescription:@"storage rollback"];
  LXFailingStorage *storage = [LXFailingStorage new];
  NSString *key = [@"lx-storage-regression-" stringByAppendingString:NSUUID.UUID.UUIDString];
  NSString *oldValue = [@"old" stringByPaddingToLength:4096 withString:@"x" startingAtIndex:0];
  dispatch_async([storage methodQueue], ^{
    [storage multiSet:@[@[key, oldValue]] callback:^(NSArray *result) {
      XCTAssertEqualObjects(result[0], NSNull.null);
      storage.failManifest = YES;
      [storage multiSet:@[@[key, @"new-small-value"]] callback:^(NSArray *failure) {
        XCTAssertNotEqualObjects(failure[0], NSNull.null);
        [storage multiGet:@[key] callback:^(NSArray *read) {
          XCTAssertEqualObjects(read[0], NSNull.null);
          XCTAssertEqualObjects(read[1][0][1], oldValue);
          storage.failManifest = NO;
          [storage multiRemove:@[key] callback:^(NSArray *removed) { [done fulfill]; }];
        }];
      }];
    }];
  });
  [self waitForExpectationsWithTimeout:10 handler:nil];
}
- (void)testNativeMetadataPromisesResolveForSuccessiveTracks {
  XCTestExpectation *done = [self expectationWithDescription:@"native metadata callbacks"];
  dispatch_async(dispatch_get_main_queue(), ^{
    Class playerClass = NSClassFromString(@"RNTrackPlayer");
    XCTAssertNotNil(playerClass);
    id<LXMetadataBridge> player = [[playerClass alloc] init];
    __block NSUInteger completed = 0;
    RCTPromiseResolveBlock resolve = ^(id value) { completed++; };
    RCTPromiseRejectBlock reject = ^(NSString *code, NSString *message, NSError *error) {
      XCTFail(@"Unexpected native metadata rejection: %@ %@", code, message);
    };
    [player updateNowPlayingMetadata:@{@"title": @"first song", @"duration": @180} resolver:resolve rejecter:reject];
    [player updateNowPlayingMetadata:@{@"title": @"second song", @"duration": @240} resolver:resolve rejecter:reject];
    [player clearNowPlayingMetadata:resolve rejecter:reject];
    XCTAssertEqual(completed, (NSUInteger)3);
    [done fulfill];
  });
  [self waitForExpectationsWithTimeout:5 handler:nil];
}
- (void)testAESMatchesExternalFixture {
  // Generated independently with Node crypto AES-128-CBC and PKCS#7 padding.
  NSString *plain = @"5q2M5Y2VIPCfjrUgTFggTXVzaWM=";
  NSString *key = @"MDEyMzQ1Njc4OWFiY2RlZg==";
  NSString *iv = @"YWJjZGVmMDEyMzQ1Njc4OQ==";
  NSString *encrypted = [LXCrypto aes:plain key:key iv:iv mode:@"AES/CBC/PKCS7Padding" decrypt:NO];
  XCTAssertEqualObjects(encrypted, @"Jh3tzFL+eWN2MEmdBQ1IPz9evRXLAVFmOxVv7nrARbM=");
  XCTAssertEqualObjects([LXCrypto aes:encrypted key:key iv:iv mode:@"AES/CBC/PKCS7Padding" decrypt:YES], @"歌单 🎵 LX Music");
  XCTAssertThrows([LXCrypto aes:plain key:@"YQ==" iv:iv mode:@"AES/CBC/PKCS7Padding" decrypt:NO]);
}
- (void)testDigestCompatibility {
  XCTAssertEqualObjects([LXCrypto digest:@"abc" md5:NO], @"a9993e364706816aba3e25717850c26c9cd0d89d");
  XCTAssertEqualObjects([LXCrypto digest:@"abc" md5:YES], @"900150983cd24fb0d6963f7d28e17f72");
}
- (void)testRSAImportsExternalSPKIAndPKCS8 {
  NSURL *url = [[NSBundle bundleForClass:self.class] URLForResource:@"crypto-fixtures" withExtension:@"json"];
  // Test fixtures are public test keys, never used by the application.
  if (!url) url = [[NSBundle mainBundle] URLForResource:@"crypto-fixtures" withExtension:@"json"];
  XCTAssertNotNil(url);
  NSDictionary *fixture = [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfURL:url] options:0 error:nil];
  NSString *result = [LXCrypto rsa:fixture[@"ciphertext"] key:fixture[@"privateKey"] padding:@"RSA/ECB/OAEPWithSHA1AndMGF1Padding" decrypt:YES];
  XCTAssertEqualObjects(result, fixture[@"plaintext"]);
  NSString *raw = [LXCrypto rsa:fixture[@"rawInput"] key:fixture[@"publicKey"] padding:@"RSA/ECB/NoPadding" decrypt:NO];
  XCTAssertEqualObjects(raw, fixture[@"rawEncrypted"]);
}
- (void)testGeneratedKeysRoundTrip {
  NSDictionary *pair = [LXCrypto generateKey];
  NSString *plain = [[@"同步数据 🎵" dataUsingEncoding:NSUTF8StringEncoding] base64EncodedStringWithOptions:0];
  NSString *cipher = [LXCrypto rsa:plain key:pair[@"publicKey"] padding:@"RSA/ECB/OAEPWithSHA1AndMGF1Padding" decrypt:NO];
  XCTAssertEqualObjects([LXCrypto rsa:cipher key:pair[@"privateKey"] padding:@"RSA/ECB/OAEPWithSHA1AndMGF1Padding" decrypt:YES], @"同步数据 🎵");
}
- (void)testScriptRuntimeResourceIsValidJavaScriptCore {
  NSString *path = [[NSBundle mainBundle] pathForResource:@"user-api-preload" ofType:@"js"];
  XCTAssertNotNil(path);
  JSContext *context = [[JSContext alloc] init];
  [context evaluateScript:[NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil]];
  XCTAssertNil(context.exception);
  XCTAssertFalse(context[@"lx_setup"].isUndefined);
}
@end
