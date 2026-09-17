// Independent JavaScriptCore context: scripts never receive the React Native bridge.
#import <React/RCTEventEmitter.h>
#import <JavaScriptCore/JavaScriptCore.h>
#import "LXCrypto.h"

@interface UserApiModule : RCTEventEmitter
@property(nonatomic, strong) JSContext *context;
@property(nonatomic, strong) dispatch_queue_t scriptQueue;
@property(nonatomic, copy) NSString *key;
@property(nonatomic) NSUInteger generation;
@property(nonatomic) BOOL initialized;
@end
@implementation UserApiModule
RCT_EXPORT_MODULE()
+ (BOOL)requiresMainQueueSetup { return NO; }
- (instancetype)init {
  if ((self = [super init])) _scriptQueue = dispatch_queue_create("music.lx.user-api", DISPATCH_QUEUE_SERIAL);
  return self;
}
- (dispatch_queue_t)methodQueue { return self.scriptQueue; }
- (NSArray<NSString *> *)supportedEvents { return @[@"api-action"]; }
- (void)emit:(NSString *)action data:(NSString *)data {
  if ([action isEqualToString:@"init"]) { if (self.initialized) return; self.initialized = YES; }
  [self sendEventWithName:@"api-action" body:@{@"action": action, @"data": data ?: @"null"}];
}
- (void)fail:(NSString *)message {
  NSDictionary *info = @{@"status": @NO, @"errorMessage": message ?: @"Script error", @"info": [NSNull null]};
  NSData *json = [NSJSONSerialization dataWithJSONObject:info options:0 error:nil];
  [self emit:@"init" data:[[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]];
}
RCT_EXPORT_METHOD(loadScript:(NSDictionary *)info) {
  self.generation++; self.context = nil; self.initialized = NO;
  self.key = NSUUID.UUID.UUIDString;
  JSContext *context = [[JSContext alloc] init]; self.context = context;
  __weak UserApiModule *weakSelf = self;
  context.exceptionHandler = ^(JSContext *ctx, JSValue *exception) {
    ctx.exception = exception;
    [weakSelf fail:[exception toString]];
    [weakSelf sendEventWithName:@"api-action" body:@{@"action": @"log", @"type": @"error", @"log": [exception toString] ?: @"Script error"}];
  };
  context[@"__lx_native_call__"] = ^(NSString *key, NSString *action, NSString *data) {
    UserApiModule *owner = weakSelf;
    if ([owner.key isEqualToString:key] && data.length <= 2097152) [owner emit:action data:data];
  };
  context[@"__lx_native_call__utils_str2b64"] = ^NSString *(NSString *value) {
    return [[value dataUsingEncoding:NSUTF8StringEncoding] base64EncodedStringWithOptions:0];
  };
  context[@"__lx_native_call__utils_b642buf"] = ^NSString *(NSString *value) {
    NSData *bytes = [[NSData alloc] initWithBase64EncodedString:value options:NSDataBase64DecodingIgnoreUnknownCharacters];
    NSMutableArray *array = [NSMutableArray arrayWithCapacity:bytes.length];
    const uint8_t *raw = bytes.bytes; for (NSUInteger i = 0; i < bytes.length; i++) [array addObject:@(raw[i])];
    return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:array options:0 error:nil] encoding:NSUTF8StringEncoding];
  };
  NSData *(^bytesFromJSON)(NSString *) = ^NSData *(NSString *json) {
    NSArray *values = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    NSMutableData *bytes = [NSMutableData dataWithCapacity:values.count];
    for (NSNumber *value in values) { uint8_t byte = value.unsignedCharValue; [bytes appendBytes:&byte length:1]; }
    return bytes;
  };
  context[@"__lx_native_call__utils_buf2b64"] = ^NSString *(NSString *json) { return [bytesFromJSON(json) base64EncodedStringWithOptions:0]; };
  context[@"__lx_native_call__utils_buf2str"] = ^NSString *(NSString *json) { return [[NSString alloc] initWithData:bytesFromJSON(json) encoding:NSUTF8StringEncoding] ?: @""; };
  context[@"__lx_native_call__utils_str2md5"] = ^NSString *(NSString *value) {
    return [LXCrypto digest:value.stringByRemovingPercentEncoding ?: value md5:YES];
  };
  context[@"__lx_native_call__utils_aes_encrypt"] = ^NSString *(NSString *text, NSString *key, NSString *iv, NSString *mode) {
    @try { return [LXCrypto aes:text key:key iv:iv mode:mode decrypt:NO]; }
    @catch (NSException *e) { [JSContext currentContext].exception = [JSValue valueWithNewErrorFromMessage:e.reason inContext:[JSContext currentContext]]; return @""; }
  };
  context[@"__lx_native_call__utils_rsa_encrypt"] = ^NSString *(NSString *text, NSString *key, NSString *padding) {
    @try { return [LXCrypto rsa:text key:key padding:padding decrypt:NO]; }
    @catch (NSException *e) { [JSContext currentContext].exception = [JSValue valueWithNewErrorFromMessage:e.reason inContext:[JSContext currentContext]]; return @""; }
  };
  context[@"__lx_native_call__set_timeout"] = ^(NSNumber *identifier, NSNumber *delay) {
    UserApiModule *owner = weakSelf; if (!owner) return;
    NSUInteger generation = owner.generation;
    double milliseconds = MIN(MAX(delay.doubleValue, 0), 2147483647);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(milliseconds * NSEC_PER_MSEC)), owner.scriptQueue, ^{
      UserApiModule *current = weakSelf;
      if (!current || generation != current.generation) return;
      [current.context[@"__lx_native__"] callWithArguments:@[current.key, @"__set_timeout__", identifier.stringValue]];
    });
  };
  context[@"__lx_log"] = ^(NSString *type, NSString *message) {
    [weakSelf sendEventWithName:@"api-action" body:@{@"action": @"log", @"type": type, @"log": message ?: @""}];
  };
  [context evaluateScript:@"globalThis.console = {}; for (const type of ['log','info','warn','error','debug']) console[type] = (...args) => __lx_log(type, args.map(String).join(' '));"];
  NSString *path = [[NSBundle mainBundle] pathForResource:@"user-api-preload" ofType:@"js"];
  NSString *preload = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil];
  if (!preload) { [self fail:@"Missing audio source runtime resource"]; return; }
  [context evaluateScript:preload]; if (context.exception) return;
  [context[@"lx_setup"] callWithArguments:@[self.key, info[@"id"] ?: @"", info[@"name"] ?: @"", info[@"description"] ?: @"",
    info[@"version"] ?: @"", info[@"author"] ?: @"", info[@"homepage"] ?: @"", info[@"script"] ?: @""]];
  if (context.exception) return;
  [context evaluateScript:info[@"script"] ?: @"" withSourceURL:[NSURL URLWithString:@"lx-source://user-script.js"]];
}
RCT_EXPORT_METHOD(sendAction:(NSString *)action data:(NSString *)data) {
  if (self.context) [self.context[@"__lx_native__"] callWithArguments:@[self.key, action, data ?: @"null"]];
}
RCT_EXPORT_METHOD(destroy) { self.generation++; self.context = nil; self.key = nil; }
- (void)invalidate { dispatch_async(self.scriptQueue, ^{ [self destroy]; }); [super invalidate]; }
@end
