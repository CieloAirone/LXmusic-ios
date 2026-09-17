// Native compatibility tests for the iOS port. Run with npm run test:ios:native on macOS.
#import <XCTest/XCTest.h>
#import <Security/Security.h>
#import <JavaScriptCore/JavaScriptCore.h>
#import <LXPlatform/LXCrypto.h>

@interface LxMusicMobileTests : XCTestCase
@end
@implementation LxMusicMobileTests
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
