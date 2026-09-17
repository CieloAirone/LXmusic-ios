// Added for the unofficial iOS port. Wire formats match the Android bridge.
#import "LXCrypto.h"
#import <Security/Security.h>
#import <CommonCrypto/CommonCrypto.h>
#import <React/RCTBridgeModule.h>

static void LXRequire(BOOL ok, NSString *message) {
  if (!ok) @throw [NSException exceptionWithName:@"LXCryptoError" reason:message userInfo:nil];
}
static NSData *LXDecode(NSString *s) {
  NSData *data = [[NSData alloc] initWithBase64EncodedString:s options:NSDataBase64DecodingIgnoreUnknownCharacters];
  LXRequire(data != nil, @"Invalid base64");
  return data;
}
static NSData *LXDER(uint8_t tag, NSData *value) {
  NSMutableData *result = [NSMutableData dataWithBytes:&tag length:1];
  NSUInteger length = value.length;
  if (length < 128) { uint8_t byte = length; [result appendBytes:&byte length:1]; }
  else {
    uint8_t bytes[sizeof(NSUInteger)]; NSUInteger count = 0;
    while (length) { bytes[sizeof(bytes)-1-count++] = length & 255; length >>= 8; }
    uint8_t header = 0x80 | count; [result appendBytes:&header length:1];
    [result appendBytes:bytes + sizeof(bytes) - count length:count];
  }
  [result appendData:value]; return result;
}
static NSData *LXReadDER(NSData *data, NSUInteger *offset, uint8_t expected) {
  const uint8_t *bytes = data.bytes;
  LXRequire(*offset + 2 <= data.length, @"Truncated DER");
  LXRequire(bytes[(*offset)++] == expected, @"Unexpected DER type");
  NSUInteger length = bytes[(*offset)++];
  if (length & 128) {
    NSUInteger count = length & 127; length = 0;
    LXRequire(count > 0 && count <= sizeof(NSUInteger) && count <= data.length - *offset, @"Invalid DER length");
    while (count--) length = (length << 8) | bytes[(*offset)++];
  }
  LXRequire(length <= data.length - *offset, @"Truncated DER value");
  NSData *value = [data subdataWithRange:NSMakeRange(*offset, length)]; *offset += length; return value;
}
static NSData *LXAlgorithm(void) {
  const uint8_t bytes[] = {0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0x00};
  return [NSData dataWithBytes:bytes length:sizeof(bytes)];
}
@implementation LXCrypto
+ (NSString *)aes:(NSString *)text key:(NSString *)key iv:(NSString *)iv mode:(NSString *)mode decrypt:(BOOL)decrypt {
  NSData *input = LXDecode(text), *keyData = LXDecode(key), *ivData = LXDecode(iv);
  BOOL cbc = [mode isEqualToString:@"AES/CBC/PKCS7Padding"];
  LXRequire(cbc || [mode isEqualToString:@"AES"] || [mode isEqualToString:@"AES/ECB/NoPadding"], @"Unsupported AES mode");
  LXRequire(keyData.length == 16 || keyData.length == 24 || keyData.length == 32, @"Invalid AES key length");
  unsigned char vector[16] = {0}; memcpy(vector, ivData.bytes, MIN(ivData.length, 16));
  // Android Cipher.getInstance("AES") uses ECB with PKCS padding.
  CCOptions options = cbc ? kCCOptionPKCS7Padding : kCCOptionECBMode;
  if ([mode isEqualToString:@"AES"]) options |= kCCOptionPKCS7Padding;
  NSMutableData *output = [NSMutableData dataWithLength:input.length + kCCBlockSizeAES128]; size_t written = 0;
  CCCryptorStatus status = CCCrypt(decrypt ? kCCDecrypt : kCCEncrypt, kCCAlgorithmAES, options,
    keyData.bytes, keyData.length, cbc ? vector : NULL, input.bytes, input.length, output.mutableBytes, output.length, &written);
  LXRequire(status == kCCSuccess, @"AES operation failed"); output.length = written;
  NSString *result = decrypt ? [[NSString alloc] initWithData:output encoding:NSUTF8StringEncoding] : [output base64EncodedStringWithOptions:0];
  LXRequire(result != nil, @"Decrypted data is not UTF-8"); return result;
}
+ (NSString *)rsa:(NSString *)text key:(NSString *)key padding:(NSString *)padding decrypt:(BOOL)decrypt {
  NSData *der = LXDecode(key); NSUInteger offset = 0;
  NSData *sequence = LXReadDER(der, &offset, 0x30); offset = 0;
  if (decrypt) {
    LXReadDER(sequence, &offset, 0x02); LXReadDER(sequence, &offset, 0x30);
    der = LXReadDER(sequence, &offset, 0x04); // PKCS#8 -> PKCS#1
  } else {
    LXReadDER(sequence, &offset, 0x30); NSData *bits = LXReadDER(sequence, &offset, 0x03);
    LXRequire(bits.length > 1 && ((const uint8_t *)bits.bytes)[0] == 0, @"Invalid public key");
    der = [bits subdataWithRange:NSMakeRange(1, bits.length - 1)]; // SPKI -> PKCS#1
  }
  CFErrorRef error = NULL;
  SecKeyRef secKey = SecKeyCreateWithData((__bridge CFDataRef)der, (__bridge CFDictionaryRef)@{
    (__bridge id)kSecAttrKeyType: (__bridge id)kSecAttrKeyTypeRSA,
    (__bridge id)kSecAttrKeyClass: (__bridge id)(decrypt ? kSecAttrKeyClassPrivate : kSecAttrKeyClassPublic)
  }, &error);
  NSError *keyError = CFBridgingRelease(error);
  NSString *message = keyError.localizedDescription ?: @"RSA key missing";
  LXRequire(secKey != NULL, message);
  BOOL raw = [padding isEqualToString:@"RSA/ECB/NoPadding"];
  if (!raw && ![padding isEqualToString:@"RSA/ECB/OAEPWithSHA1AndMGF1Padding"]) {
    CFRelease(secKey); LXRequire(NO, @"Unsupported RSA padding");
  }
  NSData *input = LXDecode(text);
  if (raw && !decrypt && input.length < SecKeyGetBlockSize(secKey)) {
    NSMutableData *padded = [NSMutableData dataWithLength:SecKeyGetBlockSize(secKey) - input.length];
    [padded appendData:input]; input = padded;
  }
  SecKeyAlgorithm algorithm = raw ? kSecKeyAlgorithmRSAEncryptionRaw : kSecKeyAlgorithmRSAEncryptionOAEPSHA1;
  error = NULL;
  CFDataRef result = decrypt ? SecKeyCreateDecryptedData(secKey, algorithm, (__bridge CFDataRef)input, &error)
    : SecKeyCreateEncryptedData(secKey, algorithm, (__bridge CFDataRef)input, &error);
  CFRelease(secKey); if (error) CFRelease(error);
  NSData *output = CFBridgingRelease(result); LXRequire(output != nil, @"RSA operation failed");
  NSString *value = decrypt ? [[NSString alloc] initWithData:output encoding:NSUTF8StringEncoding] : [output base64EncodedStringWithOptions:0];
  LXRequire(value != nil, @"Decrypted data is not UTF-8"); return value;
}
+ (NSDictionary *)generateKey {
  CFErrorRef error = NULL;
  SecKeyRef privateKey = SecKeyCreateRandomKey((__bridge CFDictionaryRef)@{
    (__bridge id)kSecAttrKeyType: (__bridge id)kSecAttrKeyTypeRSA,
    (__bridge id)kSecAttrKeySizeInBits: @2048
  }, &error);
  if (error) CFRelease(error); LXRequire(privateKey != NULL, @"RSA generation failed");
  SecKeyRef publicKey = SecKeyCopyPublicKey(privateKey);
  NSData *priv = CFBridgingRelease(SecKeyCopyExternalRepresentation(privateKey, NULL));
  NSData *pub = CFBridgingRelease(SecKeyCopyExternalRepresentation(publicKey, NULL));
  CFRelease(publicKey); CFRelease(privateKey); LXRequire(priv && pub, @"RSA export failed");
  const uint8_t zero = 0;
  NSMutableData *privateBody = [LXDER(0x02, [NSData dataWithBytes:&zero length:1]) mutableCopy];
  [privateBody appendData:LXAlgorithm()]; [privateBody appendData:LXDER(0x04, priv)];
  NSMutableData *bits = [NSMutableData dataWithBytes:&zero length:1]; [bits appendData:pub];
  NSMutableData *publicBody = [LXAlgorithm() mutableCopy]; [publicBody appendData:LXDER(0x03, bits)];
  return @{@"privateKey": [LXDER(0x30, privateBody) base64EncodedStringWithOptions:0],
           @"publicKey": [LXDER(0x30, publicBody) base64EncodedStringWithOptions:0]};
}
+ (NSString *)digest:(NSString *)text md5:(BOOL)md5 {
  NSData *data = [text dataUsingEncoding:NSUTF8StringEncoding]; unsigned char hash[CC_SHA1_DIGEST_LENGTH];
  if (md5) CC_MD5(data.bytes, (CC_LONG)data.length, hash); else CC_SHA1(data.bytes, (CC_LONG)data.length, hash);
  NSMutableString *result = [NSMutableString string];
  for (NSUInteger i = 0; i < (md5 ? CC_MD5_DIGEST_LENGTH : CC_SHA1_DIGEST_LENGTH); i++) [result appendFormat:@"%02x", hash[i]];
  return result;
}
@end

