// Native compatibility tests for the iOS port. Run with npm run test:ios:native on macOS.
#import <XCTest/XCTest.h>
#import <Security/Security.h>
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

@interface LxMusicMobileTests : XCTestCase
@end
@implementation LxMusicMobileTests
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