@interface CryptoModule : NSObject <RCTBridgeModule>
@end
@implementation CryptoModule
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup { return NO; }
RCT_EXPORT_METHOD(generateRsaKey:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  @try { resolve([LXCrypto generateKey]); } @catch (NSException *e) { reject(@"E_CRYPTO", e.reason, nil); }
}
RCT_EXPORT_METHOD(sha1:(NSString *)text resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  resolve([LXCrypto digest:text md5:NO]);
}
RCT_EXPORT_METHOD(aesEncrypt:(NSString *)text key:(NSString *)key iv:(NSString *)iv mode:(NSString *)mode resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  @try { resolve([LXCrypto aes:text key:key iv:iv mode:mode decrypt:NO]); } @catch (NSException *e) { reject(@"E_CRYPTO", e.reason, nil); }
}
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(aesEncryptSync:(NSString *)text key:(NSString *)key iv:(NSString *)iv mode:(NSString *)mode) {
  @try { return [LXCrypto aes:text key:key iv:iv mode:mode decrypt:NO]; } @catch (NSException *e) { return @""; }
}
RCT_EXPORT_METHOD(aesDecrypt:(NSString *)text key:(NSString *)key iv:(NSString *)iv mode:(NSString *)mode resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  @try { resolve([LXCrypto aes:text key:key iv:iv mode:mode decrypt:YES]); } @catch (NSException *e) { reject(@"E_CRYPTO", e.reason, nil); }
}
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(aesDecryptSync:(NSString *)text key:(NSString *)key iv:(NSString *)iv mode:(NSString *)mode) {
  @try { return [LXCrypto aes:text key:key iv:iv mode:mode decrypt:YES]; } @catch (NSException *e) { return @""; }
}
RCT_EXPORT_METHOD(rsaEncrypt:(NSString *)text key:(NSString *)key padding:(NSString *)padding resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  @try { resolve([LXCrypto rsa:text key:key padding:padding decrypt:NO]); } @catch (NSException *e) { reject(@"E_CRYPTO", e.reason, nil); }
}
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(rsaEncryptSync:(NSString *)text key:(NSString *)key padding:(NSString *)padding) {
  @try { return [LXCrypto rsa:text key:key padding:padding decrypt:NO]; } @catch (NSException *e) { return @""; }
}
RCT_EXPORT_METHOD(rsaDecrypt:(NSString *)text key:(NSString *)key padding:(NSString *)padding resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  @try { resolve([LXCrypto rsa:text key:key padding:padding decrypt:YES]); } @catch (NSException *e) { reject(@"E_CRYPTO", e.reason, nil); }
}
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(rsaDecryptSync:(NSString *)text key:(NSString *)key padding:(NSString *)padding) {
  @try { return [LXCrypto rsa:text key:key padding:padding decrypt:YES]; } @catch (NSException *e) { return @""; }
}
@end
